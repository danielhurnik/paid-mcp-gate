// A scripted walk-through: an AI agent discovers the knowledge base, hits the
// paywall, gets a key, buys knowledge, and the publisher sees the result.
// Runs against a real server and a throwaway database: npm run demo

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { FetchResponse, GateError, PassagesResponse, SearchResponse } from "../src/gate.ts";
import { formatUsd, usdToMicros } from "../src/money.ts";

const configPath = fileURLToPath(new URL("../examples/tarnwick/gate.config.json", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "pmg-demo-"));
const app = createApp({
  loaded: loadConfig(configPath),
  overrides: { host: "127.0.0.1", port: 0, databasePath: join(tmp, "demo.db") },
});
const baseUrl = await app.listen();

const usd = (amount: number) => formatUsd(usdToMicros(amount));
const rule = "─".repeat(76);
let stepNumber = 0;
const step = (title: string) => console.log(`\n${rule}\n${++stepNumber}. ${title}\n${rule}`);
const agent = (text: string) => console.log(`  agent → ${text}`);
const gate = (text: string) => console.log(`  gate  ← ${text}`);
const note = (text: string) => console.log(`          ${text}`);

async function connect(apiKey?: string): Promise<Client> {
  const client = new Client({ name: "acme-maintenance-copilot", version: "1.0.0" });
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers } }));
  return client;
}

async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return result.isError
    ? { ok: false as const, error: result.structuredContent as GateError }
    : { ok: true as const, value: result.structuredContent as T };
}

try {
  console.log(`paid-mcp-gate demo: ${baseUrl}/mcp, sample knowledge base "Tarnwick Pump Reliability" (fictional)`);

  step("An AI agent finds the server and looks around, with no API key");
  const anonymous = await connect();
  const { tools } = await anonymous.listTools();
  for (const tool of tools) gate(`${tool.name.padEnd(18)} ${tool.title ?? ""}`);

  step("It searches for free");
  const question = "boiler feed pump thrust bearing keeps failing";
  agent(`search("${question}")`);
  const search = await call<SearchResponse>(anonymous, "search", { query: question, limit: 3 });
  if (!search.ok) throw new Error(search.error.message);
  for (const r of search.value.results) {
    gate(`[${r.match.padEnd(7)}] ${r.title}`);
    note(`${r.price_usd ? usd(r.price_usd) : "free"} · matched section "${r.matched_section}"`);
    note(`teaser: "${r.summary ?? r.snippet}"`);
  }
  const best = search.value.results[0];
  if (!best) throw new Error("Expected a search result");

  step("It tries to read the best match: the paywall explains how to get access");
  agent(`fetch("${best.id}")`);
  const denied = await call<FetchResponse>(anonymous, "fetch", { id: best.id });
  if (denied.ok) throw new Error("Expected the paywall");
  gate(`${denied.error.error}: ${denied.error.message}`);
  note(denied.error.how_to_get_access?.instructions ?? "");
  await anonymous.close();

  step("The publisher onboards the buyer (npm run pmg -- account create ...)");
  const account = app.store.createAccount({ name: "Acme Maintenance Copilot", email: "ai-team@acme.example" });
  app.store.addCredit(account.id, usdToMicros(2), "prepaid credit");
  const { key } = app.store.createApiKey(account.id, "production agent");
  note(`account ${account.id} with ${usd(2)} prepaid credit, API key ${key.slice(0, 10)}…`);

  const buyer = await connect(key);
  step("With a key, the agent buys the failure analysis");
  agent(`fetch("${best.id}")`);
  const bought = await call<FetchResponse>(buyer, "fetch", { id: best.id });
  if (!bought.ok) throw new Error(bought.error.message);
  gate(`${bought.value.receipt.access}: charged ${usd(bought.value.receipt.charged_usd)}, balance ${usd(bought.value.receipt.balance_usd ?? 0)}`);
  note(`receipt ${bought.value.receipt.receipt_id}, free re-access until ${bought.value.receipt.access_expires_at}`);
  note(`license: AI training ${bought.value.license.ai_training}, cache at most ${bought.value.license.max_cache_hours}h, licensee ${bought.value.license.licensee}`);
  note(`cite as: ${bought.value.citation.attribution}`);
  const lesson = bought.value.text.split("## Lesson")[1]?.trim().split("\n")[0] ?? "";
  note(`what it learned: "${lesson}"`);

  step("Later it needs the document again: already owned, nothing charged");
  const again = await call<FetchResponse>(buyer, "fetch", { id: best.id });
  if (!again.ok) throw new Error(again.error.message);
  gate(`${again.value.receipt.access}: charged ${usd(again.value.receipt.charged_usd)}`);

  step("It needs one number, so it buys two passages instead of a whole report");
  const factQuestion = "median MTBF of a dual pressurised Plan 53A seal in light hydrocarbons";
  agent(`retrieve_passages("${factQuestion}", limit 2, max_price_usd 1.00)`);
  const passages = await call<PassagesResponse>(buyer, "retrieve_passages", { query: factQuestion, limit: 2, max_price_usd: 1 });
  if (!passages.ok) throw new Error(passages.error.message);
  for (const p of passages.value.passages) gate(`${usd(p.price_usd)} · ${p.doc_title} › ${p.heading}`);
  gate(`charged ${usd(passages.value.receipt.charged_usd)}, balance ${usd(passages.value.receipt.balance_usd ?? 0)}`);

  step("Spending guardrail: the agent refuses to pay more than it was allowed to");
  agent(`fetch("tpr-bm-seal-mtbf-2025", max_price_usd 0.50)`);
  const capped = await call<FetchResponse>(buyer, "fetch", { id: "tpr-bm-seal-mtbf-2025", max_price_usd: 0.5 });
  gate(capped.ok ? "unexpectedly delivered" : `${capped.error.error}: ${capped.error.message}`);

  step("Out of credit: the paywall asks for a top-up");
  agent(`fetch("tpr-bm-seal-mtbf-2025")`);
  const broke = await call<FetchResponse>(buyer, "fetch", { id: "tpr-bm-seal-mtbf-2025" });
  gate(broke.ok ? "unexpectedly delivered" : `${broke.error.error}: ${broke.error.message}`);

  step("A question the knowledge base cannot answer");
  const gap = "ATEX certification for hydrogen compressors";
  agent(`search("${gap}")`);
  const weak = await call<SearchResponse>(buyer, "search", { query: gap });
  if (!weak.ok) throw new Error(weak.error.message);
  gate(weak.value.results.length ? `only ${weak.value.results[0]?.match} matches` : "no results");
  await buyer.close();

  step("What the publisher sees (the /admin dashboard shows the same data)");
  const stats = app.store.stats();
  note(`revenue: ${formatUsd(stats.revenue.allTimeMicros)} from ${stats.paidItems7d} paid deliveries`);
  note(`prepaid credit not yet spent: ${formatUsd(stats.outstandingCreditMicros)}`);
  note(`paywall hits: ${stats.paywall7d.hits} (${formatUsd(stats.paywall7d.valueMicros)} of demand not converted)`);
  for (const d of stats.topDocuments) note(`best seller: ${d.docId} · ${d.sales} sale(s) · ${formatUsd(d.revenueMicros)}`);
  for (const q of stats.unmetDemand) note(`content gap: "${q.query}" (best coverage ${Math.round(q.bestCoverage * 100)}%)`);
  console.log(`\nRun it for real: PMG_ADMIN_TOKEN=secret npm start, then open http://localhost:8787/ and /admin\n`);
} finally {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
}
