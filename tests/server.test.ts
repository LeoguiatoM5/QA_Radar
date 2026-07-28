import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { createQaRadarServer } from "../src/server.js";
import { codeExecutionEnvironment } from "../src/code-execution.js";
import type { OperationalEvent } from "../src/server.js";

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("A condição esperada não ocorreu no prazo.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("web server", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createQaRadarServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("entrega a Home com cabeçalhos de segurança", async () => {
    const response = await fetch(baseUrl);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(html, /Inspecionar aplicação/);
    assert.match(html, /Modo Jornada de Playwright/);
    assert.doesNotMatch(html, /id="scan-form"/);
  });

  it("entrega o scanner em rota própria", async () => {
    const response = await fetch(`${baseUrl}/scanner`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Nova análise/);
    assert.match(html, /Executar scanner/);
    assert.match(html, /Cobrir sitemap\.xml/);
    assert.match(html, /TTFB/);
    assert.match(html, /Cancelar/);
    assert.match(html, /progress-bar/);
    assert.match(html, /Histórico desabilitado neste servidor/);
    assert.doesNotMatch(html, /id="journey-form"/);
  });

  it("entrega a documentação em rota própria", async () => {
    const response = await fetch(`${baseUrl}/docs`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Como usar o QA Radar/);
    assert.match(html, /href="\/scanner"/);
  });

  it("separa o Modo Jornada de Playwright do scanner e mostra indisponibilidade com segurança", async () => {
    const response = await fetch(`${baseUrl}/journeys`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Recurso indisponível neste ambiente/);
    assert.doesNotMatch(html, /id="scan-form"/);
    assert.doesNotMatch(html, /id="journey-form"/);
  });

  it("mantém jornadas desabilitadas por padrão", async () => {
    const response = await fetch(`${baseUrl}/api/journeys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.match(((await response.json()) as { error: string }).error, /desabilitadas/);
  });

  it("bloqueia endpoints de código quando desabilitados e restringe o acesso ao host local", async () => {
    const disabled = await fetch(`${baseUrl}/api/code-execution`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "test('x', () => {});" }),
    });
    assert.equal(disabled.status, 403);
    assert.match(((await disabled.json()) as { error: string }).error, /desabilitado/);

    const protectedServer = createQaRadarServer({
      allowCodeMode: true,
      allowPrivateTargets: true,
      trustProxy: true,
    });
    await new Promise<void>((resolve) => protectedServer.listen(0, "127.0.0.1", resolve));
    const address = protectedServer.address() as AddressInfo;
    const protectedUrl = `http://127.0.0.1:${address.port}`;
    try {
      const remote = await fetch(`${protectedUrl}/api/code-execution`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({}),
      });
      assert.equal(remote.status, 403);
      assert.match(((await remote.json()) as { error: string }).error, /execução hospedada/);

      const local = await fetch(`${protectedUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(local.status, 400);
      assert.match(((await local.json()) as { error: string }).error, /arquivo \.spec\.ts/);
    } finally {
      await new Promise<void>((resolve, reject) => protectedServer.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("exige token administrativo para execução remota e token próprio para seus artefatos", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-access-"));
    const adminToken = "admin-token-seguro-com-mais-de-32-caracteres";
    let executionCount = 0;
    const protectedServer = createQaRadarServer({
      allowCodeMode: true,
      trustProxy: true,
      codeModeAdminToken: adminToken,
      resultsDir,
      hostedCodeRunner: async () => {
        executionCount += 1;
        return {
          exitCode: 0,
          stdout: '{"stats":{"expected":1,"duration":10}}',
          stderr: "",
        };
      },
    });
    await new Promise<void>((resolve) => protectedServer.listen(0, "127.0.0.1", resolve));
    const address = protectedServer.address() as AddressInfo;
    const protectedUrl = `http://127.0.0.1:${address.port}`;
    const body = JSON.stringify({
      code: "import { test } from '@playwright/test'; test('protegido', async () => {});",
      headed: false,
    });
    const remoteHeaders = {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.20",
    };

    try {
      const missingAdmin = await fetch(`${protectedUrl}/api/code-execution`, {
        method: "POST",
        headers: remoteHeaders,
        body,
      });
      assert.equal(missingAdmin.status, 401);

      const wrongAdmin = await fetch(`${protectedUrl}/api/code-execution`, {
        method: "POST",
        headers: { ...remoteHeaders, authorization: "Bearer token-incorreto" },
        body,
      });
      assert.equal(wrongAdmin.status, 403);

      const executionResponse = await fetch(`${protectedUrl}/api/code-execution`, {
        method: "POST",
        headers: { ...remoteHeaders, authorization: `Bearer ${adminToken}` },
        body,
      });
      assert.equal(executionResponse.status, 200);
      assert.match(executionResponse.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict; Path=\/api\/code-executions\//);
      const execution = (await executionResponse.json()) as { id: string; accessToken: string };
      assert.match(execution.accessToken, /^[A-Za-z0-9_-]{40,}$/);
      assert.notEqual(execution.accessToken, adminToken);

      const evidenceUrl = `${protectedUrl}/api/code-executions/${execution.id}/evidence-report`;
      const evidenceBody = JSON.stringify({ testerName: "QA", testType: "smoke" });
      const missingExecutionToken = await fetch(evidenceUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: evidenceBody,
      });
      assert.equal(missingExecutionToken.status, 401);

      const wrongExecutionToken = await fetch(evidenceUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token-incorreto",
        },
        body: evidenceBody,
      });
      assert.equal(wrongExecutionToken.status, 403);

      const authorization = { authorization: `Bearer ${execution.accessToken}` };
      const createdEvidence = await fetch(evidenceUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: evidenceBody,
      });
      assert.equal(createdEvidence.status, 201);

      const artifactUrl = `${protectedUrl}/api/code-executions/${execution.id}/code-evidence.html`;
      assert.equal((await fetch(artifactUrl)).status, 401);
      const artifact = await fetch(artifactUrl, { headers: authorization });
      assert.equal(artifact.status, 200);
      assert.match(await artifact.text(), /Relatório de evidências/);

      for (const maliciousCode of ['import { readFile } from "node:fs/promises";', "const secret = process.env.QA_RADAR_CODE_MODE_ADMIN_TOKEN;", 'import { spawn } from "node:child_process";']) {
        const blocked = await fetch(`${protectedUrl}/api/code-execution`, {
          method: "POST",
          headers: { ...remoteHeaders, authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ code: maliciousCode, headed: false }),
        });
        assert.equal(blocked.status, 400);
        assert.match(((await blocked.json()) as { error: string }).error, /não (?:é )?permitid[ao]/);
      }
      assert.equal(executionCount, 1);
    } finally {
      await new Promise<void>((resolve, reject) => protectedServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("rejeita token administrativo curto", () => {
    assert.throws(() => createQaRadarServer({ codeModeAdminToken: "curto" }), /entre 32 e 512 bytes/);
  });

  it("falha fechado quando execução remota não possui runner sandbox", async () => {
    const adminToken = "admin-token-seguro-com-mais-de-32-caracteres";
    const serverWithoutSandbox = createQaRadarServer({
      allowCodeMode: true,
      trustProxy: true,
      codeModeAdminToken: adminToken,
    });
    await new Promise<void>((resolve) => serverWithoutSandbox.listen(0, "127.0.0.1", resolve));
    const address = serverWithoutSandbox.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/code-execution`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.30",
          authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          code: "import { test } from 'playwright/test'; test('x', async () => {});",
        }),
      });
      assert.equal(response.status, 503);
      assert.match(((await response.json()) as { error: string }).error, /sandbox.+não está configurado/i);
    } finally {
      await new Promise<void>((resolve, reject) => serverWithoutSandbox.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("protege o código gravado pelo Codegen com token próprio", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-codegen-access-"));
    const processEvents = new EventEmitter();
    Object.assign(processEvents, {
      pid: 1234,
      kill: () => true,
    });
    const codegenServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codegenSpawner: () => processEvents as unknown as ChildProcess,
    });
    await new Promise<void>((resolve) => codegenServer.listen(0, "127.0.0.1", resolve));
    const address = codegenServer.address() as AddressInfo;
    const codegenUrl = `http://127.0.0.1:${address.port}`;

    try {
      const createdResponse = await fetch(`${codegenUrl}/api/codegen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      assert.equal(createdResponse.status, 201);
      assert.match(createdResponse.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict; Path=\/api\/codegen\//);
      const created = (await createdResponse.json()) as { id: string; accessToken: string };
      const statusUrl = `${codegenUrl}/api/codegen/${created.id}`;

      assert.equal((await fetch(statusUrl)).status, 401);
      assert.equal(
        (
          await fetch(statusUrl, {
            headers: { authorization: "Bearer token-incorreto" },
          })
        ).status,
        403,
      );
      const authorized = await fetch(statusUrl, {
        headers: { authorization: `Bearer ${created.accessToken}` },
      });
      assert.equal(authorized.status, 200);
      assert.deepEqual(await authorized.json(), { status: "recording" });
    } finally {
      processEvents.emit("exit", 0);
      await new Promise<void>((resolve, reject) => codegenServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("repassa somente variáveis permitidas ao processo de código", () => {
    const environment = codeExecutionEnvironment({
      PATH: "bin",
      TEMP: "temp",
      PLAYWRIGHT_BROWSERS_PATH: "browsers",
      DATABASE_URL: "postgres://secret",
      API_TOKEN: "secret",
      QA_RADAR_CODE_MODE_ADMIN_TOKEN: "admin-secret",
    });

    assert.deepEqual(environment, {
      CI: "1",
      PATH: "bin",
      TEMP: "temp",
      PLAYWRIGHT_BROWSERS_PATH: "browsers",
    });
  });

  it("aplica quota de uma execução de código e remove seus artefatos após a retenção", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-"));
    let releaseExecution: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const codeServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      retentionMs: 25,
      codeRunner: async () => {
        signalStarted?.();
        await release;
        return { exitCode: 0, stdout: '{"stats":{"expected":1}}', stderr: "" };
      },
    });
    await new Promise<void>((resolve) => codeServer.listen(0, "127.0.0.1", resolve));
    const address = codeServer.address() as AddressInfo;
    const codeUrl = `http://127.0.0.1:${address.port}`;
    const execute = () =>
      fetch(`${codeUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "import { test } from '@playwright/test'; test('ok', async () => {});" }),
      });

    try {
      const firstRequest = execute();
      await started;
      const concurrent = await execute();
      assert.equal(concurrent.status, 429);
      assert.match(((await concurrent.json()) as { error: string }).error, /execução.+andamento/i);

      releaseExecution?.();
      const completed = await firstRequest;
      assert.equal(completed.status, 200);
      const payload = (await completed.json()) as { id: string };
      const executionDir = join(resultsDir, `code-${payload.id}`);
      await access(executionDir);
      await waitFor(async () => {
        try {
          await access(executionDir);
          return false;
        } catch {
          return true;
        }
      });
    } finally {
      releaseExecution?.();
      await new Promise<void>((resolve, reject) => codeServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("serve o vídeo da execução de código com content-length, sem transfer-encoding chunked", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-video-"));
    const codeServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codeRunner: async ({ outputDir }) => {
        const mediaDir = join(outputDir, "test-results", "qa-radar-teste");
        await mkdir(mediaDir, { recursive: true });
        await writeFile(join(mediaDir, "video.webm"), Buffer.from("video-falso-para-teste"));
        return { exitCode: 0, stdout: '{"stats":{"expected":1}}', stderr: "" };
      },
    });
    await new Promise<void>((resolve) => codeServer.listen(0, "127.0.0.1", resolve));
    const address = codeServer.address() as AddressInfo;
    const codeUrl = `http://127.0.0.1:${address.port}`;
    try {
      const executionResponse = await fetch(`${codeUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "import { test } from '@playwright/test'; test('ok', async () => {});" }),
      });
      const execution = (await executionResponse.json()) as { id: string; accessToken: string };
      const authorization = { authorization: `Bearer ${execution.accessToken}` };

      const evidenceResponse = await fetch(`${codeUrl}/api/code-executions/${execution.id}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: JSON.stringify({ testerName: "QA", testType: "smoke" }),
      });
      assert.equal(evidenceResponse.status, 201);
      const evidencePage = await fetch(`${codeUrl}/api/code-executions/${execution.id}/code-evidence.html`, { headers: authorization });
      assert.match(evidencePage.headers.get("content-security-policy") ?? "", /sandbox[^;]*\ballow-downloads\b/);
      const evidenceHtml = await evidencePage.text();
      assert.match(evidenceHtml, /Vídeo da jornada/);
      assert.doesNotMatch(evidenceHtml, /src="\.?\/?test-results/);
      const embedded = /src="data:video\/webm;base64,([^"]+)"/.exec(evidenceHtml);
      assert.ok(embedded, "o vídeo deve estar embutido em base64 no relatório baixado");
      assert.equal(Buffer.from(embedded[1] ?? "", "base64").toString("utf8"), "video-falso-para-teste");

      const videoResponse = await fetch(`${codeUrl}/api/code-executions/${execution.id}/test-results/qa-radar-teste/video.webm`, { headers: authorization });
      assert.equal(videoResponse.status, 200);
      assert.equal(videoResponse.headers.get("content-type"), "video/webm");
      assert.equal(videoResponse.headers.get("content-length"), "video-falso-para-teste".length.toString());
      assert.notEqual(videoResponse.headers.get("transfer-encoding"), "chunked");
    } finally {
      await new Promise<void>((resolve, reject) => codeServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("expõe os passos derivados do código e permite sobrescrever a descrição no relatório", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-steps-"));
    const codeServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codeRunner: async () => ({ exitCode: 0, stdout: '{"stats":{"expected":1}}', stderr: "" }),
    });
    await new Promise<void>((resolve) => codeServer.listen(0, "127.0.0.1", resolve));
    const address = codeServer.address() as AddressInfo;
    const codeUrl = `http://127.0.0.1:${address.port}`;
    const code =
      "import { test } from '@playwright/test';\n" +
      "test('busca', async ({ page }) => {\n" +
      "  await page.goto('https://example.com');\n" +
      "  await page.getByRole('button', { name: 'Estou com sorte' }).click();\n" +
      "});\n";
    try {
      const executionResponse = await fetch(`${codeUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const execution = (await executionResponse.json()) as { id: string; accessToken: string };
      const authorization = { authorization: `Bearer ${execution.accessToken}` };

      const stepsResponse = await fetch(`${codeUrl}/api/code-executions/${execution.id}/steps`, { headers: authorization });
      assert.equal(stepsResponse.status, 200);
      const { steps } = (await stepsResponse.json()) as { steps: Array<{ index: number; action: string; description: string }> };
      assert.equal(steps.length, 2);
      assert.match(steps[1]?.description ?? "", /Clicar em await page\.getByRole/);

      const overriddenReport = await fetch(`${codeUrl}/api/code-executions/${execution.id}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: JSON.stringify({ testerName: "QA", testType: "smoke", stepDescriptions: ["", "Clicar em Estou com sorte"] }),
      });
      assert.equal(overriddenReport.status, 201);
      const html = await (await fetch(`${codeUrl}/api/code-executions/${execution.id}/code-evidence.html`, { headers: authorization })).text();
      assert.match(html, /Clicar em Estou com sorte/);
      assert.doesNotMatch(html, /Clicar em await page\.getByRole/);

      const rejected = await fetch(`${codeUrl}/api/code-executions/${execution.id}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: JSON.stringify({ testerName: "QA", testType: "smoke", stepDescriptions: "não é lista" }),
      });
      assert.equal(rejected.status, 400);
    } finally {
      await new Promise<void>((resolve, reject) => codeServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("valida entrada e libera nova gravação do Codegen após falha do processo", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-codegen-validation-"));
    const processEvents = new EventEmitter();
    Object.assign(processEvents, { pid: 4321, kill: () => true });
    const codegenServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codegenSpawner: () => processEvents as unknown as ChildProcess,
    });
    await new Promise<void>((resolve) => codegenServer.listen(0, "127.0.0.1", resolve));
    const address = codegenServer.address() as AddressInfo;
    const codegenUrl = `http://127.0.0.1:${address.port}`;
    try {
      const missingUrl = await fetch(`${codegenUrl}/api/codegen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(missingUrl.status, 400);
      assert.match(((await missingUrl.json()) as { error: string }).error, /Informe a URL/);

      const invalidProtocol = await fetch(`${codegenUrl}/api/codegen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "ftp://example.com" }),
      });
      assert.equal(invalidProtocol.status, 400);
      assert.match(((await invalidProtocol.json()) as { error: string }).error, /http ou https/);

      const unknownStatus = await fetch(`${codegenUrl}/api/codegen/${randomUUID()}`, {
        headers: { authorization: "Bearer qualquer-coisa" },
      });
      assert.equal(unknownStatus.status, 404);

      const started = await fetch(`${codegenUrl}/api/codegen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      assert.equal(started.status, 201);

      const blockedWhileActive = await fetch(`${codegenUrl}/api/codegen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      assert.equal(blockedWhileActive.status, 429);

      processEvents.emit("error", new Error("processo do Codegen falhou"));

      const afterFailure = await fetch(`${codegenUrl}/api/codegen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      assert.equal(afterFailure.status, 201);
    } finally {
      processEvents.emit("exit", 0);
      await new Promise<void>((resolve, reject) => codegenServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("reporta falha da execução de código e rejeita corpo JSON malformado", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-failure-"));
    const codeServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codeRunner: async () => ({ exitCode: 1, stdout: '{"stats":{"expected":1,"unexpected":1}}', stderr: "falhou" }),
    });
    await new Promise<void>((resolve) => codeServer.listen(0, "127.0.0.1", resolve));
    const address = codeServer.address() as AddressInfo;
    const codeUrl = `http://127.0.0.1:${address.port}`;
    try {
      const malformed = await fetch(`${codeUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ isto não é JSON",
      });
      assert.equal(malformed.status, 400);
      assert.match(((await malformed.json()) as { error: string }).error, /Corpo JSON inválido/);

      const failed = await fetch(`${codeUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "import { test } from '@playwright/test'; test('x', async () => { throw new Error('falhou'); });" }),
      });
      assert.equal(failed.status, 422);
      const body = (await failed.json()) as { status: string; report: { stats: { unexpected: number } } };
      assert.equal(body.status, "failed");
      assert.equal(body.report.stats.unexpected, 1);
    } finally {
      await new Promise<void>((resolve, reject) => codeServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("protege e valida os endpoints de artefatos e relatório do Modo Jornada", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-artifacts-"));
    const codeServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codeRunner: async ({ outputDir }) => {
        const mediaDir = join(outputDir, "test-results", "qa-radar-teste");
        await mkdir(mediaDir, { recursive: true });
        await writeFile(join(mediaDir, "screenshot.png"), Buffer.from("imagem-falsa-para-teste"));
        return { exitCode: 0, stdout: '{"stats":{"expected":1}}', stderr: "" };
      },
    });
    await new Promise<void>((resolve) => codeServer.listen(0, "127.0.0.1", resolve));
    const address = codeServer.address() as AddressInfo;
    const codeUrl = `http://127.0.0.1:${address.port}`;
    try {
      const executionResponse = await fetch(`${codeUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "import { test } from '@playwright/test'; test('ok', async () => {});" }),
      });
      const execution = (await executionResponse.json()) as { id: string; accessToken: string };
      const authorization = { authorization: `Bearer ${execution.accessToken}` };
      const wrongAuthorization = { authorization: "Bearer token-incorreto" };
      const unknownId = randomUUID();

      const missingStepsToken = await fetch(`${codeUrl}/api/code-executions/${execution.id}/steps`);
      assert.equal(missingStepsToken.status, 401);
      const wrongStepsToken = await fetch(`${codeUrl}/api/code-executions/${execution.id}/steps`, { headers: wrongAuthorization });
      assert.equal(wrongStepsToken.status, 403);
      const unknownSteps = await fetch(`${codeUrl}/api/code-executions/${unknownId}/steps`, { headers: authorization });
      assert.equal(unknownSteps.status, 404);

      const unknownEvidence = await fetch(`${codeUrl}/api/code-executions/${unknownId}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: JSON.stringify({ testerName: "QA", testType: "smoke" }),
      });
      assert.equal(unknownEvidence.status, 404);

      const missingField = await fetch(`${codeUrl}/api/code-executions/${execution.id}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: JSON.stringify({ testerName: "QA" }),
      });
      assert.equal(missingField.status, 400);

      const screenshotUrl = `${codeUrl}/api/code-executions/${execution.id}/test-results/qa-radar-teste/screenshot.png`;
      const wrongScreenshotToken = await fetch(screenshotUrl, { headers: wrongAuthorization });
      assert.equal(wrongScreenshotToken.status, 403);
      const screenshot = await fetch(screenshotUrl, { headers: authorization });
      assert.equal(screenshot.status, 200);
      assert.equal(screenshot.headers.get("content-type"), "image/png");
      assert.equal(screenshot.headers.get("content-length"), "imagem-falsa-para-teste".length.toString());

      const unknownFile = await fetch(`${codeUrl}/api/code-executions/${execution.id}/test-results/qa-radar-teste/nao-existe.png`, { headers: authorization });
      assert.equal(unknownFile.status, 404);
      const unknownExecutionArtifact = await fetch(`${codeUrl}/api/code-executions/${unknownId}/code-evidence.html`, { headers: authorization });
      assert.equal(unknownExecutionArtifact.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => codeServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("associa cada passo capturado pelo fixture à sua própria screenshot, sem desalinhar", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-step-images-"));
    const codeServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codeRunner: async ({ outputDir }) => {
        // Simula o que o fixture (src/code-step-fixtures.ts) realmente produz:
        // uma screenshot numerada por ação instrumentada (goto e click aqui).
        const stepsDir = join(outputDir, "test-results", "qa-radar-steps");
        await mkdir(stepsDir, { recursive: true });
        await writeFile(join(stepsDir, "000.png"), Buffer.from("screenshot-do-goto"));
        await writeFile(join(stepsDir, "001.png"), Buffer.from("screenshot-do-click"));
        return { exitCode: 0, stdout: '{"stats":{"expected":1}}', stderr: "" };
      },
    });
    await new Promise<void>((resolve) => codeServer.listen(0, "127.0.0.1", resolve));
    const address = codeServer.address() as AddressInfo;
    const codeUrl = `http://127.0.0.1:${address.port}`;
    const code =
      "import { test } from '@playwright/test';\n" +
      "test('busca', async ({ page }) => {\n" +
      "  await page.goto('https://example.com');\n" +
      "  await page.getByRole('button', { name: 'Buscar' }).click();\n" +
      "});\n";
    try {
      const executionResponse = await fetch(`${codeUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const execution = (await executionResponse.json()) as { id: string; accessToken: string };
      const authorization = { authorization: `Bearer ${execution.accessToken}` };

      const stepsResponse = await fetch(`${codeUrl}/api/code-executions/${execution.id}/steps`, { headers: authorization });
      const { steps } = (await stepsResponse.json()) as { steps: Array<{ index: number; action: string }> };
      assert.equal(steps.length, 2);
      assert.equal(steps[0]?.action, "goto");
      assert.equal(steps[1]?.action, "click");

      await fetch(`${codeUrl}/api/code-executions/${execution.id}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: JSON.stringify({ testerName: "QA", testType: "smoke" }),
      });
      const html = await (await fetch(`${codeUrl}/api/code-executions/${execution.id}/code-evidence.html`, { headers: authorization })).text();
      const images = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)].map((match) => Buffer.from(match[1] ?? "", "base64").toString("utf8"));
      assert.deepEqual(images, ["screenshot-do-goto", "screenshot-do-click"]);
    } finally {
      await new Promise<void>((resolve, reject) => codeServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("protege, limita e cancela jornadas assíncronas", async () => {
    const journeyServer = createQaRadarServer({
      allowJourneys: true,
      allowPrivateTargets: true,
      maxSitemapPages: 5,
      maxJourneySteps: 2,
      journeyRunner: async (_options, _definition, _environment, signal) =>
        new Promise<never>((_resolve, reject) => {
          const abort = () => reject(signal?.reason ?? new Error("abortada"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        }),
    });
    await new Promise<void>((resolve) => journeyServer.listen(0, "127.0.0.1", resolve));
    const address = journeyServer.address() as AddressInfo;
    const journeyUrl = `http://127.0.0.1:${address.port}`;
    const request = (steps: unknown[]) =>
      fetch(`${journeyUrl}/api/journeys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: journeyUrl,
          journey: { schemaVersion: "1.0", name: "Protegida", steps },
        }),
      });
    try {
      const excessive = await request([
        { action: "assertVisible", selector: "body" },
        { action: "assertVisible", selector: "main" },
        { action: "assertVisible", selector: "footer" },
      ]);
      assert.equal(excessive.status, 400);
      assert.match(((await excessive.json()) as { error: string }).error, /no máximo 2 passos/);

      const createdResponse = await request([{ action: "assertVisible", selector: "body" }]);
      const created = (await createdResponse.json()) as { id: string; accessToken: string; status: string };
      assert.equal(createdResponse.status, 202);
      assert.equal(created.status, "running");
      assert.match(createdResponse.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict/);

      assert.equal((await fetch(`${journeyUrl}/api/journeys/${created.id}`)).status, 401);
      const headers = { authorization: `Bearer ${created.accessToken}` };
      const cancel = await fetch(`${journeyUrl}/api/journeys/${created.id}/cancel`, { method: "POST", headers });
      assert.equal(cancel.status, 202);
      await waitFor(async () => {
        const response = await fetch(`${journeyUrl}/api/journeys/${created.id}`, { headers });
        return ((await response.json()) as { status: string }).status === "cancelled";
      });
    } finally {
      await new Promise<void>((resolve) => journeyServer.close(() => resolve()));
    }
  });

  it("aplica timeout global às jornadas", async () => {
    const journeyServer = createQaRadarServer({
      allowJourneys: true,
      allowPrivateTargets: true,
      maxJourneyDurationMs: 25,
      journeyRunner: async (_options, _definition, _environment, signal) =>
        new Promise<never>((_resolve, reject) => {
          const abort = () => reject(signal?.reason ?? new Error("abortada"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        }),
    });
    await new Promise<void>((resolve) => journeyServer.listen(0, "127.0.0.1", resolve));
    const address = journeyServer.address() as AddressInfo;
    const journeyUrl = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${journeyUrl}/api/journeys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: journeyUrl,
          journey: { schemaVersion: "1.0", name: "Timeout", steps: [{ action: "assertVisible", selector: "body" }] },
        }),
      });
      const created = (await response.json()) as { id: string; accessToken: string };
      const headers = { authorization: `Bearer ${created.accessToken}` };
      await waitFor(async () => {
        const status = await fetch(`${journeyUrl}/api/journeys/${created.id}`, { headers });
        const job = (await status.json()) as { status: string; error?: string };
        return job.status === "failed" && /limite global de 25 ms/.test(job.error ?? "");
      });
    } finally {
      await new Promise<void>((resolve) => journeyServer.close(() => resolve()));
    }
  });

  it("expõe o estado de saúde sem iniciar uma análise", async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { status: string; active: number; queued: number };
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok", active: 0, queued: 0, jobs: 0 });
  });

  it("reporta o estado de saúde como erro quando resultsDir não pode ser criado", async () => {
    const tempParent = await mkdtemp(join(tmpdir(), "qa-radar-health-"));
    const resultsDir = join(tempParent, "blocked-by-a-file", "results");
    await writeFile(join(tempParent, "blocked-by-a-file"), "");
    const unhealthyServer = createQaRadarServer({ resultsDir });
    await new Promise<void>((resolve) => unhealthyServer.listen(0, "127.0.0.1", resolve));
    const address = unhealthyServer.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      const body = (await response.json()) as { status: string; reason: string };
      assert.equal(response.status, 503);
      assert.deepEqual(body, { status: "error", reason: "results-dir-unwritable" });
    } finally {
      await new Promise<void>((resolve, reject) => unhealthyServer.close((error) => (error ? reject(error) : resolve())));
      await rm(tempParent, { recursive: true, force: true });
    }
  });

  it("valida entradas antes de criar uma análise", async () => {
    const response = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 400);
    assert.match(body.error, /HTTP ou HTTPS/);
  });

  it("bloqueia destinos privados e limites abusivos", async () => {
    for (const payload of [{ url: "http://127.0.0.1:8080" }, { url: "http://10.0.0.1" }, { url: "https://example.com", timeoutMs: 120001 }, { url: "https://example.com", settleMs: 30001 }]) {
      const response = await fetch(`${baseUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 400);
    }
  });

  it("responde 404 para rotas desconhecidas", async () => {
    const response = await fetch(`${baseUrl}/nao-existe`);
    assert.equal(response.status, 404);
  });

  it("aplica rate limit por cliente e publica os cabeçalhos da janela", async () => {
    const limitedServer = createQaRadarServer({
      allowPrivateTargets: true,
      concurrency: 0,
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
    });
    await new Promise<void>((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
    const address = limitedServer.address() as AddressInfo;
    const limitedUrl = `http://127.0.0.1:${address.port}`;
    const request = () =>
      fetch(`${limitedUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: limitedUrl }),
      });
    try {
      const accepted = await request();
      assert.equal(accepted.status, 202);
      assert.equal(accepted.headers.get("x-ratelimit-limit"), "1");
      assert.equal(accepted.headers.get("x-ratelimit-remaining"), "0");

      const blocked = await request();
      assert.equal(blocked.status, 429);
      assert.equal(blocked.headers.get("x-ratelimit-remaining"), "0");
      assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    } finally {
      await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
    }
  });

  it("expõe progresso aditivo e cancela uma análise na fila", async () => {
    const queuedServer = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true });
    await new Promise<void>((resolve) => queuedServer.listen(0, "127.0.0.1", resolve));
    const address = queuedServer.address() as AddressInfo;
    const queuedUrl = `http://127.0.0.1:${address.port}`;
    try {
      const createResponse = await fetch(`${queuedUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: queuedUrl }),
      });
      const created = (await createResponse.json()) as {
        id: string;
        accessToken: string;
        status: string;
        queuePosition: number;
        progress: { discoveredPages: number; completedPages: number; percent: number; stage: string };
      };
      assert.equal(created.status, "queued");
      assert.match(created.accessToken, /^[A-Za-z0-9_-]{40,}$/);
      assert.match(createResponse.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict/);
      assert.equal(created.queuePosition, 1);
      assert.deepEqual(created.progress, {
        discoveredPages: 0,
        completedPages: 0,
        percent: 0,
        stage: "queued",
      });

      const authorization = { authorization: `Bearer ${created.accessToken}` };
      const deniedResponse = await fetch(`${queuedUrl}/api/scans/${created.id}`);
      assert.equal(deniedResponse.status, 401);
      const forbiddenResponse = await fetch(`${queuedUrl}/api/scans/${created.id}`, {
        headers: { authorization: "Bearer token-incorreto" },
      });
      assert.equal(forbiddenResponse.status, 403);

      const cancelResponse = await fetch(`${queuedUrl}/api/scans/${created.id}/cancel`, {
        method: "POST",
        headers: authorization,
      });
      const cancelled = (await cancelResponse.json()) as { status: string };
      assert.equal(cancelResponse.status, 202);
      assert.equal(cancelled.status, "cancelled");

      const statusResponse = await fetch(`${queuedUrl}/api/scans/${created.id}`, { headers: authorization });
      const status = (await statusResponse.json()) as { status: string; accessToken?: string };
      assert.equal(status.status, "cancelled");
      assert.equal(status.accessToken, undefined);
    } finally {
      await new Promise<void>((resolve) => queuedServer.close(() => resolve()));
    }
  });

  it("interrompe a análise ao atingir o timeout global do servidor", async () => {
    const timeoutServer = createQaRadarServer({
      allowPrivateTargets: true,
      maxJobDurationMs: 25,
      scanRunner: async (_options, control) =>
        new Promise<never>((_resolve, reject) => {
          const fail = () => reject(control?.signal?.reason ?? new Error("abortada"));
          if (control?.signal?.aborted) fail();
          else control?.signal?.addEventListener("abort", fail, { once: true });
        }),
    });
    await new Promise<void>((resolve) => timeoutServer.listen(0, "127.0.0.1", resolve));
    const address = timeoutServer.address() as AddressInfo;
    const timeoutUrl = `http://127.0.0.1:${address.port}`;
    try {
      const createResponse = await fetch(`${timeoutUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: timeoutUrl }),
      });
      const created = (await createResponse.json()) as { id: string; accessToken: string };
      const headers = { authorization: `Bearer ${created.accessToken}` };
      await waitFor(async () => {
        const response = await fetch(`${timeoutUrl}/api/scans/${created.id}`, { headers });
        const job = (await response.json()) as { status: string; error?: string };
        return job.status === "failed" && /limite global de 25 ms/.test(job.error ?? "");
      });
    } finally {
      await new Promise<void>((resolve) => timeoutServer.close(() => resolve()));
    }
  });

  it("não expõe histórico quando o recurso está desabilitado", async () => {
    const response = await fetch(`${baseUrl}/api/history?project=loja&environment=staging`);
    assert.equal(response.status, 403);
  });

  it("recupera relatórios do disco quando o job não está mais na memória", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-recovery-"));
    const id = "11111111-1111-4111-8111-111111111111";
    const outputDir = join(resultsDir, id);
    const accessToken = "recovery-test-token";
    await mkdir(outputDir);
    await writeFile(join(outputDir, ".access-token.sha256"), createHash("sha256").update(accessToken).digest("hex"));
    await writeFile(
      join(outputDir, "report.json"),
      JSON.stringify({
        tool: "QA Radar",
        version: "3.0.1",
        startedAt: "2026-07-14T00:00:00.000Z",
        targetUrl: "https://example.com/",
        issues: [],
      }),
    );
    await writeFile(join(outputDir, "report.html"), "<h1>Relatório recuperado</h1>");
    const recoveryServer = createQaRadarServer({ resultsDir });
    await new Promise<void>((resolve) => recoveryServer.listen(0, "127.0.0.1", resolve));
    const address = recoveryServer.address() as AddressInfo;
    const recoveryUrl = `http://127.0.0.1:${address.port}/api/scans/${id}`;
    try {
      const headers = { authorization: `Bearer ${accessToken}` };
      const statusResponse = await fetch(recoveryUrl, { headers });
      const status = (await statusResponse.json()) as { status: string };
      assert.equal(status.status, "completed");
      const htmlResponse = await fetch(`${recoveryUrl}/report.html`, { headers });
      assert.equal(htmlResponse.status, 200);
      assert.equal(htmlResponse.headers.get("cache-control"), "private, no-store");
      assert.match(htmlResponse.headers.get("content-security-policy") ?? "", /sandbox/);
      assert.match(await htmlResponse.text(), /Relatório recuperado/);
    } finally {
      await new Promise<void>((resolve) => recoveryServer.close(() => resolve()));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("expira jobs e registra a remoção depois da retenção", async () => {
    const events: OperationalEvent[] = [];
    const expirationServer = createQaRadarServer({
      allowPrivateTargets: true,
      retentionMs: 25,
      operationalLogger: (event) => events.push(event),
    });
    await new Promise<void>((resolve) => expirationServer.listen(0, "127.0.0.1", resolve));
    const address = expirationServer.address() as AddressInfo;
    const expirationUrl = `http://127.0.0.1:${address.port}`;
    try {
      const createResponse = await fetch(`${expirationUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: expirationUrl, sitemap: true, maxPages: 1 }),
      });
      const created = (await createResponse.json()) as { id: string };
      assert.equal(createResponse.status, 202);

      await waitFor(() => events.some((event) => event.event === "scan.expired"));
      const statusResponse = await fetch(`${expirationUrl}/api/scans/${created.id}`);
      assert.equal(statusResponse.status, 404);
      assert.deepEqual(
        events.map((event) => event.event),
        ["scan.started", "scan.failed", "scan.expired"],
      );
      assert.equal(events.at(-1)?.jobs, 0);
    } finally {
      await new Promise<void>((resolve) => expirationServer.close(() => resolve()));
    }
  });
});
