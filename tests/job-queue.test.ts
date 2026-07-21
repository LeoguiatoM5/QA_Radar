import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JobQueue, type ScanJob } from "../src/job-queue.js";

function job(id: string): ScanJob {
  return {
    id,
    status: "queued",
    createdAt: "2026-07-21T00:00:00.000Z",
    options: {
      url: `https://example.com/${id}`,
      browser: "chromium",
      headed: false,
      timeoutMs: 30_000,
      settleMs: 0,
      outputDir: id,
      format: "json",
      screenshot: "never",
      failOn: "error",
      ignoredStatuses: new Set(),
      ignoredUrlPatterns: [],
    },
    report: undefined,
    error: undefined,
    progress: { discoveredPages: 0, completedPages: 0, currentUrl: undefined, percent: 0 },
    controller: new AbortController(),
    cancelRequested: false,
  };
}

describe("job queue", () => {
  it("mantém ordem, posição e limite de concorrência", () => {
    const queue = new JobQueue();
    const first = job("first");
    const second = job("second");
    queue.enqueue(first);
    queue.enqueue(second);

    assert.equal(queue.position(first.id), 1);
    assert.equal(queue.position(second.id), 2);
    assert.equal(queue.takeNext(1), first);
    assert.equal(first.status, "running");
    assert.equal(queue.position(second.id), 1);
    assert.equal(queue.takeNext(1), undefined);

    queue.finish();
    assert.equal(queue.takeNext(1), second);
    assert.deepEqual(queue.stats(), { active: 1, queued: 0, jobs: 2 });
  });

  it("remove um job cancelado sem alterar a posição dos anteriores", () => {
    const queue = new JobQueue();
    const first = job("first");
    const second = job("second");
    queue.enqueue(first);
    queue.enqueue(second);

    assert.equal(queue.cancelQueued(second.id), true);
    assert.equal(second.status, "cancelled");
    assert.equal(queue.position(second.id), undefined);
    assert.deepEqual(queue.stats(), { active: 0, queued: 1, jobs: 2 });
    assert.equal(queue.cancelQueued(second.id), false);
  });
});
