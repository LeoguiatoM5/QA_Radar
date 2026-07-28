import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicNetworkGuard, assertPublicUrl } from "../src/security.js";

describe("public network guard", () => {
  it("bloqueia faixas privadas e reservadas", async () => {
    for (const url of [
      "http://127.0.0.1",
      "http://10.0.0.1",
      "http://100.64.0.1",
      "http://169.254.169.254",
      "http://192.0.0.1",
      "http://198.51.100.10",
      "http://203.0.113.10",
      "http://240.0.0.1",
      "http://[::1]",
      "http://[64:ff9b::7f00:1]",
      "http://[::ffff:127.0.0.1]",
    ]) {
      await assert.rejects(assertPublicUrl(url), /privados/);
    }
  });

  it("bloqueia mudança de resolução durante a mesma análise", async () => {
    let attempt = 0;
    const guard = new PublicNetworkGuard(async () => {
      attempt += 1;
      return [{ address: attempt === 1 ? "93.184.216.34" : "93.184.216.35" }];
    });
    await guard.assert("https://example.com");
    await assert.rejects(guard.assert("https://example.com/recurso"), /DNS rebinding/);
  });

  it("retorna somente resoluções públicas fixadas para o proxy", async () => {
    const guard = new PublicNetworkGuard(async () => [{ address: "93.184.216.34", family: 4 }]);
    const resolution = await guard.resolve("https://example.com/path");
    assert.equal(resolution.hostname, "example.com");
    assert.deepEqual(resolution.addresses, [{ address: "93.184.216.34", family: 4 }]);
  });
});
