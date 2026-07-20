import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { scan } from "../src/scanner.js";
import type { ScanOptions } from "../src/types.js";

describe("scanner integration", () => {
  it("detecta erros reais do navegador e do backend", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/api") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end('{"error":"indisponível"}');
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>Aplicação de teste</title>
        <script>console.error("erro controlado"); fetch("/api");</script>`);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const options: ScanOptions = {
      url: `http://127.0.0.1:${address.port}/`,
      browser: "chromium",
      headed: false,
      timeoutMs: 10_000,
      settleMs: 200,
      outputDir: "qa-radar-report-test",
      format: "console",
      screenshot: "never",
      failOn: "error",
      ignoredStatuses: new Set(),
      ignoredUrlPatterns: [],
      regressionsOnly: false,
    };
    const baselinePath = resolve("qa-radar-results", `scanner-baseline-${process.pid}.json`);

    try {
      const report = await scan(options);
      assert.equal(report.title, "Aplicação de teste");
      assert.equal(report.mainStatus, 200);
      assert.equal(report.passed, false);
      assert.ok(report.issues.some((issue) => issue.category === "console"));
      assert.ok(report.issues.some((issue) => issue.category === "http" && issue.status === 500));
      assert.ok(report.performance);
      assert.equal(typeof report.performance.ttfbMs, "number");
      assert.equal(typeof report.performance.domContentLoadedMs, "number");
      await writeFile(baselinePath, JSON.stringify(report), "utf8");

      const compared = await scan({ ...options, baselinePath, regressionsOnly: true });
      assert.equal(compared.passed, true);
      assert.equal(compared.comparison?.newIssues, 0);
      assert.ok((compared.comparison?.existingIssues ?? 0) >= 2);
    } finally {
      await rm(baselinePath, { force: true });
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("gera relatório parcial quando a navegação não estabiliza", async () => {
    const server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Resposta tardia</title>");
      }, 500);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");

    try {
      const report = await scan({
        url: `http://127.0.0.1:${address.port}/`,
        browser: "chromium",
        headed: false,
        timeoutMs: 50,
        settleMs: 0,
        outputDir: "qa-radar-report-test",
        format: "console",
        screenshot: "on-failure",
        failOn: "error",
        ignoredStatuses: new Set(),
        ignoredUrlPatterns: [],
        regressionsOnly: false,
      });
      assert.equal(report.scanStatus, "partial");
      assert.equal(report.passed, false);
      assert.equal(report.screenshotPath, undefined);
      assert.ok(report.issues.some((issue) => issue.ruleId === "navigation.failed"));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
