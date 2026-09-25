import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GateResult } from "../src/gate.ts";
import { usdToMicros } from "../src/money.ts";
import { setup } from "./helpers.ts";

function value<T>(result: GateResult<T>): T {
  if (!result.ok) assert.fail(`expected success, got ${result.error.error}: ${result.error.message}`);
  return result.value;
}

function error<T>(result: GateResult<T>) {
  if (result.ok) assert.fail("expected an error");
  return result.error;
}

describe("search", () => {
  it("is free and shows price, access, match quality and a teaser", () => {
    const { gate, store } = setup();
    const { results } = gate.search({}, { query: "thrust bearing balance drum" });
    const top = results[0]!;
    assert.equal(top.id, "report-bearing");
    assert.equal(top.price_usd, 0.25);
    assert.equal(top.access, "paid");
    assert.equal(top.match, "strong");
    assert.equal(top.matched_section, "Root cause");
    assert.ok(top.snippet && top.snippet.length <= 162);
    assert.equal(store.ledger({ limit: 10 }).length, 0);
  });

  it("shows the publisher's summary instead of an excerpt when there is one", () => {
    const { gate } = setup();
    const guide = gate.search({}, { query: "cavitation suction noise" }).results.find((r) => r.id === "guide-cavitation");
    assert.equal(guide?.summary, "How to confirm cavitation at the pump.");
    assert.equal(guide?.snippet, undefined);
  });

  it("marks documents the caller owns", () => {
    const { gate, buyer, as } = setup();
    const id = buyer(1);
    value(gate.fetch(as(id), { id: "report-bearing" }));
    const top = gate.search(as(id), { query: "thrust bearing" }).results[0];
    assert.equal(top?.access, "owned");
  });
});

describe("fetch", () => {
  it("refuses anonymous callers, explains how to get access and records the paywall hit", () => {
    const { gate, store, clock } = setup();
    const err = error(gate.fetch({}, { id: "report-bearing" }));
    assert.equal(err.error, "authentication_required");
    assert.equal(err.price_usd, 0.25);
    assert.equal(err.how_to_get_access?.contact, "sales@test.example");
    const stats = store.stats(clock.now());
    assert.equal(stats.paywall7d.hits, 1);
    assert.equal(stats.paywall7d.anonymousHits, 1);
    assert.equal(stats.paywall7d.valueMicros, usdToMicros(0.25));
  });

  it("delivers free documents to anyone", () => {
    const { gate } = setup();
    const doc = value(gate.fetch({}, { id: "free-intro" }));
    assert.equal(doc.receipt.access, "free");
    assert.equal(doc.receipt.charged_usd, 0);
    assert.match(doc.text, /pumps, seals and bearings/);
  });

  it("debits the balance once and grants free re-access until the entitlement expires", () => {
    const { gate, buyer, as, balance, clock, store } = setup();
    const id = buyer(1);

    const first = value(gate.fetch(as(id), { id: "report-bearing" }));
    assert.equal(first.receipt.access, "purchased");
    assert.equal(first.receipt.charged_usd, 0.25);
    assert.equal(first.receipt.balance_usd, 0.75);
    assert.equal(first.receipt.access_expires_at, "2026-09-26T10:00:00.000Z");
    assert.equal(first.license.licensee, id);
    assert.equal(first.license.ai_training, "prohibited");
    assert.match(first.citation.attribution, /Thrust bearing failures/);
    assert.match(first.text, /worn balance drum/);

    clock.advanceHours(23);
    const again = value(gate.fetch(as(id), { id: "report-bearing" }));
    assert.equal(again.receipt.access, "owned");
    assert.equal(again.receipt.charged_usd, 0);
    assert.equal(balance(id), usdToMicros(0.75));

    clock.advanceHours(2);
    const later = value(gate.fetch(as(id), { id: "report-bearing" }));
    assert.equal(later.receipt.access, "purchased");
    assert.equal(balance(id), usdToMicros(0.5));

    const charges = store.ledger({ accountId: id, limit: 10 }).filter((row) => row.kind === "charge");
    assert.equal(charges.length, 2);
  });

  it("uses document price overrides before collection prices, and the default for unknown collections", () => {
    const { gate } = setup();
    const doc = (id: string) => gate.index.documents.get(id)!;
    assert.equal(gate.prices.documentPrice(doc("premium-benchmark")), usdToMicros(2));
    assert.equal(gate.prices.collectionPrice("benchmarks"), usdToMicros(0.05));
    assert.equal(gate.prices.documentPrice(doc("report-bearing")), usdToMicros(0.25));
  });

  it("returns payment_required and writes nothing when the balance is too low", () => {
    const { gate, buyer, as, balance, store } = setup();
    const id = buyer(0.1);
    const err = error(gate.fetch(as(id), { id: "report-bearing" }));
    assert.equal(err.error, "payment_required");
    assert.equal(err.balance_usd, 0.1);
    assert.equal(err.price_usd, 0.25);
    assert.equal(balance(id), usdToMicros(0.1));
    assert.deepEqual(store.ledger({ accountId: id, limit: 10 }).map((row) => row.kind), ["credit"]);
    assert.equal(store.activeEntitlements(id, new Date("2026-09-25T10:00:00Z")).length, 0);
  });

  it("refuses without charging when the price is above max_price_usd", () => {
    const { gate, buyer, as, balance } = setup();
    const id = buyer(5);
    const err = error(gate.fetch(as(id), { id: "premium-benchmark", max_price_usd: 1 }));
    assert.equal(err.error, "price_exceeds_max");
    assert.equal(balance(id), usdToMicros(5));
    value(gate.fetch(as(id), { id: "premium-benchmark", max_price_usd: 2 }));
  });

  it("enforces the daily spend cap across purchases and resets it at midnight UTC", () => {
    const { gate, buyer, as, balance, clock } = setup({ limits: { daily_spend_cap_usd: 0.28 } });
    const id = buyer(10);
    value(gate.fetch(as(id), { id: "report-bearing" }));
    const err = error(gate.fetch(as(id), { id: "guide-cavitation" }));
    assert.equal(err.error, "daily_spend_cap_reached");
    assert.equal(balance(id), usdToMicros(10 - 0.25));
    clock.advanceHours(14); // 00:00 UTC the next day
    value(gate.fetch(as(id), { id: "guide-cavitation" }));
  });

  it("allows spending exactly up to the daily cap", () => {
    const { gate, buyer, as } = setup({ limits: { daily_spend_cap_usd: 0.3 } });
    const id = buyer(10);
    value(gate.fetch(as(id), { id: "report-bearing" }));
    value(gate.fetch(as(id), { id: "guide-cavitation" }));
  });

  it("limits how many new documents one account can buy per day, but not re-reads", () => {
    const { gate, buyer, as } = setup({ limits: { max_new_documents_per_day: 1 } });
    const id = buyer(10);
    value(gate.fetch(as(id), { id: "report-bearing" }));
    assert.equal(error(gate.fetch(as(id), { id: "guide-cavitation" })).error, "daily_document_limit_reached");
    assert.equal(value(gate.fetch(as(id), { id: "report-bearing" })).receipt.access, "owned");
  });

  it("does not charge for unknown documents", () => {
    const { gate, buyer, as, balance } = setup();
    const id = buyer(1);
    assert.equal(error(gate.fetch(as(id), { id: "nope" })).error, "not_found");
    assert.equal(balance(id), usdToMicros(1));
  });
});

describe("retrieve_passages", () => {
  it("prices a passage as a share of its document's price", () => {
    const { gate, buyer, as, balance } = setup();
    const id = buyer(1);
    const result = value(gate.retrievePassages(as(id), { query: "worn balance drum axial thrust", limit: 1 }));
    assert.equal(result.passages[0]?.doc_id, "report-bearing");
    assert.equal(result.passages[0]?.price_usd, 0.0625);
    assert.equal(result.receipt.charged_usd, 0.0625);
    assert.equal(balance(id), usdToMicros(1 - 0.0625));
  });

  it("applies the minimum passage price", () => {
    const { gate, buyer, as } = setup({ pricing: { passage_min_usd: 0.02 } });
    const id = buyer(1);
    const result = value(gate.retrievePassages(as(id), { query: "NPSH available required", limit: 1 }));
    assert.equal(result.passages[0]?.doc_id, "guide-cavitation");
    assert.equal(result.passages[0]?.price_usd, 0.02);
  });

  it("does not charge for passages of documents the caller already owns", () => {
    const { gate, buyer, as, balance } = setup();
    const id = buyer(1);
    value(gate.fetch(as(id), { id: "report-bearing" }));
    const before = balance(id);
    const result = value(gate.retrievePassages(as(id), { query: "worn balance drum axial thrust", limit: 1 }));
    assert.equal(result.passages[0]?.price_usd, 0);
    assert.equal(result.receipt.access, "free");
    assert.equal(balance(id), before);
  });

  it("quotes the total to anonymous callers without delivering", () => {
    const { gate } = setup();
    const err = error(gate.retrievePassages({}, { query: "worn balance drum axial thrust", limit: 1 }));
    assert.equal(err.error, "authentication_required");
    assert.equal(err.price_usd, 0.0625);
  });

  it("respects max_price_usd for the whole call", () => {
    const { gate, buyer, as, balance } = setup();
    const id = buyer(5);
    const err = error(gate.retrievePassages(as(id), { query: "dual pressurised seals months", limit: 1, max_price_usd: 0.1 }));
    assert.equal(err.error, "price_exceeds_max");
    assert.equal(balance(id), usdToMicros(5));
  });
});

describe("account status and analytics", () => {
  it("shows balance, spend and owned documents", () => {
    const { gate, buyer, as } = setup();
    assert.equal(error(gate.accountStatus({})).error, "authentication_required");
    const id = buyer(1);
    value(gate.fetch(as(id), { id: "report-bearing" }));
    const status = value(gate.accountStatus(as(id)));
    assert.equal(status.balance_usd, 0.75);
    assert.equal(status.spent_today_usd, 0.25);
    assert.equal(status.documents_bought_today, 1);
    assert.deepEqual(status.owned_documents.map((d) => d.id), ["report-bearing"]);
    assert.equal(status.recent_charges.length, 1);
  });

  it("reports poorly covered searches as unmet demand", () => {
    const { gate, store, clock } = setup();
    gate.search({}, { query: "Hydrogen compressor certification" });
    gate.search({}, { query: "hydrogen compressor certification " });
    gate.search({}, { query: "thrust bearing balance drum" });
    const stats = store.stats(clock.now());
    assert.equal(stats.searches7d, 3);
    assert.deepEqual(
      stats.unmetDemand.map((q) => [q.query, q.searches]),
      [["hydrogen compressor certification", 2]],
    );
  });

  it("does not store query text when query logging is off", () => {
    const { gate, store, clock } = setup({ analytics: { log_queries: false } });
    gate.search({}, { query: "hydrogen compressor certification" });
    const stats = store.stats(clock.now());
    assert.equal(stats.searches7d, 1);
    assert.equal(stats.unmetDemand.length, 0);
  });

  it("summarises revenue, buyers and best sellers", () => {
    const { gate, store, buyer, as, clock } = setup();
    const a = buyer(5, "Alpha");
    const b = buyer(5, "Beta");
    value(gate.fetch(as(a), { id: "report-bearing" }));
    value(gate.fetch(as(b), { id: "report-bearing" }));
    value(gate.fetch(as(b), { id: "guide-cavitation" }));
    const stats = store.stats(clock.now());
    assert.equal(stats.revenue.allTimeMicros, usdToMicros(0.55));
    assert.equal(stats.accounts.active7d, 2);
    assert.equal(stats.outstandingCreditMicros, usdToMicros(10 - 0.55));
    assert.deepEqual(stats.topDocuments.map((d) => [d.docId, d.sales]), [["report-bearing", 2], ["guide-cavitation", 1]]);
    assert.equal(stats.topBuyers[0]?.name, "Beta");
  });
});

describe("store", () => {
  it("authenticates only active keys of enabled accounts, and stores keys hashed", () => {
    const { store, buyer } = setup();
    const id = buyer(0);
    const { id: keyId, key } = store.createApiKey(id);
    assert.equal(store.authenticate(key)?.id, id);
    assert.equal(store.authenticate(`${key}x`), undefined);
    const stored = store.db.prepare("SELECT key_hash FROM api_keys WHERE id = ?").get(keyId) as { key_hash: string };
    assert.notEqual(stored.key_hash, key);

    store.setAccountDisabled(id, true);
    assert.equal(store.authenticate(key), undefined);
    store.setAccountDisabled(id, false);
    store.revokeApiKey(keyId);
    assert.equal(store.authenticate(key), undefined);
  });

  it("never lets a balance go negative", () => {
    const { store, buyer } = setup();
    const id = buyer(0);
    assert.throws(() => store.db.prepare("UPDATE accounts SET balance_micros = -1 WHERE id = ?").run(id), /CHECK/);
  });
});
