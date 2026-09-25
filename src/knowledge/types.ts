export interface KnowledgeDocument {
  id: string;
  title: string;
  collection: string;
  /** Full Markdown body. Only ever returned to a caller who is entitled to it. */
  body: string;
  url?: string;
  /** ISO date of the last revision. */
  updated?: string;
  /** Optional publisher-written abstract that is safe to show for free. */
  summary?: string;
  /** Per-document price override in USD. */
  priceUsd?: number;
}

/** A section-sized excerpt of a document; the unit of search and of passage sales. */
export interface Passage {
  id: string;
  docId: string;
  heading: string;
  text: string;
}
