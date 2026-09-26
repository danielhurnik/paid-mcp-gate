import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createApp } from "./app.ts";
import { loadConfig, type LoadedConfig } from "./config.ts";
import { loadMarkdownDirectory } from "./knowledge/markdown.ts";
import { formatUsd, usdToMicros } from "./money.ts";
import { PriceBook } from "./pricing.ts";
import { Store } from "./store.ts";

const HELP = `paid-mcp-gate: sell access to a knowledge base to AI agents over MCP

Usage: npm run pmg -- <command> [options]

Commands
  serve                               Start the gateway (MCP endpoint at /mcp)
  docs                                List the published documents and their prices
  account create --name <name> [--email <email>] [--credit <usd>] [--daily-cap <usd>]
                                      Create a buyer account and print its first API key
  account list                        List buyer accounts and balances
  account disable|enable --account <id>
  key create --account <id> [--label <text>]
  key revoke --id <key id>
  credit add --account <id> --usd <amount> [--note <text>]
  stats                               Revenue and demand analytics as JSON

Options
  --config <path>    Config file. Default: $PMG_CONFIG, then ./gate.config.json,
                     then the bundled example (examples/tarnwick/gate.config.json)
  --db <path>        Use this SQLite database instead of the configured one
  --host <address>   Listen address for serve
  --port <number>    Listen port for serve (the PORT environment variable also works)

Environment
  PMG_ADMIN_TOKEN    Enables the /admin revenue dashboard (HTTP Basic auth, any username)
`;

const EXAMPLE_CONFIG = fileURLToPath(new URL("../examples/tarnwick/gate.config.json", import.meta.url));

function resolveConfig(flag: string | undefined): LoadedConfig {
  const explicit = flag ?? process.env.PMG_CONFIG;
  if (explicit) return loadConfig(explicit);
  if (existsSync("gate.config.json")) return loadConfig("gate.config.json");
  console.error(`No gate.config.json here; using the bundled example (${EXAMPLE_CONFIG}).`);
  return loadConfig(EXAMPLE_CONFIG);
}

function requireFlag(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing --${name}. Run with --help for usage.`);
  return value;
}

function parseUsd(value: string, name: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`--${name} must be a non-negative number of USD`);
  return usdToMicros(amount);
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      db: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      credit: { type: "string" },
      "daily-cap": { type: "string" },
      account: { type: "string" },
      label: { type: "string" },
      id: { type: "string" },
      usd: { type: "string" },
      note: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, sub] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  const loaded = resolveConfig(values.config);
  const databasePath = values.db ?? loaded.databasePath;

  if (command === "serve") {
    const portValue = values.port ?? process.env.PORT;
    const port = portValue === undefined ? undefined : Number(portValue);
    if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port < 65_536)) throw new Error("Invalid port");
    const adminToken = process.env.PMG_ADMIN_TOKEN || undefined;
    const app = createApp({ loaded, overrides: { host: values.host, port, databasePath }, adminToken });
    const url = await app.listen();
    const offering = app.gate.offering();
    console.log(`paid-mcp-gate is serving "${offering.title}" (${offering.documents} documents)`);
    console.log(`  MCP endpoint   ${url}/mcp`);
    console.log(`  Landing page   ${url}/`);
    console.log(`  Dashboard      ${adminToken ? `${url}/admin` : "disabled; set PMG_ADMIN_TOKEN to enable"}`);
    console.log(`  Ledger         ${databasePath}`);
    const shutdown = () => void app.close().then(() => process.exit(0));
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  if (command === "docs") {
    const prices = new PriceBook(loaded.config);
    const rows = loadMarkdownDirectory(loaded.knowledgeDir).map((doc) => ({
      id: doc.id,
      collection: doc.collection,
      price: formatUsd(prices.documentPrice(doc)),
      passage: formatUsd(prices.passagePrice(doc)),
      title: doc.title.length > 60 ? `${doc.title.slice(0, 59)}…` : doc.title,
    }));
    console.table(rows);
    return;
  }

  const store = new Store(databasePath);
  try {
    switch (`${command} ${sub ?? ""}`.trim()) {
      case "account create": {
        const account = store.createAccount({
          name: requireFlag(values.name, "name"),
          email: values.email,
          dailyCapMicros: values["daily-cap"] ? parseUsd(values["daily-cap"], "daily-cap") : undefined,
        });
        const key = store.createApiKey(account.id, "default");
        const credit = values.credit ? parseUsd(values.credit, "credit") : 0;
        if (credit > 0) store.addCredit(account.id, credit, "initial credit");
        console.log(`Created account ${account.id} (${account.name})`);
        console.log(`Balance: ${formatUsd(credit)}`);
        console.log(`API key (shown only once; give it to the buyer): ${key.key}`);
        return;
      }
      case "account list":
        console.table(
          store.listAccounts().map((a) => ({
            id: a.id,
            name: a.name,
            balance: formatUsd(a.balanceMicros),
            daily_cap: a.dailyCapMicros === null ? "default" : formatUsd(a.dailyCapMicros),
            status: a.disabledAt ? "disabled" : "active",
          })),
        );
        return;
      case "account disable":
      case "account enable": {
        const id = requireFlag(values.account, "account");
        if (!store.setAccountDisabled(id, sub === "disable")) throw new Error(`Unknown account ${id}`);
        console.log(`Account ${id} ${sub}d.`);
        return;
      }
      case "key create": {
        const key = store.createApiKey(requireFlag(values.account, "account"), values.label);
        console.log(`Created key ${key.id}`);
        console.log(`API key (shown only once): ${key.key}`);
        return;
      }
      case "key revoke": {
        const id = requireFlag(values.id, "id");
        if (!store.revokeApiKey(id)) throw new Error(`No active key ${id}`);
        console.log(`Revoked ${id}.`);
        return;
      }
      case "credit add": {
        const id = requireFlag(values.account, "account");
        const result = store.addCredit(id, parseUsd(requireFlag(values.usd, "usd"), "usd"), values.note);
        console.log(`Credited ${id}. New balance: ${formatUsd(result.balanceMicros)} (receipt ${result.receiptId})`);
        return;
      }
      case "stats":
        console.log(JSON.stringify(store.stats(), null, 2));
        return;
      default:
        throw new Error(`Unknown command "${positionals.join(" ")}". Run with --help for usage.`);
    }
  } finally {
    store.close();
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
