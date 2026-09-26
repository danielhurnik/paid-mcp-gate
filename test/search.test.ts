import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkDocument } from "../src/knowledge/markdown.ts";
import { SearchIndex, makeTeaser, matchQuality, stem, tokenize } from "../src/knowledge/search.ts";
import { DOCS } from "./helpers.ts";

const index = new SearchIndex(DOCS, DOCS.flatMap((doc) => chunkDocument(doc)));

describe("stem", () => {
  it("maps plural and verb forms of a word to the same stem", () => {
    assert.equal(stem("bearings"), stem("bearing"));
    assert.equal(stem("seals"), stem("seal"));
    assert.equal(stem("sealed"), stem("sealing"));
    assert.equal(stem("damaged"), stem("damage"));
    assert.equal(stem("running"), "run");
  });

  it("leaves words alone when stripping would destroy them", () => {
    assert.equal(stem("spring"), "spring");
    assert.equal(stem("speed"), "speed");
    assert.equal(stem("analysis"), "analysis");
  });
});

describe("tokenize", () => {
  it("drops stopwords and one-letter tokens, keeps numbers", () => {
    assert.deepEqual(tokenize("What is the MTBF of a Plan 53A seal?"), ["mtbf", "plan", "53a", "seal"]);
  });
});

describe("SearchIndex", () => {
  it("ranks the document that answers the query first and reports coverage", () => {
    const [top] = index.searchDocuments("thrust bearing balance drum", { limit: 3 });
    assert.equal(top?.doc.id, "report-bearing");
    assert.equal(top?.best.coverage, 1);
    assert.equal(matchQuality(top!.best.coverage), "strong");
  });

  it("returns one hit per document, best passage first", () => {
    const hits = index.searchDocuments("thrust bearing", { limit: 10 });
    const ids = hits.map((hit) => hit.doc.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("filters by collection", () => {
    const hits = index.searchDocuments("pumps seals bearings", { limit: 10, collection: "about" });
    assert.deepEqual(hits.map((hit) => hit.doc.id), ["free-intro"]);
  });

  it("returns nothing for queries made only of stopwords or unknown words", () => {
    assert.deepEqual(index.searchPassages("what is the", { limit: 5 }), []);
    assert.deepEqual(index.searchPassages("hydrogen compressor", { limit: 5 }), []);
  });
});

describe("makeTeaser", () => {
  const text = "Alpha beta gamma. ".repeat(20) + "The suction strainer was blocked. " + "Delta epsilon zeta. ".repeat(20);

  it("stays within the character budget and centres on a query term", () => {
    const teaser = makeTeaser(text, "strainer", 80);
    assert.ok(teaser.length <= 82, `teaser too long: ${teaser.length}`);
    assert.match(teaser, /strainer/);
    assert.ok(teaser.startsWith("…") && teaser.endsWith("…"));
  });

  it("never shows more than half of a short passage", () => {
    const short = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.";
    assert.ok(makeTeaser(short, "seven", 500).length <= Math.floor(short.length / 2) + 2);
  });

  it("strips Markdown syntax", () => {
    assert.equal(makeTeaser("**Bold** and `code`", "bold", 160), "Bold and code");
  });
});
