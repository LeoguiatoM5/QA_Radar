import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LegacyJourneyRegistry, type JourneyJob } from "../src/legacy-journey-registry.js";

function job(id: string): JourneyJob {
  return {
    id,
    status: "running",
    createdAt: "2026-07-21T00:00:00.000Z",
    outputDir: `dir-${id}`,
    accessTokenHash: "0".repeat(64),
    controller: new AbortController(),
    cancelRequested: false,
  };
}

describe("legacy journey registry", () => {
  it("armazena, recupera e remove jornadas por id", () => {
    const registry = new LegacyJourneyRegistry();
    const created = job("a");
    registry.set(created);
    assert.equal(registry.get("a"), created);
    assert.equal(registry.get("desconhecido"), undefined);
    registry.delete("a");
    assert.equal(registry.get("a"), undefined);
  });

  it("permite apenas uma jornada ativa por vez", () => {
    const registry = new LegacyJourneyRegistry();
    assert.equal(registry.isActive(), false);
    registry.start();
    assert.equal(registry.isActive(), true);
    registry.finish();
    assert.equal(registry.isActive(), false);
  });
});
