import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { scanSitemap } from "../src/suite.js";
import type { ScanOptions } from "../src/types.js";

const pageCount = 20;
const outputDir = resolve("qa-radar-results", `.benchmark-sitemap-${process.pid}`);
let origin = "";

const server = createServer((request, response) => {
  if (request.url === "/sitemap.xml") {
    const urls = Array.from(
      { length: pageCount },
      (_, index) => `<url><loc>${origin}/page-${index + 1}</loc></url>`,
    ).join("");
    response.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
    response.end(`<urlset>${urls}</urlset>`);
    return;
  }

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <html lang="pt-BR">
      <head><title>Benchmark ${request.url ?? ""}</title></head>
      <body><main><h1>Página ${request.url ?? ""}</h1><p>Conteúdo estável para medição.</p></main></body>
    </html>`);
});

await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address === "object");
origin = `http://127.0.0.1:${address.port}`;

const options: ScanOptions = {
  url: origin,
  browser: "chromium",
  headed: false,
  timeoutMs: 10_000,
  settleMs: 50,
  outputDir,
  format: "json",
  screenshot: "never",
  failOn: "error",
  ignoredStatuses: new Set(),
  ignoredUrlPatterns: [],
  sitemap: true,
  maxPages: pageCount,
};

let peakRssBytes = process.memoryUsage().rss;
let peakHeapBytes = process.memoryUsage().heapUsed;
const sample = setInterval(() => {
  const memory = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, memory.rss);
  peakHeapBytes = Math.max(peakHeapBytes, memory.heapUsed);
}, 25);

const startedAt = performance.now();
try {
  const report = await scanSitemap(options);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(report.pages?.length, pageCount);
  assert.equal(report.scanStatus, "completed");
  console.log(JSON.stringify({
    pages: pageCount,
    elapsedMs: Math.round(elapsedMs),
    averageMsPerPage: Math.round(elapsedMs / pageCount),
    peakNodeRssMiB: Number((peakRssBytes / 1024 / 1024).toFixed(1)),
    peakNodeHeapMiB: Number((peakHeapBytes / 1024 / 1024).toFixed(1)),
    issues: report.summary.total,
    passed: report.passed,
  }, null, 2));
} finally {
  clearInterval(sample);
  await rm(outputDir, { recursive: true, force: true });
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => error ? reject(error) : resolveClose()),
  );
}
