import { parseConfig, type GateConfig } from "../src/config.ts";
import { Gate } from "../src/gate.ts";
import type { KnowledgeDocument } from "../src/knowledge/types.ts";
import { usdToMicros } from "../src/money.ts";
import { Store, type Account } from "../src/store.ts";

export const DOCS: KnowledgeDocument[] = [
  {
    id: "free-intro",
    title: "Introduction",
    collection: "about",
    body: "# Introduction\n\nThis knowledge base covers pumps, seals and bearings.",
  },
  {
    id: "guide-cavitation",
    title: "Cavitation checklist",
    collection: "guides",
    summary: "How to confirm cavitation at the pump.",
    body:
      "## Symptoms\n\nCrackling noise near the suction nozzle and fluctuating discharge pressure.\n\n" +
      "## Checks\n\nMeasure suction pressure and compare NPSH available with NPSH required.",
  },
  {
    id: "report-bearing",
    title: "Thrust bearing failures",
    collection: "reports",
    body:
      "## Evidence\n\nThe babbitt on the active thrust pads was wiped and the leak-off flow had risen for months " +
      "before anyone noticed the trend in the plant historian.\n\n" +
      "## Root cause\n\nA worn balance drum increased the axial thrust carried by the thrust bearing.",
  },
  {
    id: "premium-benchmark",
    title: "Seal MTBF benchmark",
    collection: "benchmarks",
    priceUsd: 2,
    body: "## Table\n\nDual pressurised seals last 51 months in light hydrocarbon service.",
  },
];

export function testConfig(extra: Record<string, unknown> = {}): GateConfig {
  return parseConfig({
    publisher: { name: "Test Publisher", contact: "sales@test.example" },
    offering: { title: "Test Knowledge", description: "A test offering." },
    collections: { about: { fetch_usd: 0 }, guides: { fetch_usd: 0.05 }, reports: { fetch_usd: 0.25 } },
    ...extra,
  });
}

export class Clock {
  current = new Date("2026-09-25T10:00:00.000Z");
  now = (): Date => new Date(this.current);
  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 3_600_000);
  }
}

export function setup(extra: Record<string, unknown> = {}) {
  const clock = new Clock();
  const store = new Store(":memory:");
  const gate = new Gate({ config: testConfig(extra), documents: DOCS, store, now: clock.now });
  /** Creates a buyer with the given prepaid credit. */
  const buyer = (usd: number, name = "Buyer"): string => {
    const account = store.createAccount({ name, now: clock.now() });
    if (usd > 0) store.addCredit(account.id, usdToMicros(usd), "test credit", clock.now());
    return account.id;
  };
  /** Like the HTTP layer: a fresh account snapshot per call. */
  const as = (accountId: string): { account: Account } => ({ account: store.getAccount(accountId)! });
  const balance = (accountId: string): number => store.getAccount(accountId)!.balanceMicros;
  return { clock, store, gate, buyer, as, balance };
}
