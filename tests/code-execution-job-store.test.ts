import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodeExecutionJobStore, type CodeExecutionJob } from "../src/code-execution-job-store.js";

function job(id: string, status: CodeExecutionJob["status"] = "passed"): CodeExecutionJob {
  return { id, outputDir: `dir-${id}`, status, report: { ok: true }, accessTokenHash: "0".repeat(64) };
}

describe("code execution job store", () => {
  it("armazena, recupera e remove jobs por id", () => {
    const store = new CodeExecutionJobStore();
    const created = job("a");
    store.set(created);
    assert.equal(store.get("a"), created);
    assert.equal(store.get("desconhecido"), undefined);
    store.delete("a");
    assert.equal(store.get("a"), undefined);
  });

  it("permite apenas uma execução ativa por vez", () => {
    const store = new CodeExecutionJobStore();
    assert.equal(store.isActive(), false);
    store.start();
    assert.equal(store.isActive(), true);
    store.finish();
    assert.equal(store.isActive(), false);
  });
});
