import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { KnowledgeDocument, Passage } from "./types.ts";

/**
 * Loads every `*.md` file under `dir` (recursively). Files and folders whose
 * name starts with "." or "_" are skipped, so drafts can live next to
 * published documents.
 */
export function loadMarkdownDirectory(dir: string): KnowledgeDocument[] {
  const docs = listMarkdownFiles(dir).map((file) =>
    parseMarkdownDocument(readFileSync(file, "utf8"), relative(dir, file)),
  );
  const seen = new Set<string>();
  for (const doc of docs) {
    if (seen.has(doc.id)) throw new Error(`Duplicate document id "${doc.id}" in ${dir}`);
    seen.add(doc.id);
  }
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

function listMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(path);
  }
  return files;
}

/**
 * Parses one document. Frontmatter keys: id, title, collection, url, updated,
 * summary, price_usd. Missing ids derive from the file path, missing
 * collections from the parent folder, missing titles from the first heading.
 */
export function parseMarkdownDocument(source: string, relativePath: string): KnowledgeDocument {
  const { meta, body } = splitFrontmatter(source);
  const segments = relativePath.split(/[\\/]/);
  const stemName = basename(relativePath).replace(/\.md$/i, "");
  const priceUsd = meta.price_usd === undefined ? undefined : Number(meta.price_usd);
  if (priceUsd !== undefined && !(Number.isFinite(priceUsd) && priceUsd >= 0)) {
    throw new Error(`${relativePath}: price_usd must be a non-negative number`);
  }
  return {
    id: meta.id ?? slugify(relativePath.replace(/\.md$/i, "")),
    title: meta.title ?? firstHeading(body) ?? stemName,
    collection: meta.collection ?? (segments.length > 1 ? segments[segments.length - 2]! : "general"),
    body: body.trim(),
    url: meta.url,
    updated: meta.updated,
    summary: meta.summary,
    priceUsd,
  };
}

const FRONTMATTER = /^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/;

function splitFrontmatter(source: string): { meta: Record<string, string>; body: string } {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = FRONTMATTER.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (pair) meta[pair[1]!] = unquote(pair[2]!.trim());
  }
  return { meta, body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2]! : value;
}

function firstHeading(body: string): string | undefined {
  return /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Splits a document into passages at headings, packing consecutive paragraphs
 * into passages of at most ~maxChars. A paragraph is never split, so tables
 * and code blocks stay intact.
 */
export function chunkDocument(doc: KnowledgeDocument, maxChars = 700): Passage[] {
  const passages: Passage[] = [];
  let heading = doc.title;
  let buffer: string[] = [];
  let bufferSize = 0;
  let paragraph: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = buffer.join("\n\n").trim();
    if (text) passages.push({ id: `${doc.id}#p${passages.length + 1}`, docId: doc.id, heading, text });
    buffer = [];
    bufferSize = 0;
  };
  const endParagraph = () => {
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (!text) return;
    if (bufferSize > 0 && bufferSize + text.length > maxChars) flush();
    buffer.push(text);
    bufferSize += text.length;
  };

  for (const line of doc.body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const headingMatch = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      endParagraph();
      flush();
      heading = headingMatch[2]!;
    } else if (!inFence && line.trim() === "") {
      endParagraph();
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  flush();
  return passages;
}
