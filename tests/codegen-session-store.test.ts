import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodegenSessionStore, type CodegenSession } from "../src/codegen-session-store.js";

function session(id: string, active: boolean): CodegenSession {
  return {
    id,
    outputDir: `dir-${id}`,
    outputPath: `dir-${id}/recorded.spec.ts`,
    process: {} as CodegenSession["process"],
    active,
    accessTokenHash: "0".repeat(64),
  };
}

describe("codegen session store", () => {
  it("armazena, recupera e remove sessões por id", () => {
    const store = new CodegenSessionStore();
    const created = session("a", true);
    store.set(created);
    assert.equal(store.get("a"), created);
    assert.equal(store.get("desconhecido"), undefined);
    store.delete("a");
    assert.equal(store.get("a"), undefined);
  });

  it("detecta gravação ativa entre múltiplas sessões", () => {
    const store = new CodegenSessionStore();
    assert.equal(store.hasActive(), false);
    store.set(session("finalizada", false));
    assert.equal(store.hasActive(), false);
    store.set(session("gravando", true));
    assert.equal(store.hasActive(), true);
  });
});
