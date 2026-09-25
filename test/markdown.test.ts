import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chunkDocument, loadMarkdownDirectory, parseMarkdownDocument } from "../src/knowledge/markdown.ts";

describe("parseMarkdownDocument", () => {
  it("reads frontmatter, including quoted values and prices", () => {
    const doc = parseMarkdownDocument(
      '---\nid: fa-1\ntitle: "Pump: a case study"\ncollection: reports\nprice_usd: 0.4\nsummary: \'Short\'\n---\n# Heading\n\nBody.',
      "reports/fa-1.md",
    );
    assert.equal(doc.id, "fa-1");
    assert.equal(doc.title, "Pump: a case study");
    assert.equal(doc.collection, "reports");
    assert.equal(doc.priceUsd, 0.4);
    assert.equal(doc.summary, "Short");
    assert.equal(doc.body, "# Heading\n\nBody.");
  });

  it("derives id, collection and title when frontmatter is missing", () => {
    const doc = parseMarkdownDocument("﻿# Seal triage\r\n\r\nText.", "guides/Seal Triage.md");
    assert.equal(doc.id, "guides-seal-triage");
    assert.equal(doc.collection, "guides");
    assert.equal(doc.title, "Seal triage");
    assert.equal(doc.body, "# Seal triage\n\nText.");
  });

  it("rejects invalid prices", () => {
    assert.throws(() => parseMarkdownDocument("---\nprice_usd: free\n---\nx", "a.md"), /price_usd/);
    assert.throws(() => parseMarkdownDocument("---\nprice_usd: -1\n---\nx", "a.md"), /price_usd/);
  });
});

describe("chunkDocument", () => {
  const doc = (body: string) => ({ id: "d", title: "Doc", collection: "c", body });

  it("starts a new passage at every heading and remembers the heading", () => {
    const passages = chunkDocument(doc("Intro text.\n\n## First\n\nOne.\n\n## Second\n\nTwo."));
    assert.deepEqual(
      passages.map((p) => [p.id, p.heading, p.text]),
      [
        ["d#p1", "Doc", "Intro text."],
        ["d#p2", "First", "One."],
        ["d#p3", "Second", "Two."],
      ],
    );
  });

  it("packs paragraphs up to the size limit without splitting a paragraph or table", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const passages = chunkDocument(doc(`${"x".repeat(30)}\n\n${"y".repeat(30)}\n\n${table}`), 70);
    assert.equal(passages.length, 2);
    assert.equal(passages[1]?.text, table);
  });

  it("does not treat '#' lines inside code fences as headings", () => {
    const passages = chunkDocument(doc("## Setup\n\n```sh\n# install\nnpm ci\n```"));
    assert.equal(passages.length, 1);
    assert.equal(passages[0]?.heading, "Setup");
    assert.match(passages[0]!.text, /# install/);
  });
});

describe("loadMarkdownDirectory", () => {
  it("loads nested folders, skips drafts and hidden files, and rejects duplicate ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "pmg-md-"));
    try {
      mkdirSync(join(dir, "guides"));
      mkdirSync(join(dir, "_drafts"));
      writeFileSync(join(dir, "guides", "a.md"), "# A\n\nText.");
      writeFileSync(join(dir, "guides", ".hidden.md"), "# Hidden");
      writeFileSync(join(dir, "_drafts", "b.md"), "# Draft");
      writeFileSync(join(dir, "notes.txt"), "not markdown");
      assert.deepEqual(loadMarkdownDirectory(dir).map((d) => d.id), ["guides-a"]);

      writeFileSync(join(dir, "c.md"), "---\nid: guides-a\n---\n# Clash");
      assert.throws(() => loadMarkdownDirectory(dir), /Duplicate document id "guides-a"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
