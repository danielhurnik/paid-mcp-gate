import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Caller, Gate, GateResult } from "./gate.ts";
import { formatUsd, usdToMicros } from "./money.ts";

export const SERVER_NAME = "paid-mcp-gate";
export const SERVER_VERSION = "0.1.0";

// No outputSchema on these tools on purpose: MCP SDK clients validate
// structuredContent against it even on isError results, which would turn a
// paywall response into a client-side exception instead of a message the
// model can read and act on.
function toolResult(data: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  };
}

function fromGate<T extends Record<string, unknown>>(result: GateResult<T>): CallToolResult {
  return result.ok ? toolResult(result.value) : toolResult(result.error, true);
}

function priceRange(min: number, max: number): string {
  const [low, high] = [formatUsd(usdToMicros(min)), formatUsd(usdToMicros(max))];
  return low === high ? low : `${low}–${high}`;
}

/** Builds an MCP server whose tools act on behalf of one caller (one HTTP request). */
export function createMcpServer(gate: Gate, caller: Caller): McpServer {
  const offering = gate.offering();
  const { access, pricing } = gate.config;
  const collectionIds = offering.collections.map((c) => c.id);
  const allPrices = offering.collections.flatMap((c) => [c.fetch_price_usd.min, c.fetch_price_usd.max]);
  const paidPrices = allPrices.filter((p) => p > 0);
  const fetchRange = paidPrices.length ? priceRange(Math.min(...paidPrices), Math.max(...paidPrices)) : "free";
  const passageShare = `${Math.round(pricing.passage_fraction * 100)}%`;
  const pricingMeta = (model: string) => ({
    "paid-mcp-gate/pricing": { model, currency: "USD", offering_url: gate.config.server.public_url },
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: offering.title },
    {
      instructions: [
        `${offering.title}: licensed knowledge from ${offering.publisher.name}.`,
        offering.description,
        "Call search first; it is free and shows each document's price and match quality. Then buy either a whole " +
          "document with fetch, or only the most relevant excerpts with retrieve_passages. Paid tools charge the " +
          "caller's prepaid account; pass max_price_usd to cap what a single call may spend.",
        "Content is licensed for answering questions: cite the source, do not use it to train models, and do not " +
          `cache it for longer than ${gate.config.license.max_cache_hours} hours.`,
      ].join("\n\n"),
    },
  );

  const collectionSchema = collectionIds.length
    ? z.enum(collectionIds as [string, ...string[]])
    : z.string();

  server.registerTool(
    "search",
    {
      title: "Search the knowledge base (free)",
      description:
        `Free. Searches ${offering.publisher.name}'s knowledge base and returns matching documents with a short ` +
        "teaser, a match rating (strong/partial/weak) and the price to read each one in full. Use this before paying.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("What you are looking for, in natural language or keywords."),
        collection: collectionSchema.optional().describe("Only search this collection."),
        limit: z.number().int().min(1).max(access.max_search_results).optional().describe("Maximum results (default 5)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => toolResult(gate.search(caller, args)),
  );

  server.registerTool(
    "fetch",
    {
      title: "Buy and read a full document (paid)",
      description:
        `Paid: ${fetchRange} per document, charged to your prepaid account (search results show each exact price). ` +
        `Returns the full text with a citation and license terms. Fetching a document you bought in the last ` +
        `${access.entitlement_hours} hours is free. Set max_price_usd to refuse anything more expensive.`,
      inputSchema: {
        id: z.string().min(1).max(200).describe("Document id from search results."),
        max_price_usd: z.number().min(0).optional().describe("Refuse without charging if the price is higher than this."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: pricingMeta("per_document"),
    },
    async (args) => fromGate(gate.fetch(caller, args)),
  );

  server.registerTool(
    "retrieve_passages",
    {
      title: "Buy the most relevant passages (paid)",
      description:
        `Paid: returns the passages most relevant to a question, each priced at ${passageShare} of its document's ` +
        `price (minimum ${formatUsd(usdToMicros(pricing.passage_min_usd))}). Cheaper than fetch when you need a ` +
        "specific fact. Passages from documents you already own are free. Set max_price_usd to cap the total.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("The question or topic to find passages for."),
        limit: z.number().int().min(1).max(access.max_passages).optional().describe("Number of passages (default 3)."),
        max_price_usd: z.number().min(0).optional().describe("Refuse without charging if the total is higher than this."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: pricingMeta("per_passage"),
    },
    async (args) => fromGate(gate.retrievePassages(caller, args)),
  );

  server.registerTool(
    "get_offering",
    {
      title: "Show what is for sale (free)",
      description: "Free. Describes the publisher, the collections, prices, license terms and how to get an API key.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolResult(offering),
  );

  server.registerTool(
    "get_account",
    {
      title: "Show my balance and purchases (free)",
      description: "Free. Shows the caller's prepaid balance, today's spend against the daily cap, and documents currently owned.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => fromGate(gate.accountStatus(caller)),
  );

  return server;
}
