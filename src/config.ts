import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const Usd = z.number().min(0).max(10_000);

// Sections use .prefault({}) so that an omitted section is parsed through its
// schema and picks up every field default (zod 4's .default() would not).
export const ConfigSchema = z.object({
  publisher: z.object({
    name: z.string().min(1),
    url: z.url().optional(),
    contact: z.string().optional(),
  }),
  offering: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    buy_credits_url: z.url().optional(),
  }),
  knowledge: z
    .object({
      format: z.literal("markdown").default("markdown"),
      path: z.string().default("kb"),
    })
    .prefault({}),
  collections: z
    .record(
      z.string(),
      z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        fetch_usd: Usd.optional(),
      }),
    )
    .default({}),
  pricing: z
    .object({
      default_fetch_usd: Usd.default(0.05),
      // A passage costs this share of its document's price (never less than
      // passage_min_usd), so excerpts stay cheaper than whole documents.
      passage_fraction: z.number().min(0).max(1).default(0.25),
      passage_min_usd: Usd.default(0.01),
    })
    .prefault({}),
  license: z
    .object({
      name: z.string().default("Per-query reference license"),
      url: z.url().optional(),
      ai_training: z.enum(["prohibited", "permitted"]).default("prohibited"),
      redistribution: z.enum(["prohibited", "permitted-with-attribution"]).default("prohibited"),
      max_cache_hours: z.number().int().min(0).default(24),
      attribution: z.enum(["required", "optional"]).default("required"),
    })
    .prefault({}),
  access: z
    .object({
      // A purchased document can be re-fetched for free for this long.
      entitlement_hours: z.number().int().min(0).max(24 * 365).default(24),
      teaser_chars: z.number().int().min(40).max(600).default(160),
      max_search_results: z.number().int().min(1).max(50).default(10),
      max_passages: z.number().int().min(1).max(20).default(5),
    })
    .prefault({}),
  limits: z
    .object({
      requests_per_minute: z.number().int().min(1).default(120),
      anonymous_requests_per_minute: z.number().int().min(1).default(30),
      daily_spend_cap_usd: Usd.default(100),
      // Bulk-export protection: a buyer who wants the whole corpus should
      // sign a bulk license rather than buy it one document at a time.
      max_new_documents_per_day: z.number().int().min(1).default(200),
    })
    .prefault({}),
  analytics: z
    .object({
      log_queries: z.boolean().default(true),
    })
    .prefault({}),
  server: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(0).max(65_535).default(8787),
      public_url: z.url().optional(),
      trust_proxy: z.boolean().default(false),
      allowed_hosts: z.array(z.string()).optional(),
    })
    .prefault({}),
  database: z
    .object({
      path: z.string().default("data/gate.db"),
    })
    .prefault({}),
});

export type GateConfig = z.output<typeof ConfigSchema>;

export interface LoadedConfig {
  config: GateConfig;
  configPath: string;
  knowledgeDir: string;
  databasePath: string;
}

export function parseConfig(raw: unknown, source = "config"): GateConfig {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ${source}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Loads a JSON config file. Relative paths inside it resolve against the file's directory. */
export function loadConfig(configPath: string): LoadedConfig {
  const absolute = resolve(configPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (err) {
    throw new Error(`Could not read config ${absolute}: ${(err as Error).message}`);
  }
  const config = parseConfig(raw, `config ${absolute}`);
  const dir = dirname(absolute);
  return {
    config,
    configPath: absolute,
    knowledgeDir: resolve(dir, config.knowledge.path),
    databasePath: config.database.path === ":memory:" ? ":memory:" : resolve(dir, config.database.path),
  };
}
