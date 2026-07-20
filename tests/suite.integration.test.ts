import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { scanSitemap } from "../src/suite.js";
import type { ScanOptions } from "../src/types.js";

describe("sitemap suite integration", () => {
  it("analisa páginas do mesmo domínio e consolida o quality gate", async () => {
    let origin = "";
    const server = createServer((request, response) => {
      if (request.url === "/sitemap.xml") {
        response.writeHead(200, { "content-type": "application/xml" });
        response.end(`<urlset><url><loc>${origin}/ok</loc></url><url><loc>${origin}/failure</loc></url><url><loc>https://external.example/page</loc></url></urlset>`);
        return;
      }
      if (request.url === "/failure") {
        response.writeHead(500, { "content-type": "text/html" });
        response.end("<!doctype html><title>Página com falha</title>");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Página saudável</title><main>Conteúdo</main>");
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;
    const outputDir = resolve("qa-radar-results", `.suite-test-${process.pid}-${Date.now()}`);
    const options: ScanOptions = {
      url: `${origin}/`,
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
      maxPages: 10,
    };

    try {
      const report = await scanSitemap(options);
      assert.equal(report.pages?.length, 2);
      assert.equal(report.passed, false);
      assert.equal(report.summary.errors, 1);
      assert.ok(report.issues.some((issue) => issue.ruleId === "http.response.error"));
      assert.ok(report.pages?.every((page) => page.url.startsWith(origin)));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });
});
