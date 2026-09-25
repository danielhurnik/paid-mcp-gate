import type { Offering } from "./gate.ts";
import { formatUsd, usdToMicros } from "./money.ts";
import type { Stats } from "./store.ts";

// Server-rendered pages with no scripts. Every dynamic value goes through esc().

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const usd = (amount: number) => formatUsd(usdToMicros(amount));
const range = ({ min, max }: { min: number; max: number }) =>
  min === max ? (min === 0 ? "Free" : usd(min)) : `${usd(min)} – ${usd(max)}`;

const STYLE = `
:root {
  --bg: #f7f7f5; --surface: #ffffff; --text: #1b1b1a; --muted: #62625d; --border: #e3e2dc;
  --accent: #1f6f5c; --accent-soft: #e4f1ec; --warn: #9a5b00; --code-bg: #f0efea;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151514; --surface: #1e1e1c; --text: #ecebe6; --muted: #a3a29b; --border: #33322f;
    --accent: #5cc3a5; --accent-soft: #1d3530; --warn: #e0a647; --code-bg: #262623;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 4px; }
h2 { font-size: 1.05rem; margin: 32px 0 12px; }
p { margin: 0 0 12px; }
.muted { color: var(--muted); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.steps strong { display: block; margin-bottom: 4px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 12px; }
.kpi .label { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
.kpi .value { font-size: 1.5rem; font-weight: 650; margin-top: 2px; font-variant-numeric: tabular-nums; }
.kpi .sub { color: var(--muted); font-size: 0.85rem; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 0.8rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem; }
pre { background: var(--code-bg); border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0 0 12px; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft);
  color: var(--accent); font-size: 0.8rem; font-weight: 600; }
.warn { color: var(--warn); }
.empty { color: var(--muted); font-style: italic; }
a { color: var(--accent); }
footer { margin-top: 40px; color: var(--muted); font-size: 0.85rem; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function table(headers: Array<[label: string, numeric?: boolean]>, rows: string[][], empty: string): string {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  const head = headers.map(([label, numeric]) => `<th${numeric ? ' class="num"' : ""}>${esc(label)}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((cell, i) => `<td${headers[i]?.[1] ? ' class="num"' : ""}>${cell}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "knowledge";
}

export function renderLanding(offering: Offering, baseUrl: string): string {
  const endpoint = `${baseUrl}/mcp`;
  const name = slug(offering.publisher.name.replace(/\(.*?\)/g, ""));
  const access = offering.how_to_get_access;
  const collections = table(
    [["Collection"], ["Documents", true], ["Price per document", true]],
    offering.collections.map((c) => [
      `<strong>${esc(c.title)}</strong>${c.description ? `<div class="muted">${esc(c.description)}</div>` : ""}`,
      esc(c.documents),
      esc(range(c.fetch_price_usd)),
    ]),
    "No documents are published yet.",
  );
  const license = offering.license;
  const mcpJson = JSON.stringify(
    { mcpServers: { [name]: { url: endpoint, headers: { Authorization: "Bearer YOUR_API_KEY" } } } },
    null,
    2,
  );
  return page(
    offering.title,
    `
<p class="muted">${esc(offering.publisher.name)}</p>
<h1>${esc(offering.title)}</h1>
<p>${esc(offering.description)}</p>
<p><span class="pill">${esc(offering.documents)} documents</span> <span class="pill">MCP endpoint</span> <code>${esc(endpoint)}</code></p>

<h2>How AI agents buy knowledge here</h2>
<div class="steps">
  <div class="card"><strong>1. Search for free</strong><span class="muted">Teasers, match quality and the price of every result, before anything is charged.</span></div>
  <div class="card"><strong>2. Pay per document or passage</strong><span class="muted">Whole documents are priced per collection; excerpts cost ${esc(offering.pricing.retrieve_passages)}. Every paid call can carry a spending cap.</span></div>
  <div class="card"><strong>3. Cite and re-read</strong><span class="muted">Every delivery carries a citation and license terms; ${esc(offering.pricing.repeat_access)}.</span></div>
</div>

<h2>Prices</h2>
${collections}

<h2>License terms</h2>
<div class="card">
  <p><strong>${license.url ? `<a href="${esc(license.url)}">${esc(license.name)}</a>` : esc(license.name)}</strong></p>
  <p class="muted">AI training: ${esc(license.ai_training)} · Redistribution: ${esc(license.redistribution)} ·
  Caching: at most ${esc(license.max_cache_hours)} hours · Attribution: ${esc(license.attribution)}</p>
</div>

<h2>Connect an agent</h2>
<p>Claude Code:</p>
<pre>claude mcp add --transport http ${esc(name)} ${esc(endpoint)} \\
  --header "Authorization: Bearer YOUR_API_KEY"</pre>
<p>Clients that take a JSON config with a URL and headers:</p>
<pre>${esc(mcpJson)}</pre>
<p class="muted">Without a key, <code>search</code> and <code>get_offering</code> still work, so an agent can see what is available before anyone pays.</p>

<h2>Get access</h2>
<div class="card">
  <p>${esc(access.instructions)}</p>
  ${access.buy_credits_url ? `<p><a href="${esc(access.buy_credits_url)}">Buy credits</a></p>` : ""}
</div>

<footer>Machine-readable offering: <a href="/offering.json">/offering.json</a> · Served by paid-mcp-gate</footer>`,
  );
}

export function renderDashboard(stats: Stats, offering: Offering, titles: ReadonlyMap<string, string>): string {
  const money = (micros: number) => esc(formatUsd(micros));
  const docLabel = (id: string) => `${esc(titles.get(id) ?? id)}<div class="muted"><code>${esc(id)}</code></div>`;
  const when = (iso: string) => esc(iso.replace("T", " ").slice(0, 16));

  const kpi = (label: string, value: string, sub: string) =>
    `<div class="card kpi"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

  return page(
    `Revenue · ${offering.title}`,
    `
<p class="muted">Publisher dashboard</p>
<h1>${esc(offering.title)}</h1>

<h2>Revenue</h2>
<div class="kpis">
  ${kpi("Last 24 hours", money(stats.revenue.last24hMicros), `All time ${money(stats.revenue.allTimeMicros)}`)}
  ${kpi("Last 7 days", money(stats.revenue.last7dMicros), `${esc(stats.paidItems7d)} paid deliveries`)}
  ${kpi("Buyers", esc(stats.accounts.total), `${esc(stats.accounts.active7d)} bought in the last 7 days`)}
  ${kpi("Prepaid, unspent", money(stats.outstandingCreditMicros), "Credit buyers hold with you")}
  ${kpi("Searches (7 days)", esc(stats.searches7d), "Free for agents; every query is demand data")}
  ${kpi(
    "Paywall hits (7 days)",
    esc(stats.paywall7d.hits),
    `<span class="warn">${money(stats.paywall7d.valueMicros)} of demand not converted</span>, ${esc(stats.paywall7d.anonymousHits)} from agents with no key`,
  )}
</div>

<h2>Best-selling documents</h2>
${table(
  [["Document"], ["Collection"], ["Sales", true], ["Revenue", true]],
  stats.topDocuments.map((d) => [docLabel(d.docId), esc(d.collection), esc(d.sales), money(d.revenueMicros)]),
  "No sales yet.",
)}

<h2>Top buyers</h2>
${table(
  [["Buyer"], ["Paid items", true], ["Spend", true]],
  stats.topBuyers.map((b) => [`${esc(b.name)}<div class="muted"><code>${esc(b.accountId)}</code></div>`, esc(b.items), money(b.spendMicros)]),
  "No buyers yet.",
)}

<h2>Unmet demand: what agents asked for that you don't cover well</h2>
<p class="muted">Searches in the last 30 days whose best result matched less than half of the query. Each one is a candidate for new content.</p>
${table(
  [["Query"], ["Searches", true], ["Best coverage", true], ["Last seen"]],
  stats.unmetDemand.map((q) => [esc(q.query), esc(q.searches), `${esc(Math.round(q.bestCoverage * 100))}%`, when(q.lastSeen)]),
  "Nothing yet. Queries appear here when the corpus cannot answer them.",
)}

<h2>Paywall hits by document</h2>
<p class="muted">Agents that wanted a document but had no key or not enough credit: leads for your sales team.</p>
${table(
  [["Document"], ["Hits", true], ["No key", true], ["Last seen"]],
  stats.paywallByDocument.map((d) => [docLabel(d.docId), esc(d.hits), esc(d.anonymousHits), when(d.lastSeen)]),
  "No paywall hits in the last 30 days.",
)}

<h2>Recent ledger entries</h2>
${table(
  [["Time (UTC)"], ["Buyer"], ["Item"], ["Amount", true]],
  stats.recent.map((r) => [
    when(r.ts),
    esc(r.accountName),
    r.kind === "credit" ? `<span class="pill">credit</span> ${esc(r.note ?? "")}` : `${esc(r.tool)} · <code>${esc(r.itemId)}</code>`,
    money(r.amountMicros),
  ]),
  "The ledger is empty.",
)}

<footer>JSON: <a href="/admin/stats.json">/admin/stats.json</a> · Served by paid-mcp-gate</footer>`,
  );
}
