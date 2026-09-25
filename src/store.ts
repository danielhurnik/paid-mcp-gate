import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  email            TEXT,
  balance_micros   INTEGER NOT NULL DEFAULT 0 CHECK (balance_micros >= 0),
  daily_cap_micros INTEGER,
  created_at       TEXT NOT NULL,
  disabled_at      TEXT
);
CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  key_hash   TEXT NOT NULL UNIQUE,
  prefix     TEXT NOT NULL,
  label      TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
-- Append-only. Credits are positive, charges negative; one row per delivered item.
CREATE TABLE IF NOT EXISTS ledger (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id           TEXT NOT NULL,
  account_id           TEXT NOT NULL REFERENCES accounts(id),
  ts                   TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('credit', 'charge')),
  amount_micros        INTEGER NOT NULL,
  balance_after_micros INTEGER NOT NULL,
  tool                 TEXT,
  item_id              TEXT,
  doc_id               TEXT,
  collection           TEXT,
  note                 TEXT
);
CREATE INDEX IF NOT EXISTS ledger_account_ts ON ledger (account_id, ts);
CREATE INDEX IF NOT EXISTS ledger_receipt ON ledger (receipt_id);
CREATE TABLE IF NOT EXISTS entitlements (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  doc_id     TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  PRIMARY KEY (account_id, doc_id)
);
-- Demand analytics: what agents searched for and where they hit the paywall.
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  account_id    TEXT,
  kind          TEXT NOT NULL,
  tool          TEXT,
  query         TEXT,
  doc_id        TEXT,
  result_count  INTEGER,
  top_coverage  REAL,
  amount_micros INTEGER
);
CREATE INDEX IF NOT EXISTS events_kind_ts ON events (kind, ts);
`;

export interface Account {
  id: string;
  name: string;
  email: string | null;
  balanceMicros: number;
  dailyCapMicros: number | null;
  createdAt: string;
  disabledAt: string | null;
}

export interface ChargeLine {
  tool: string;
  itemId: string;
  docId: string;
  collection: string;
  amountMicros: number;
}

export type ChargeResult =
  | { ok: true; receiptId: string; totalMicros: number; balanceAfterMicros: number }
  | { ok: false; reason: "insufficient_funds"; totalMicros: number; balanceMicros: number }
  | { ok: false; reason: "daily_spend_cap"; totalMicros: number; spentTodayMicros: number; capMicros: number };

export type EventKind = "search" | "paywall" | "limit";

export interface EventInput {
  kind: EventKind;
  accountId?: string | null;
  tool?: string;
  query?: string | null;
  docId?: string;
  resultCount?: number;
  topCoverage?: number;
  amountMicros?: number;
}

export interface LedgerRow {
  receiptId: string;
  accountId: string;
  accountName: string;
  ts: string;
  kind: "credit" | "charge";
  amountMicros: number;
  tool: string | null;
  itemId: string | null;
  docId: string | null;
  note: string | null;
}

export interface Stats {
  revenue: { last24hMicros: number; last7dMicros: number; allTimeMicros: number };
  paidItems7d: number;
  accounts: { total: number; active7d: number };
  outstandingCreditMicros: number;
  searches7d: number;
  paywall7d: { hits: number; anonymousHits: number; valueMicros: number };
  topDocuments: Array<{ docId: string; collection: string; revenueMicros: number; sales: number }>;
  topBuyers: Array<{ accountId: string; name: string; spendMicros: number; items: number }>;
  unmetDemand: Array<{ query: string; searches: number; bestCoverage: number; lastSeen: string }>;
  paywallByDocument: Array<{ docId: string; hits: number; anonymousHits: number; lastSeen: string }>;
  recent: LedgerRow[];
}

type Row = Record<string, unknown>;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const DAY_MS = 86_400_000;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- accounts & keys -----------------------------------------------------

  createAccount(input: { name: string; email?: string; dailyCapMicros?: number; now?: Date }): Account {
    const id = newId("acct");
    this.db
      .prepare("INSERT INTO accounts (id, name, email, daily_cap_micros, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.name, input.email ?? null, input.dailyCapMicros ?? null, (input.now ?? new Date()).toISOString());
    return this.getAccount(id)!;
  }

  getAccount(id: string): Account | undefined {
    const row = this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Row | undefined;
    return row ? toAccount(row) : undefined;
  }

  listAccounts(): Account[] {
    return (this.db.prepare("SELECT * FROM accounts ORDER BY created_at").all() as Row[]).map(toAccount);
  }

  setAccountDisabled(id: string, disabled: boolean, now = new Date()): boolean {
    const result = this.db
      .prepare("UPDATE accounts SET disabled_at = ? WHERE id = ?")
      .run(disabled ? now.toISOString() : null, id);
    return result.changes > 0;
  }

  /** Returns the plaintext key exactly once; only its SHA-256 hash is stored. */
  createApiKey(accountId: string, label?: string, now = new Date()): { id: string; key: string; prefix: string } {
    if (!this.getAccount(accountId)) throw new Error(`Unknown account ${accountId}`);
    const key = `pmg_${randomBytes(24).toString("base64url")}`;
    const id = newId("key");
    const prefix = key.slice(0, 10);
    this.db
      .prepare("INSERT INTO api_keys (id, account_id, key_hash, prefix, label, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, accountId, hashApiKey(key), prefix, label ?? null, now.toISOString());
    return { id, key, prefix };
  }

  revokeApiKey(keyId: string, now = new Date()): boolean {
    const result = this.db
      .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now.toISOString(), keyId);
    return result.changes > 0;
  }

  listApiKeys(accountId: string): Array<{ id: string; prefix: string; label: string | null; revokedAt: string | null }> {
    const rows = this.db
      .prepare("SELECT id, prefix, label, revoked_at FROM api_keys WHERE account_id = ? ORDER BY created_at")
      .all(accountId) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      prefix: String(r.prefix),
      label: (r.label as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
    }));
  }

  /** Resolves a presented API key to its account; revoked keys and disabled accounts resolve to nothing. */
  authenticate(key: string): Account | undefined {
    const row = this.db
      .prepare(
        `SELECT a.* FROM api_keys k JOIN accounts a ON a.id = k.account_id
         WHERE k.key_hash = ? AND k.revoked_at IS NULL AND a.disabled_at IS NULL`,
      )
      .get(hashApiKey(key)) as Row | undefined;
    return row ? toAccount(row) : undefined;
  }

  // ---- money ---------------------------------------------------------------

  addCredit(accountId: string, amountMicros: number, note?: string, now = new Date()): { receiptId: string; balanceMicros: number } {
    if (!Number.isInteger(amountMicros) || amountMicros <= 0) throw new Error("Credit amount must be positive");
    return this.transaction(() => {
      const account = this.getAccount(accountId);
      if (!account) throw new Error(`Unknown account ${accountId}`);
      const balance = account.balanceMicros + amountMicros;
      const receiptId = newId("rcpt");
      this.db.prepare("UPDATE accounts SET balance_micros = ? WHERE id = ?").run(balance, accountId);
      this.db
        .prepare(
          `INSERT INTO ledger (receipt_id, account_id, ts, kind, amount_micros, balance_after_micros, note)
           VALUES (?, ?, ?, 'credit', ?, ?, ?)`,
        )
        .run(receiptId, accountId, now.toISOString(), amountMicros, balance, note ?? null);
      return { receiptId, balanceMicros: balance };
    });
  }

  spentSinceMicros(accountId: string, since: Date): number {
    const row = this.db
      .prepare("SELECT COALESCE(-SUM(amount_micros), 0) AS spent FROM ledger WHERE account_id = ? AND kind = 'charge' AND ts >= ?")
      .get(accountId, since.toISOString()) as Row;
    return Number(row.spent);
  }

  /** Distinct documents bought through `fetch` since the given time. */
  documentsBoughtSince(accountId: string, since: Date): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(DISTINCT doc_id) AS n FROM ledger WHERE account_id = ? AND kind = 'charge' AND tool = 'fetch' AND ts >= ?",
      )
      .get(accountId, since.toISOString()) as Row;
    return Number(row.n);
  }

  /**
   * Atomically checks the daily cap and balance, debits the account, writes
   * one ledger row per line and (optionally) grants time-boxed access to the
   * documents involved. Nothing is written when a check fails.
   */
  charge(input: {
    accountId: string;
    lines: ChargeLine[];
    dailyCapMicros: number;
    now: Date;
    grantAccessUntil?: Date;
  }): ChargeResult {
    const { accountId, lines, dailyCapMicros, now } = input;
    const totalMicros = lines.reduce((sum, line) => sum + line.amountMicros, 0);
    return this.transaction((): ChargeResult => {
      const account = this.getAccount(accountId);
      if (!account) throw new Error(`Unknown account ${accountId}`);
      const spentTodayMicros = this.spentSinceMicros(accountId, startOfUtcDay(now));
      if (spentTodayMicros + totalMicros > dailyCapMicros) {
        return { ok: false, reason: "daily_spend_cap", totalMicros, spentTodayMicros, capMicros: dailyCapMicros };
      }
      if (account.balanceMicros < totalMicros) {
        return { ok: false, reason: "insufficient_funds", totalMicros, balanceMicros: account.balanceMicros };
      }
      const receiptId = newId("rcpt");
      const ts = now.toISOString();
      let balance = account.balanceMicros;
      const insert = this.db.prepare(
        `INSERT INTO ledger (receipt_id, account_id, ts, kind, amount_micros, balance_after_micros, tool, item_id, doc_id, collection)
         VALUES (?, ?, ?, 'charge', ?, ?, ?, ?, ?, ?)`,
      );
      for (const line of lines) {
        balance -= line.amountMicros;
        insert.run(receiptId, accountId, ts, -line.amountMicros, balance, line.tool, line.itemId, line.docId, line.collection);
      }
      this.db.prepare("UPDATE accounts SET balance_micros = ? WHERE id = ?").run(balance, accountId);
      if (input.grantAccessUntil) {
        const grant = this.db.prepare(
          `INSERT INTO entitlements (account_id, doc_id, expires_at, receipt_id) VALUES (?, ?, ?, ?)
           ON CONFLICT (account_id, doc_id) DO UPDATE SET expires_at = excluded.expires_at, receipt_id = excluded.receipt_id`,
        );
        for (const docId of new Set(lines.map((line) => line.docId))) {
          grant.run(accountId, docId, input.grantAccessUntil.toISOString(), receiptId);
        }
      }
      return { ok: true, receiptId, totalMicros, balanceAfterMicros: balance };
    });
  }

  activeEntitlement(accountId: string, docId: string, now: Date): { expiresAt: string; receiptId: string } | undefined {
    const row = this.db
      .prepare("SELECT expires_at, receipt_id FROM entitlements WHERE account_id = ? AND doc_id = ? AND expires_at > ?")
      .get(accountId, docId, now.toISOString()) as Row | undefined;
    return row ? { expiresAt: String(row.expires_at), receiptId: String(row.receipt_id) } : undefined;
  }

  activeEntitlements(accountId: string, now: Date): Array<{ docId: string; expiresAt: string }> {
    const rows = this.db
      .prepare("SELECT doc_id, expires_at FROM entitlements WHERE account_id = ? AND expires_at > ? ORDER BY expires_at DESC")
      .all(accountId, now.toISOString()) as Row[];
    return rows.map((r) => ({ docId: String(r.doc_id), expiresAt: String(r.expires_at) }));
  }

  ledger(options: { accountId?: string; limit: number }): LedgerRow[] {
    const where = options.accountId ? "WHERE l.account_id = ?" : "";
    const params = options.accountId ? [options.accountId, options.limit] : [options.limit];
    const rows = this.db
      .prepare(
        `SELECT l.*, a.name AS account_name FROM ledger l JOIN accounts a ON a.id = l.account_id
         ${where} ORDER BY l.id DESC LIMIT ?`,
      )
      .all(...params) as Row[];
    return rows.map((r) => ({
      receiptId: String(r.receipt_id),
      accountId: String(r.account_id),
      accountName: String(r.account_name),
      ts: String(r.ts),
      kind: r.kind as "credit" | "charge",
      amountMicros: Number(r.amount_micros),
      tool: (r.tool as string | null) ?? null,
      itemId: (r.item_id as string | null) ?? null,
      docId: (r.doc_id as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));
  }

  // ---- analytics -----------------------------------------------------------

  recordEvent(event: EventInput, now = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO events (ts, account_id, kind, tool, query, doc_id, result_count, top_coverage, amount_micros)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        now.toISOString(),
        event.accountId ?? null,
        event.kind,
        event.tool ?? null,
        event.query ?? null,
        event.docId ?? null,
        event.resultCount ?? null,
        event.topCoverage ?? null,
        event.amountMicros ?? null,
      );
  }

  stats(now = new Date()): Stats {
    const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
    const day = iso(DAY_MS);
    const week = iso(7 * DAY_MS);
    const month = iso(30 * DAY_MS);
    const one = (sql: string, ...params: Array<string | number>) => this.db.prepare(sql).get(...params) as Row;
    const all = (sql: string, ...params: Array<string | number>) => this.db.prepare(sql).all(...params) as Row[];
    const revenueSince = (since: string) =>
      Number(one("SELECT COALESCE(-SUM(amount_micros), 0) AS v FROM ledger WHERE kind = 'charge' AND ts >= ?", since).v);

    const paywall = one(
      `SELECT COUNT(*) AS hits, COALESCE(SUM(account_id IS NULL), 0) AS anon, COALESCE(SUM(amount_micros), 0) AS value
       FROM events WHERE kind = 'paywall' AND ts >= ?`,
      week,
    );
    return {
      revenue: {
        last24hMicros: revenueSince(day),
        last7dMicros: revenueSince(week),
        allTimeMicros: revenueSince(""),
      },
      paidItems7d: Number(one("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'charge' AND ts >= ?", week).n),
      accounts: {
        total: Number(one("SELECT COUNT(*) AS n FROM accounts").n),
        active7d: Number(one("SELECT COUNT(DISTINCT account_id) AS n FROM ledger WHERE kind = 'charge' AND ts >= ?", week).n),
      },
      outstandingCreditMicros: Number(one("SELECT COALESCE(SUM(balance_micros), 0) AS v FROM accounts").v),
      searches7d: Number(one("SELECT COUNT(*) AS n FROM events WHERE kind = 'search' AND ts >= ?", week).n),
      paywall7d: { hits: Number(paywall.hits), anonymousHits: Number(paywall.anon), valueMicros: Number(paywall.value) },
      topDocuments: all(
        `SELECT doc_id, collection, -SUM(amount_micros) AS revenue, COUNT(*) AS sales FROM ledger
         WHERE kind = 'charge' GROUP BY doc_id ORDER BY revenue DESC, sales DESC LIMIT 10`,
      ).map((r) => ({
        docId: String(r.doc_id),
        collection: String(r.collection),
        revenueMicros: Number(r.revenue),
        sales: Number(r.sales),
      })),
      topBuyers: all(
        `SELECT l.account_id, a.name, -SUM(l.amount_micros) AS spend, COUNT(*) AS items FROM ledger l
         JOIN accounts a ON a.id = l.account_id WHERE l.kind = 'charge'
         GROUP BY l.account_id ORDER BY spend DESC LIMIT 10`,
      ).map((r) => ({
        accountId: String(r.account_id),
        name: String(r.name),
        spendMicros: Number(r.spend),
        items: Number(r.items),
      })),
      // Searches the corpus could not answer well: the content gaps agents are telling you about.
      unmetDemand: all(
        `SELECT LOWER(TRIM(query)) AS q, COUNT(*) AS n, MAX(COALESCE(top_coverage, 0)) AS best, MAX(ts) AS last
         FROM events WHERE kind = 'search' AND query IS NOT NULL AND ts >= ? AND COALESCE(top_coverage, 0) < 0.5
         GROUP BY q ORDER BY n DESC, last DESC LIMIT 10`,
        month,
      ).map((r) => ({
        query: String(r.q),
        searches: Number(r.n),
        bestCoverage: Number(r.best),
        lastSeen: String(r.last),
      })),
      paywallByDocument: all(
        `SELECT doc_id, COUNT(*) AS hits, SUM(account_id IS NULL) AS anon, MAX(ts) AS last FROM events
         WHERE kind = 'paywall' AND doc_id IS NOT NULL AND ts >= ?
         GROUP BY doc_id ORDER BY hits DESC LIMIT 10`,
        month,
      ).map((r) => ({
        docId: String(r.doc_id),
        hits: Number(r.hits),
        anonymousHits: Number(r.anon),
        lastSeen: String(r.last),
      })),
      recent: this.ledger({ limit: 20 }),
    };
  }
}

function toAccount(row: Row): Account {
  return {
    id: String(row.id),
    name: String(row.name),
    email: (row.email as string | null) ?? null,
    balanceMicros: Number(row.balance_micros),
    dailyCapMicros: row.daily_cap_micros === null ? null : Number(row.daily_cap_micros),
    createdAt: String(row.created_at),
    disabledAt: (row.disabled_at as string | null) ?? null,
  };
}
