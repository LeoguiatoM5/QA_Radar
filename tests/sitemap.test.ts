import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSitemapLocations } from "../src/sitemap.js";

describe("sitemap parser", () => {
  it("extrai URLs e decodifica entidades XML", () => {
    const locations = parseSitemapLocations(`<?xml version="1.0"?>
      <urlset>
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/search?a=1&amp;b=2</loc></url>
      </urlset>`);
    assert.deepEqual(locations, [
      "https://example.com/",
      "https://example.com/search?a=1&b=2",
    ]);
  });

  it("ignora elementos sem loc", () => {
    assert.deepEqual(parseSitemapLocations("<urlset><url><lastmod>2026-01-01</lastmod></url></urlset>"), []);
  });
});
