import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IllegalJobTransitionError, TERMINAL_JOB_STATUSES, canTransitionJob, isTerminalJobStatus, transitionJob, type JobStatus } from "../src/job-state.js";

const ALL_STATUSES: readonly JobStatus[] = ["queued", "running", "completed", "failed", "cancelled"];

describe("job state machine", () => {
  it("descreve o caminho normal de uma análise", () => {
    const job = { status: "queued" as JobStatus };
    transitionJob(job, "running");
    assert.equal(job.status, "running");
    transitionJob(job, "completed");
    assert.equal(job.status, "completed");
  });

  it("permite cancelar tanto na fila quanto em execução", () => {
    assert.equal(canTransitionJob("queued", "cancelled"), true);
    assert.equal(canTransitionJob("running", "cancelled"), true);
  });

  it("trata os três desfechos como finais e recusa qualquer saída deles", () => {
    for (const status of TERMINAL_JOB_STATUSES) {
      assert.equal(isTerminalJobStatus(status), true);
      for (const target of ALL_STATUSES) {
        assert.equal(canTransitionJob(status, target), false, `${status} não deveria poder ir para ${target}`);
      }
    }
    assert.equal(isTerminalJobStatus("queued"), false);
    assert.equal(isTerminalJobStatus("running"), false);
  });

  it("recusa uma análise concluída voltando a executar", () => {
    const job = { status: "completed" as JobStatus };
    assert.throws(() => transitionJob(job, "running"), IllegalJobTransitionError);
    // O estado permanece o que era: a transição recusada não é aplicada pela metade.
    assert.equal(job.status, "completed");
  });

  it("recusa pular a fila direto para um desfecho", () => {
    // "queued" → "completed" significaria relatar um resultado que nunca foi produzido.
    assert.throws(() => transitionJob({ status: "queued" as JobStatus }, "completed"), IllegalJobTransitionError);
    assert.throws(() => transitionJob({ status: "queued" as JobStatus }, "failed"), IllegalJobTransitionError);
  });

  it("expõe de que estado para qual a transição foi recusada", () => {
    assert.throws(
      () => transitionJob({ status: "cancelled" as JobStatus }, "completed"),
      (error: unknown) => error instanceof IllegalJobTransitionError && error.from === "cancelled" && error.to === "completed",
    );
  });
});
