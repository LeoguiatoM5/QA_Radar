import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SANDBOX_PROTOCOL_VERSION,
  SandboxRequestVerifier,
  createSandboxCodeRunner,
  sandboxRequestSignature,
  verifySandboxRequestSignature,
} from "../src/sandbox-client.js";

const SIGNING_SECRET = "sandbox-signing-secret-com-mais-de-32-bytes";

describe("protocolo do runner sandbox", () => {
  it("assina a requisição e valida o envelope correlacionado", async () => {
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), "https://sandbox.example/v1/executions");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      const request = JSON.parse(body) as {
        schemaVersion: string;
        executionId: string;
        headed: boolean;
        limits: { timeoutMs: number; maxOutputBytes: number; maxMemoryMiB: number };
      };
      assert.equal(request.schemaVersion, SANDBOX_PROTOCOL_VERSION);
      assert.equal(request.headed, false);
      assert.deepEqual(request.limits, {
        timeoutMs: 30_000,
        maxOutputBytes: 4_096,
        maxMemoryMiB: 256,
      });
      assert.equal(verifySandboxRequestSignature(SIGNING_SECRET, {
        timestamp: headers.get("x-qa-radar-timestamp") ?? "",
        requestId: headers.get("x-qa-radar-request-id") ?? "",
        signature: headers.get("x-qa-radar-signature") ?? "",
        body,
      }, Date.parse(headers.get("x-qa-radar-timestamp") ?? "")), true);
      return new Response(JSON.stringify({
        schemaVersion: SANDBOX_PROTOCOL_VERSION,
        executionId: request.executionId,
        exitCode: 0,
        stdout: '{"stats":{"expected":1}}',
        stderr: "",
      }), { status: 200 });
    }) as typeof fetch;
    const runner = createSandboxCodeRunner({
      baseUrl: "https://sandbox.example",
      signingSecret: SIGNING_SECRET,
      fetcher,
      now: () => Date.parse("2026-07-25T12:00:00.000Z"),
      requestId: () => "11111111-1111-4111-8111-111111111111",
    });

    const result = await runner({
      outputDir: "não-enviado",
      code: "import { test } from 'playwright/test';",
      headed: true,
      timeoutMs: 30_000,
      maxOutputBytes: 4_096,
      maxMemoryMiB: 256,
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /expected/);
  });

  it("rejeita assinatura adulterada ou expirada", () => {
    const input = {
      timestamp: "2026-07-25T12:00:00.000Z",
      requestId: "22222222-2222-4222-8222-222222222222",
      body: '{"job":"abc"}',
    };
    const signature = sandboxRequestSignature(SIGNING_SECRET, input);
    assert.equal(verifySandboxRequestSignature(
      SIGNING_SECRET,
      { ...input, signature },
      Date.parse("2026-07-25T12:04:00.000Z"),
    ), true);
    assert.equal(verifySandboxRequestSignature(
      SIGNING_SECRET,
      { ...input, body: '{"job":"alterado"}', signature },
      Date.parse("2026-07-25T12:04:00.000Z"),
    ), false);
    assert.equal(verifySandboxRequestSignature(
      SIGNING_SECRET,
      { ...input, signature },
      Date.parse("2026-07-25T12:06:00.000Z"),
    ), false);
  });

  it("consome o nonce uma única vez para impedir replay", () => {
    const input = {
      timestamp: "2026-07-25T12:00:00.000Z",
      requestId: "33333333-3333-4333-8333-333333333333",
      body: '{"job":"unico"}',
    };
    const signed = {
      ...input,
      signature: sandboxRequestSignature(SIGNING_SECRET, input),
    };
    const verifier = new SandboxRequestVerifier(SIGNING_SECRET);
    const now = Date.parse("2026-07-25T12:01:00.000Z");
    assert.equal(verifier.verifyAndConsume(signed, now), true);
    assert.equal(verifier.verifyAndConsume(signed, now), false);
  });

  it("exige HTTPS, secret forte e limite de resposta", async () => {
    assert.throws(
      () => createSandboxCodeRunner({ baseUrl: "http://sandbox.example", signingSecret: SIGNING_SECRET }),
      /deve usar HTTPS/,
    );
    assert.throws(
      () => createSandboxCodeRunner({ baseUrl: "https://sandbox.example", signingSecret: "curto" }),
      /entre 32 e 512 bytes/,
    );

    const runner = createSandboxCodeRunner({
      baseUrl: "https://sandbox.example",
      signingSecret: SIGNING_SECRET,
      fetcher: (async (_input: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { executionId: string };
        return new Response(JSON.stringify({
          schemaVersion: SANDBOX_PROTOCOL_VERSION,
          executionId: request.executionId,
          exitCode: 0,
          stdout: "x".repeat(33),
          stderr: "",
        }), { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      runner({
        outputDir: "não-enviado",
        code: "test('x', () => {});",
        headed: false,
        timeoutMs: 1_000,
        maxOutputBytes: 32,
        maxMemoryMiB: 128,
      }),
      /saída acima do limite/,
    );
  });
});
