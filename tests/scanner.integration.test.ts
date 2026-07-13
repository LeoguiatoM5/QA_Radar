import assert from "node:assert/strict";
import { createServer } from "node:http";
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
    };

    try {
      const report = await scan(options);
      assert.equal(report.title, "Aplicação de teste");
      assert.equal(report.mainStatus, 200);
      assert.equal(report.passed, false);
      assert.ok(report.issues.some((issue) => issue.category === "console"));
      assert.ok(report.issues.some((issue) => issue.category === "http" && issue.status === 500));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
