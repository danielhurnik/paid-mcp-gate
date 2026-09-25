import type { GateConfig } from "./config.ts";
import type { KnowledgeDocument } from "./knowledge/types.ts";
import { usdToMicros } from "./money.ts";

/** Resolves prices: per-document override > collection price > default. */
export class PriceBook {
  private readonly config: GateConfig;

  constructor(config: GateConfig) {
    this.config = config;
  }

  collectionPrice(collection: string): number {
    return usdToMicros(this.config.collections[collection]?.fetch_usd ?? this.config.pricing.default_fetch_usd);
  }

  documentPrice(doc: KnowledgeDocument): number {
    return doc.priceUsd !== undefined ? usdToMicros(doc.priceUsd) : this.collectionPrice(doc.collection);
  }

  /** A passage costs a share of its document's price, with a floor; passages of free documents are free. */
  passagePrice(doc: KnowledgeDocument): number {
    const documentPrice = this.documentPrice(doc);
    if (documentPrice === 0) return 0;
    const share = Math.round(documentPrice * this.config.pricing.passage_fraction);
    return Math.min(documentPrice, Math.max(usdToMicros(this.config.pricing.passage_min_usd), share));
  }
}
