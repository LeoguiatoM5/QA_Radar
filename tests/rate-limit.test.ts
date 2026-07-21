import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimiter } from "../src/rate-limit.js";

describe("rate limiter", () => {
  it("isola clientes e informa limites da janela", () => {
    const limiter = new RateLimiter(2, 1_000);
    const first = limiter.consume("client-a", 10_000);
    const second = limiter.consume("client-a", 10_100);
    const blocked = limiter.consume("client-a", 10_200);
    const other = limiter.consume("client-b", 10_200);

    assert.deepEqual(first, {
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: 11_000,
      retryAfterSeconds: undefined,
    });
    assert.equal(second.remaining, 0);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);
    assert.equal(other.allowed, true);
  });

  it("reinicia o contador quando a janela expira", () => {
    const limiter = new RateLimiter(1, 500);
    assert.equal(limiter.consume("client", 1_000).allowed, true);
    assert.equal(limiter.consume("client", 1_100).allowed, false);
    const renewed = limiter.consume("client", 1_500);
    assert.equal(renewed.allowed, true);
    assert.equal(renewed.resetAt, 2_000);
  });

  it("rejeita configurações inválidas", () => {
    assert.throws(() => new RateLimiter(0, 1_000), /inteiro positivo/);
    assert.throws(() => new RateLimiter(1, 0), /janela deve ser positiva/);
  });
});
