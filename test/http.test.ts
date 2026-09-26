import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, type App } from "../src/app.ts";
import { usdToMicros } from "../src/money.ts";
import { testConfig } from "./helpers.ts";

const dirs: string[] = [];
const apps: App[] = [];

async function startApp(extraConfig: Record<string, unknown> = {}): Promise<{ app: App; base: string }> {
  const dir = mkdtempSync(join(tmpdir(), "pmg-http-"));
  dirs.push(dir);
  mkdirSync(join(dir, "kb", "reports"), { recursive: true });
  writeFileSync(
    join(dir, "kb", "reports", "bearing.md"),
    "---\nid: report-bearing\ntitle: Thrust bearing <failures>\n---\n## Root cause\n\nA worn balance drum increased axial thrust on the bearing.",
  );
  writeFileSync(join(dir, "kb", "intro.md"), "---\nid: intro\ncollection: about\n---\n# Intro\n\nA free introduction to pumps.");
  const app = createApp({
    loaded: {
      config: testConfig(extraConfig),
      configPath: join(dir, "gate.config.json"),
      knowledgeDir: join(dir, "kb"),
      databasePath: ":memory:",
    },
    overrides: { host: "127.0.0.1", port: 0 },
    adminToken: "s3cret",
  });
  apps.push(app);
  return { app, base: await app.listen() };
}

async function connect(base: string, apiKey?: string): Promise<Client> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return client;
}

function rawRequest(base: string, options: { path: string; method?: string; headers?: Record<string, string>; body?: string }) {
  const url = new URL(options.path, base);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { method: options.method ?? "GET", headers: options.headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
});
const mcpHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

after(async () => {
  for (const app of apps) await app.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("MCP over HTTP", () => {
  let app: App;
  let base: string;
  let key: string;

  before(async () => {
    ({ app, base } = await startApp());
    const account = app.store.createAccount({ name: "Buyer" });
    app.store.addCredit(account.id, usdToMicros(1));
    key = app.store.createApiKey(account.id).key;
  });

  it("lists the tools, with paid tools marked as not read-only and priced in their descriptions", async () => {
    const client = await connect(base);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["search", "fetch", "retrieve_passages", "get_offering", "get_account"]);
    const fetchTool = tools.find((t) => t.name === "fetch")!;
    assert.equal(fetchTool.annotations?.readOnlyHint, false);
    assert.match(fetchTool.description ?? "", /\$0\.25 per document/);
    assert.equal(tools.find((t) => t.name === "search")?.annotations?.readOnlyHint, true);
    await client.close();
  });

  it("lets anonymous agents search, and returns the paywall as a readable tool error", async () => {
    const client = await connect(base);
    const search = await client.callTool({ name: "search", arguments: { query: "balance drum thrust" } });
    const results = (search.structuredContent as { results: Array<{ id: string; access: string }> }).results;
    assert.equal(results[0]?.id, "report-bearing");
    assert.equal(results[0]?.access, "paid");

    const paywall = await client.callTool({ name: "fetch", arguments: { id: "report-bearing" } });
    assert.equal(paywall.isError, true);
    assert.equal((paywall.structuredContent as { error: string }).error, "authentication_required");
    const text = (paywall.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    assert.match(text, /API key/);
    await client.close();
  });

  it("buys a document with an API key and reports the balance", async () => {
    const client = await connect(base, key);
    const bought = await client.callTool({ name: "fetch", arguments: { id: "report-bearing" } });
    assert.equal(bought.isError, undefined);
    const receipt = (bought.structuredContent as { receipt: { access: string; charged_usd: number } }).receipt;
    assert.deepEqual([receipt.access, receipt.charged_usd], ["purchased", 0.25]);
    const account = await client.callTool({ name: "get_account", arguments: {} });
    assert.equal((account.structuredContent as { balance_usd: number }).balance_usd, 0.75);
    await client.close();
  });

  it("rejects invalid API keys with 401", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders, Authorization: "Bearer pmg_not_a_real_key" },
      body: initialize,
    });
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /invalid_token/);
  });

  it("only accepts POST on /mcp", async () => {
    const res = await fetch(`${base}/mcp`);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });

  it("rejects oversized and malformed bodies", async () => {
    const big = await rawRequest(base, { path: "/mcp", method: "POST", headers: mcpHeaders, body: "x".repeat(1_100_000) });
    assert.equal(big.status, 413);
    const bad = await rawRequest(base, { path: "/mcp", method: "POST", headers: mcpHeaders, body: "{not json" });
    assert.equal(bad.status, 400);
  });

  it("rejects Host headers other than loopback (DNS-rebinding protection)", async () => {
    const res = await rawRequest(base, { path: "/", headers: { Host: "evil.example" } });
    assert.equal(res.status, 403);
  });
});

describe("public pages", () => {
  it("serve the landing page and the machine-readable offering", async () => {
    const { base } = await startApp();
    const landing = await fetch(`${base}/`);
    assert.equal(landing.status, 200);
    assert.match(landing.headers.get("content-type") ?? "", /text\/html/);
    assert.match(landing.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const html = await landing.text();
    assert.match(html, /Test Knowledge/);
    assert.match(html, /claude mcp add --transport http/);

    const offering = (await (await fetch(`${base}/offering.json`)).json()) as { mcp_endpoint: string; documents: number };
    assert.equal(offering.mcp_endpoint, `${base}/mcp`);
    assert.equal(offering.documents, 2);
  });
});

describe("admin dashboard", () => {
  it("requires the admin token and escapes document titles", async () => {
    const { app, base } = await startApp();
    const account = app.store.createAccount({ name: "Buyer <script>" });
    app.store.addCredit(account.id, usdToMicros(1));
    const client = await connect(base, app.store.createApiKey(account.id).key);
    await client.callTool({ name: "fetch", arguments: { id: "report-bearing" } });
    await client.close();

    assert.equal((await fetch(`${base}/admin`)).status, 401);
    const wrong = await fetch(`${base}/admin`, { headers: { Authorization: `Basic ${btoa("admin:nope")}` } });
    assert.equal(wrong.status, 401);

    const ok = await fetch(`${base}/admin`, { headers: { Authorization: `Basic ${btoa("admin:s3cret")}` } });
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.match(html, /Thrust bearing &lt;failures&gt;/);
    assert.match(html, /Buyer &lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);

    const stats = (await (await fetch(`${base}/admin/stats.json`, { headers: { Authorization: "Bearer s3cret" } })).json()) as {
      revenue: { allTimeMicros: number };
    };
    assert.equal(stats.revenue.allTimeMicros, usdToMicros(0.25));
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After once an anonymous caller exceeds the limit", async () => {
    const { base } = await startApp({ limits: { anonymous_requests_per_minute: 2 } });
    const post = () => fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initialize });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200);
    const limited = await post();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  });
});
