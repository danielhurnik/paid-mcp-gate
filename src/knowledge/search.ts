import type { KnowledgeDocument, Passage } from "./types.ts";

// BM25 over passages. Small, dependency-free and good enough for corpora of a
// few thousand documents; swap in a vector or hybrid index behind the same
// interface when a customer's corpus outgrows it.

const K1 = 1.2;
const B = 0.75;

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in into is it its " +
    "may me more most must my no not of on or our so such than that the their them then there these they this " +
    "those to too under up us very was we were what when where which while who why will with would you your"
  ).split(" "),
);

/** A deliberately small suffix stripper: consistent for plurals and -ing/-ed forms. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);

  if (w.length > 5 && w.endsWith("ing") && /[aeiouy]/.test(w.slice(0, -3))) w = undouble(w.slice(0, -3));
  else if (w.length > 5 && w.endsWith("ed") && !w.endsWith("eed") && /[aeiouy]/.test(w.slice(0, -2))) {
    w = undouble(w.slice(0, -2));
  }
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function undouble(w: string): string {
  return /([^aeiouylsz])\1$/.test(w) ? w.slice(0, -1) : w;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    tokens.push(stem(word));
  }
  return tokens;
}

export interface PassageHit {
  passage: Passage;
  score: number;
  /** Share of distinct query terms found in the passage, 0..1. */
  coverage: number;
}

export interface DocumentHit {
  doc: KnowledgeDocument;
  best: PassageHit;
}

export interface SearchOptions {
  limit: number;
  collection?: string;
}

export class SearchIndex {
  readonly documents: ReadonlyMap<string, KnowledgeDocument>;
  readonly passages: readonly Passage[];
  private readonly postings = new Map<string, Array<{ index: number; tf: number }>>();
  private readonly lengths: number[] = [];
  private readonly avgLength: number;

  constructor(documents: KnowledgeDocument[], passages: Passage[]) {
    this.documents = new Map(documents.map((doc) => [doc.id, doc]));
    this.passages = passages;
    passages.forEach((passage, index) => {
      const doc = this.documents.get(passage.docId);
      const tokens = tokenize(`${doc?.title ?? ""}\n${passage.heading}\n${passage.text}`);
      this.lengths.push(tokens.length);
      const counts = new Map<string, number>();
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
      for (const [token, tf] of counts) {
        let list = this.postings.get(token);
        if (!list) this.postings.set(token, (list = []));
        list.push({ index, tf });
      }
    });
    const total = this.lengths.reduce((sum, n) => sum + n, 0);
    this.avgLength = passages.length ? total / passages.length : 1;
  }

  searchPassages(query: string, options: SearchOptions): PassageHit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const scores = new Map<number, { score: number; matched: number }>();
    const n = this.passages.length;
    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
      for (const { index, tf } of list) {
        const norm = tf + K1 * (1 - B + (B * this.lengths[index]!) / this.avgLength);
        const entry = scores.get(index) ?? { score: 0, matched: 0 };
        entry.score += (idf * tf * (K1 + 1)) / norm;
        entry.matched += 1;
        scores.set(index, entry);
      }
    }
    const hits: Array<PassageHit & { index: number }> = [];
    for (const [index, { score, matched }] of scores) {
      const passage = this.passages[index]!;
      if (options.collection && this.documents.get(passage.docId)?.collection !== options.collection) continue;
      hits.push({ passage, score, coverage: matched / terms.length, index });
    }
    hits.sort((a, b) => b.score - a.score || a.index - b.index);
    return hits.slice(0, options.limit).map(({ passage, score, coverage }) => ({ passage, score, coverage }));
  }

  /** Ranks documents by their best-matching passage. */
  searchDocuments(query: string, options: SearchOptions): DocumentHit[] {
    const best = new Map<string, PassageHit>();
    for (const hit of this.searchPassages(query, { ...options, limit: this.passages.length })) {
      if (!best.has(hit.passage.docId)) best.set(hit.passage.docId, hit);
    }
    return [...best.values()]
      .slice(0, options.limit)
      .map((hit) => ({ doc: this.documents.get(hit.passage.docId)!, best: hit }));
  }
}

export function matchQuality(coverage: number): "strong" | "partial" | "weak" {
  if (coverage >= 0.75) return "strong";
  if (coverage >= 0.5) return "partial";
  return "weak";
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_`>|]/g, " ")
    .replace(/-{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A short, query-focused excerpt for free search results. It is capped at
 * half of the passage so that a teaser never gives the whole passage away.
 */
export function makeTeaser(text: string, query: string, maxChars: number): string {
  const plain = stripMarkdown(text);
  const budget = Math.min(maxChars, Math.max(40, Math.floor(plain.length / 2)));
  if (plain.length <= budget) return plain;
  const terms = new Set(tokenize(query));
  let start = 0;
  for (const match of plain.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (terms.has(stem(match[0].toLowerCase()))) {
      start = match.index;
      break;
    }
  }
  start = Math.max(0, Math.min(start - 30, plain.length - budget));
  if (start > 0) {
    const space = plain.indexOf(" ", start);
    start = space === -1 ? start : space + 1;
  }
  let end = Math.min(plain.length, start + budget);
  if (end < plain.length) {
    const space = plain.lastIndexOf(" ", end);
    if (space > start) end = space;
  }
  return `${start > 0 ? "…" : ""}${plain.slice(start, end).trim()}${end < plain.length ? "…" : ""}`;
}
