import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { auditLighthouse } from "../src/scanner-lighthouse.js";

describe("Lighthouse integration", () => {
  it("executa auditoria real e preserva o artefato bruto", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><html lang="pt-BR"><title>Fixture Lighthouse</title><main><h1>QA Radar</h1></main>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const outputDir = await mkdtemp(join(tmpdir(), "qa-radar-lighthouse-"));
    try {
      const result = await auditLighthouse(`http://127.0.0.1:${address.port}`, outputDir, 30_000);
      assert.equal(typeof result.summary.performance, "number");
      assert.equal(result.summary.reportPath, "report.lighthouse.json");
      await access(join(outputDir, result.summary.reportPath));
      assert.ok(result.issues.every((issue) => issue.source === "lighthouse"));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
