import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Gate } from "./gate.ts";
import { createMcpServer } from "./mcp.ts";
import { renderDashboard, renderLanding } from "./pages.ts";
import { RateLimiter } from "./ratelimit.ts";
import type { Account, Store } from "./store.ts";

export interface HttpOptions {
  gate: Gate;
  store: Store;
  /** Enables /admin when set. */
  adminToken?: string;
  limiter?: RateLimiter;
}

const MAX_BODY_BYTES = 1_000_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createHttpServer(options: HttpOptions): Server {
  const { gate, store } = options;
  const config = gate.config;
  const limiter = options.limiter ?? new RateLimiter();
  // Loopback deployments only answer to loopback Host headers, which blocks DNS-rebinding attacks.
  const allowedHosts =
    config.server.allowed_hosts?.map((h) => h.toLowerCase()) ??
    (LOOPBACK.has(config.server.host) ? ["localhost", "127.0.0.1", "[::1]"] : undefined);

  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      console.error("paid-mcp-gate: request failed", err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
      else res.end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host)) return sendJson(res, 403, { error: "host_not_allowed" });
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/mcp") return handleMcp(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "method_not_allowed" });
    }
    switch (path) {
      case "/":
        return sendHtml(res, renderLanding(gate.offering(), baseUrl(req)));
      case "/offering.json":
        return sendJson(res, 200, { ...gate.offering(), mcp_endpoint: `${baseUrl(req)}/mcp` });
      case "/health":
        return sendJson(res, 200, { ok: true, documents: gate.index.documents.size });
      case "/admin":
      case "/admin/stats.json": {
        if (!options.adminToken) {
          return sendJson(res, 404, { error: "admin_disabled", message: "Set PMG_ADMIN_TOKEN to enable the dashboard." });
        }
        if (!adminAuthorized(req.headers.authorization, options.adminToken)) {
          res.setHeader("WWW-Authenticate", 'Basic realm="paid-mcp-gate admin", charset="UTF-8"');
          return sendJson(res, 401, { error: "unauthorized" });
        }
        res.setHeader("Cache-Control", "no-store");
        const stats = store.stats();
        if (path === "/admin/stats.json") return sendJson(res, 200, stats);
        const titles = new Map(gate.documents.map((doc) => [doc.id, doc.title]));
        return sendHtml(res, renderDashboard(stats, gate.offering(), titles));
      }
      default:
        return sendJson(res, 404, { error: "not_found" });
    }
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      // Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, jsonRpcError(-32000, "Method not allowed. Send JSON-RPC requests with POST."));
    }

    let account: Account | undefined;
    const presented = readApiKey(req);
    if (presented !== undefined) {
      account = store.authenticate(presented);
      if (!account) {
        res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
        return sendJson(res, 401, jsonRpcError(-32001, "Invalid or revoked API key."));
      }
    }

    const perMinute = account ? config.limits.requests_per_minute : config.limits.anonymous_requests_per_minute;
    const verdict = limiter.take(account ? `acct:${account.id}` : `ip:${clientIp(req)}`, perMinute);
    if (!verdict.ok) {
      res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
      return sendJson(res, 429, jsonRpcError(-32002, `Rate limit exceeded. Retry in ${verdict.retryAfterSeconds}s.`));
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 400;
      return sendJson(res, status, jsonRpcError(-32700, (err as Error).message));
    }

    // One server and transport per request: each request is bound to its caller.
    const mcp = createMcpServer(gate, { account });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  function hostAllowed(host: string | undefined): boolean {
    if (!allowedHosts) return true;
    if (!host) return false;
    const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
    return allowedHosts.includes(hostname.toLowerCase());
  }

  function baseUrl(req: IncomingMessage): string {
    if (config.server.public_url) return config.server.public_url.replace(/\/+$/, "");
    const proto = config.server.trust_proxy ? firstHeader(req.headers["x-forwarded-proto"]) ?? "http" : "http";
    return `${proto}://${req.headers.host ?? `localhost:${config.server.port}`}`;
  }

  function clientIp(req: IncomingMessage): string {
    if (config.server.trust_proxy) {
      const forwarded = firstHeader(req.headers["x-forwarded-for"])?.split(",")[0]?.trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  return server;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Accepts "Authorization: Bearer <key>" or "X-API-Key: <key>". */
function readApiKey(req: IncomingMessage): string | undefined {
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? "");
  if (bearer) return bearer[1];
  const header = firstHeader(req.headers["x-api-key"])?.trim();
  return header ? header : undefined;
}

function adminAuthorized(header: string | undefined, token: string): boolean {
  if (!header) return false;
  let presented: string | undefined;
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const basic = /^Basic\s+(\S+)\s*$/i.exec(header);
  if (bearer) presented = bearer[1];
  else if (basic) {
    const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
    presented = decoded.slice(decoded.indexOf(":") + 1);
  }
  if (presented === undefined) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(token));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  // Keep draining past the limit (without buffering): leaving the loop early
  // destroys the socket, and the client would never see the 413.
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk as Buffer);
  }
  if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, HTML_HEADERS);
  res.end(html);
}
