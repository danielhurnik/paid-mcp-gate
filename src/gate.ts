import type { GateConfig } from "./config.ts";
import { chunkDocument } from "./knowledge/markdown.ts";
import { SearchIndex, makeTeaser, matchQuality } from "./knowledge/search.ts";
import type { KnowledgeDocument } from "./knowledge/types.ts";
import { formatUsd, microsToUsd, usdToMicros } from "./money.ts";
import { PriceBook } from "./pricing.ts";
import { startOfUtcDay, type Account, type ChargeResult, type Store } from "./store.ts";

// The Gate is the product's core: what is free, what costs money, and what a
// buyer receives with each purchase. It knows nothing about MCP or HTTP, so
// the same rules can later sit behind other protocols.

export interface Caller {
  account?: Account;
}

export type GateErrorCode =
  | "authentication_required"
  | "payment_required"
  | "price_exceeds_max"
  | "daily_spend_cap_reached"
  | "daily_document_limit_reached"
  | "not_found";

export type AccessInstructions = {
  instructions: string;
  contact?: string;
  buy_credits_url?: string;
  info_url?: string;
};

export type GateError = {
  error: GateErrorCode;
  message: string;
  price_usd?: number;
  balance_usd?: number;
  max_price_usd?: number;
  how_to_get_access?: AccessInstructions;
};

export type GateResult<T> = { ok: true; value: T } | { ok: false; error: GateError };

export type Match = "strong" | "partial" | "weak";

export type SearchResult = {
  id: string;
  title: string;
  collection: string;
  url?: string;
  updated?: string;
  /** Publisher-written teaser; when present it replaces the automatic snippet. */
  summary?: string;
  /** A short excerpt of the best-matching section, only for documents without a summary. */
  snippet?: string;
  /** Heading of the best-matching section: evidence of relevance without giving content away. */
  matched_section: string;
  match: Match;
  price_usd: number;
  access: "free" | "owned" | "paid";
};

export type SearchResponse = { query: string; results: SearchResult[]; note: string };

export type Citation = { title: string; publisher: string; url?: string; updated?: string; attribution: string };

export type LicenseTerms = {
  name: string;
  url?: string;
  ai_training: "prohibited" | "permitted";
  redistribution: "prohibited" | "permitted-with-attribution";
  max_cache_hours: number;
  attribution: "required" | "optional";
  licensee: string | null;
};

export type Receipt = {
  receipt_id: string | null;
  charged_usd: number;
  balance_usd: number | null;
  access: "purchased" | "owned" | "free";
  access_expires_at?: string;
};

export type FetchResponse = {
  id: string;
  title: string;
  collection: string;
  url?: string;
  updated?: string;
  text: string;
  citation: Citation;
  license: LicenseTerms;
  receipt: Receipt;
};

export type PassageResult = {
  id: string;
  doc_id: string;
  doc_title: string;
  heading: string;
  text: string;
  match: Match;
  price_usd: number;
  citation: Citation;
};

export type PassagesResponse = {
  query: string;
  passages: PassageResult[];
  license: LicenseTerms;
  receipt: Receipt;
};

export type AccountStatus = {
  account_id: string;
  name: string;
  balance_usd: number;
  spent_today_usd: number;
  daily_spend_cap_usd: number;
  documents_bought_today: number;
  max_new_documents_per_day: number;
  owned_documents: Array<{ id: string; title: string; access_expires_at: string }>;
  recent_charges: Array<{ at: string; tool: string | null; item_id: string | null; charged_usd: number; receipt_id: string }>;
};

export type CollectionSummary = {
  id: string;
  title: string;
  description?: string;
  documents: number;
  fetch_price_usd: { min: number; max: number };
};

export type Offering = {
  publisher: { name: string; url?: string; contact?: string };
  title: string;
  description: string;
  documents: number;
  collections: CollectionSummary[];
  pricing: { search: string; fetch: string; retrieve_passages: string; repeat_access: string };
  license: Omit<LicenseTerms, "licensee">;
  limits: { daily_spend_cap_usd: number; max_new_documents_per_day: number };
  how_to_get_access: AccessInstructions;
};

export interface GateOptions {
  config: GateConfig;
  documents: KnowledgeDocument[];
  store: Store;
  now?: () => Date;
}

const HOUR_MS = 3_600_000;

const ok = <T>(value: T): GateResult<T> => ({ ok: true, value });
const fail = <T>(error: GateError): GateResult<T> => ({ ok: false, error });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(value)));

export class Gate {
  readonly config: GateConfig;
  readonly index: SearchIndex;
  readonly prices: PriceBook;
  private readonly store: Store;
  private readonly now: () => Date;
  private cachedOffering?: Offering;

  constructor(options: GateOptions) {
    this.config = options.config;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.prices = new PriceBook(options.config);
    this.index = new SearchIndex(options.documents, options.documents.flatMap((doc) => chunkDocument(doc)));
  }

  get documents(): KnowledgeDocument[] {
    return [...this.index.documents.values()];
  }

  // ---- free tools ------------------------------------------------------------

  search(caller: Caller, input: { query: string; collection?: string; limit?: number }): SearchResponse {
    const now = this.now();
    const limit = clamp(input.limit ?? 5, 1, this.config.access.max_search_results);
    const hits = this.index.searchDocuments(input.query, { limit, collection: input.collection });
    this.store.recordEvent(
      {
        kind: "search",
        accountId: caller.account?.id,
        tool: "search",
        query: this.loggedQuery(input.query),
        resultCount: hits.length,
        topCoverage: Math.max(0, ...hits.map((hit) => hit.best.coverage)),
      },
      now,
    );
    const results = hits.map(({ doc, best }): SearchResult => {
      const price = this.prices.documentPrice(doc);
      const owned = price > 0 && caller.account && this.store.activeEntitlement(caller.account.id, doc.id, now);
      return {
        id: doc.id,
        title: doc.title,
        collection: doc.collection,
        url: doc.url,
        updated: doc.updated,
        summary: doc.summary,
        snippet: doc.summary ? undefined : makeTeaser(best.passage.text, input.query, this.config.access.teaser_chars),
        matched_section: best.passage.heading,
        match: matchQuality(best.coverage),
        price_usd: microsToUsd(price),
        access: price === 0 ? "free" : owned ? "owned" : "paid",
      };
    });
    const note = results.length
      ? `Search is free. fetch(id) returns the full document for its price_usd; re-fetching it within ` +
        `${this.config.access.entitlement_hours}h is free. retrieve_passages(query) returns only the most relevant ` +
        `excerpts for less. Results with access "owned" or "free" cost nothing. Prefer strong matches before paying.`
      : "No matching documents. Try other keywords, or call get_offering to see which collections exist.";
    return { query: input.query, results, note };
  }

  offering(): Offering {
    this.cachedOffering ??= this.buildOffering();
    return this.cachedOffering;
  }

  private buildOffering(): Offering {
    const { publisher, offering, pricing, access, limits } = this.config;
    const byCollection = new Map<string, number[]>();
    for (const doc of this.documents) {
      const prices = byCollection.get(doc.collection) ?? [];
      prices.push(microsToUsd(this.prices.documentPrice(doc)));
      byCollection.set(doc.collection, prices);
    }
    // Collections listed in the config keep the publisher's order; any others follow alphabetically.
    const configured = Object.keys(this.config.collections);
    const rank = (id: string) => (configured.includes(id) ? configured.indexOf(id) : configured.length);
    const ordered = [...byCollection].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
    const collections = ordered.map(([id, prices]): CollectionSummary => ({
      id,
      title: this.config.collections[id]?.title ?? id,
      description: this.config.collections[id]?.description,
      documents: prices.length,
      fetch_price_usd: { min: Math.min(...prices), max: Math.max(...prices) },
    }));
    const { licensee: _licensee, ...license } = this.license(undefined);
    return {
      publisher,
      title: offering.title,
      description: offering.description,
      documents: this.index.documents.size,
      collections,
      pricing: {
        search: "free",
        fetch: "per document; see fetch_price_usd for each collection",
        retrieve_passages:
          `${Math.round(pricing.passage_fraction * 100)}% of the document's price per passage, ` +
          `minimum ${formatUsd(usdToMicros(pricing.passage_min_usd))}`,
        repeat_access: `re-fetching a purchased document within ${access.entitlement_hours}h is free`,
      },
      license,
      limits: {
        daily_spend_cap_usd: limits.daily_spend_cap_usd,
        max_new_documents_per_day: limits.max_new_documents_per_day,
      },
      how_to_get_access: this.accessInstructions(),
    };
  }

  accountStatus(caller: Caller): GateResult<AccountStatus> {
    if (!caller.account) {
      return fail({
        error: "authentication_required",
        message: "No API key was sent, so there is no account to show.",
        how_to_get_access: this.accessInstructions(),
      });
    }
    const now = this.now();
    const account = this.store.getAccount(caller.account.id) ?? caller.account;
    const today = startOfUtcDay(now);
    return ok({
      account_id: account.id,
      name: account.name,
      balance_usd: microsToUsd(account.balanceMicros),
      spent_today_usd: microsToUsd(this.store.spentSinceMicros(account.id, today)),
      daily_spend_cap_usd: microsToUsd(this.dailyCap(account)),
      documents_bought_today: this.store.documentsBoughtSince(account.id, today),
      max_new_documents_per_day: this.config.limits.max_new_documents_per_day,
      owned_documents: this.store.activeEntitlements(account.id, now).map((grant) => ({
        id: grant.docId,
        title: this.index.documents.get(grant.docId)?.title ?? grant.docId,
        access_expires_at: grant.expiresAt,
      })),
      recent_charges: this.store
        .ledger({ accountId: account.id, limit: 20 })
        .filter((row) => row.kind === "charge")
        .slice(0, 10)
        .map((row) => ({
          at: row.ts,
          tool: row.tool,
          item_id: row.itemId,
          charged_usd: microsToUsd(-row.amountMicros),
          receipt_id: row.receiptId,
        })),
    });
  }

  // ---- paid tools ------------------------------------------------------------

  fetch(caller: Caller, input: { id: string; max_price_usd?: number }): GateResult<FetchResponse> {
    const now = this.now();
    const doc = this.index.documents.get(input.id);
    if (!doc) {
      return fail({ error: "not_found", message: `No document with id "${input.id}". Use search to find document ids.` });
    }
    const price = this.prices.documentPrice(doc);
    const account = caller.account;
    const balance = account ? microsToUsd(account.balanceMicros) : null;

    if (price === 0) {
      return ok(this.deliver(doc, account, { receipt_id: null, charged_usd: 0, balance_usd: balance, access: "free" }));
    }
    if (!account) {
      this.store.recordEvent({ kind: "paywall", tool: "fetch", docId: doc.id, amountMicros: price }, now);
      return fail({
        error: "authentication_required",
        message: `"${doc.title}" costs ${formatUsd(price)}. An API key is needed to buy it.`,
        price_usd: microsToUsd(price),
        how_to_get_access: this.accessInstructions(),
      });
    }
    const entitlement = this.store.activeEntitlement(account.id, doc.id, now);
    if (entitlement) {
      return ok(
        this.deliver(doc, account, {
          receipt_id: entitlement.receiptId,
          charged_usd: 0,
          balance_usd: balance,
          access: "owned",
          access_expires_at: entitlement.expiresAt,
        }),
      );
    }
    if (input.max_price_usd !== undefined && price > usdToMicros(input.max_price_usd)) {
      return fail({
        error: "price_exceeds_max",
        message: `"${doc.title}" costs ${formatUsd(price)}, above your max_price_usd of ${formatUsd(usdToMicros(input.max_price_usd))}. Nothing was charged.`,
        price_usd: microsToUsd(price),
        max_price_usd: input.max_price_usd,
      });
    }
    if (this.store.documentsBoughtSince(account.id, startOfUtcDay(now)) >= this.config.limits.max_new_documents_per_day) {
      this.store.recordEvent({ kind: "limit", accountId: account.id, tool: "fetch", docId: doc.id, amountMicros: price }, now);
      return fail({
        error: "daily_document_limit_reached",
        message:
          `This account has bought ${this.config.limits.max_new_documents_per_day} new documents today, the daily maximum. ` +
          `Documents you already own can still be fetched. For bulk access, ask the publisher about a bulk license.`,
        price_usd: microsToUsd(price),
        how_to_get_access: this.accessInstructions(),
      });
    }

    const hours = this.config.access.entitlement_hours;
    const accessUntil = hours > 0 ? new Date(now.getTime() + hours * HOUR_MS) : undefined;
    const charge = this.store.charge({
      accountId: account.id,
      lines: [{ tool: "fetch", itemId: doc.id, docId: doc.id, collection: doc.collection, amountMicros: price }],
      dailyCapMicros: this.dailyCap(account),
      now,
      grantAccessUntil: accessUntil,
    });
    if (!charge.ok) return fail(this.chargeFailure(charge, account, "fetch", [{ docId: doc.id, amountMicros: price }], now));
    return ok(
      this.deliver(doc, account, {
        receipt_id: charge.receiptId,
        charged_usd: microsToUsd(price),
        balance_usd: microsToUsd(charge.balanceAfterMicros),
        access: "purchased",
        access_expires_at: accessUntil?.toISOString(),
      }),
    );
  }

  retrievePassages(caller: Caller, input: { query: string; limit?: number; max_price_usd?: number }): GateResult<PassagesResponse> {
    const now = this.now();
    const account = caller.account;
    const limit = clamp(input.limit ?? 3, 1, this.config.access.max_passages);
    const hits = this.index.searchPassages(input.query, { limit });
    this.store.recordEvent(
      {
        kind: "search",
        accountId: account?.id,
        tool: "retrieve_passages",
        query: this.loggedQuery(input.query),
        resultCount: hits.length,
        topCoverage: Math.max(0, ...hits.map((hit) => hit.coverage)),
      },
      now,
    );

    // Passages from documents the caller already owns, or from free documents, cost nothing.
    const priced = hits.map((hit) => {
      const doc = this.index.documents.get(hit.passage.docId)!;
      const listPrice = this.prices.passagePrice(doc);
      const owned = listPrice > 0 && account !== undefined && this.store.activeEntitlement(account.id, doc.id, now) !== undefined;
      return { hit, doc, price: owned ? 0 : listPrice };
    });
    const total = priced.reduce((sum, item) => sum + item.price, 0);
    const demand = new Map<string, number>();
    for (const item of priced) {
      if (item.price > 0) demand.set(item.doc.id, (demand.get(item.doc.id) ?? 0) + item.price);
    }
    const demandByDoc = [...demand].map(([docId, amountMicros]) => ({ docId, amountMicros }));

    if (total > 0 && !account) {
      for (const { docId, amountMicros } of demandByDoc) {
        this.store.recordEvent({ kind: "paywall", tool: "retrieve_passages", docId, amountMicros }, now);
      }
      return fail({
        error: "authentication_required",
        message: `The ${hits.length} most relevant passages cost ${formatUsd(total)} in total. An API key is needed to buy them.`,
        price_usd: microsToUsd(total),
        how_to_get_access: this.accessInstructions(),
      });
    }
    if (total > 0 && input.max_price_usd !== undefined && total > usdToMicros(input.max_price_usd)) {
      return fail({
        error: "price_exceeds_max",
        message: `These ${hits.length} passages cost ${formatUsd(total)}, above your max_price_usd of ${formatUsd(usdToMicros(input.max_price_usd))}. Nothing was charged; ask for fewer passages or raise the limit.`,
        price_usd: microsToUsd(total),
        max_price_usd: input.max_price_usd,
      });
    }

    let receipt: Receipt = {
      receipt_id: null,
      charged_usd: 0,
      balance_usd: account ? microsToUsd(account.balanceMicros) : null,
      access: "free",
    };
    if (total > 0 && account) {
      const charge = this.store.charge({
        accountId: account.id,
        lines: priced
          .filter((item) => item.price > 0)
          .map((item) => ({
            tool: "retrieve_passages",
            itemId: item.hit.passage.id,
            docId: item.doc.id,
            collection: item.doc.collection,
            amountMicros: item.price,
          })),
        dailyCapMicros: this.dailyCap(account),
        now,
      });
      if (!charge.ok) return fail(this.chargeFailure(charge, account, "retrieve_passages", demandByDoc, now));
      receipt = {
        receipt_id: charge.receiptId,
        charged_usd: microsToUsd(total),
        balance_usd: microsToUsd(charge.balanceAfterMicros),
        access: "purchased",
      };
    }

    return ok({
      query: input.query,
      passages: priced.map(({ hit, doc, price }) => ({
        id: hit.passage.id,
        doc_id: doc.id,
        doc_title: doc.title,
        heading: hit.passage.heading,
        text: hit.passage.text,
        match: matchQuality(hit.coverage),
        price_usd: microsToUsd(price),
        citation: this.citation(doc),
      })),
      license: this.license(account),
      receipt,
    });
  }

  // ---- helpers ---------------------------------------------------------------

  accessInstructions(): AccessInstructions {
    const { publisher, offering, server } = this.config;
    const parts = ["Paid tools need an API key from the publisher, sent as the HTTP header 'Authorization: Bearer <key>'."];
    if (offering.buy_credits_url) parts.push(`Buy credits at ${offering.buy_credits_url}.`);
    if (publisher.contact) parts.push(`Contact ${publisher.contact} for a key or a bulk license.`);
    return {
      instructions: parts.join(" "),
      contact: publisher.contact,
      buy_credits_url: offering.buy_credits_url,
      info_url: server.public_url,
    };
  }

  private deliver(doc: KnowledgeDocument, account: Account | undefined, receipt: Receipt): FetchResponse {
    return {
      id: doc.id,
      title: doc.title,
      collection: doc.collection,
      url: doc.url,
      updated: doc.updated,
      text: doc.body,
      citation: this.citation(doc),
      license: this.license(account),
      receipt,
    };
  }

  private citation(doc: KnowledgeDocument): Citation {
    const publisher = this.config.publisher.name;
    const source = [doc.url, doc.updated && `updated ${doc.updated}`].filter(Boolean).join(", ");
    return {
      title: doc.title,
      publisher,
      url: doc.url,
      updated: doc.updated,
      attribution: `Source: "${doc.title}", ${publisher}${source ? ` (${source})` : ""}`,
    };
  }

  private license(account: Account | undefined): LicenseTerms {
    const { license } = this.config;
    return {
      name: license.name,
      url: license.url,
      ai_training: license.ai_training,
      redistribution: license.redistribution,
      max_cache_hours: license.max_cache_hours,
      attribution: license.attribution,
      licensee: account?.id ?? null,
    };
  }

  private dailyCap(account: Account): number {
    return account.dailyCapMicros ?? usdToMicros(this.config.limits.daily_spend_cap_usd);
  }

  private loggedQuery(query: string): string | null {
    return this.config.analytics.log_queries ? query : null;
  }

  private chargeFailure(
    result: Extract<ChargeResult, { ok: false }>,
    account: Account,
    tool: string,
    demand: Array<{ docId: string; amountMicros: number }>,
    now: Date,
  ): GateError {
    const kind = result.reason === "insufficient_funds" ? "paywall" : "limit";
    for (const { docId, amountMicros } of demand) {
      this.store.recordEvent({ kind, accountId: account.id, tool, docId, amountMicros }, now);
    }
    if (result.reason === "insufficient_funds") {
      return {
        error: "payment_required",
        message: `This costs ${formatUsd(result.totalMicros)} but the account balance is ${formatUsd(result.balanceMicros)}. Top up credits to continue.`,
        price_usd: microsToUsd(result.totalMicros),
        balance_usd: microsToUsd(result.balanceMicros),
        how_to_get_access: this.accessInstructions(),
      };
    }
    return {
      error: "daily_spend_cap_reached",
      message:
        `This would exceed the account's daily spend cap of ${formatUsd(result.capMicros)} ` +
        `(already spent today: ${formatUsd(result.spentTodayMicros)}). The cap resets at 00:00 UTC.`,
      price_usd: microsToUsd(result.totalMicros),
    };
  }
}
