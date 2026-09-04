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
import { scanOptions } from "../src/routes/scans.js";
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
    // A Home não tem mais script embutido nenhum: só módulos de /assets/js/.
    assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self';/);
    assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", /script-src[^;]*'unsafe-inline'/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    // Conexão HTTP pura de teste, sem proxy confiável na frente: prometer
    // "sempre HTTPS" aqui seria falso, então HSTS fica de fora (ver o teste
    // dedicado abaixo para quando a conexão é HTTPS de verdade).
    assert.equal(response.headers.get("strict-transport-security"), null);
    assert.match(html, /Executar inspeção/);
    assert.match(html, /Executar jornada/);
    assert.doesNotMatch(html, /id="scan-form"/);
  });

  // BUG-20 do relatório de 04/09/2026: HSTS ausente numa aplicação servida só
  // por HTTPS. Só faz sentido mandar o cabeçalho quando a conexão realmente é
  // HTTPS — daí depender do mesmo sinal (`X-Forwarded-Proto` + `trustProxy`)
  // que `accessCookie` já usa para decidir o `Secure` do cookie.
  it("manda HSTS quando a conexão, via proxy confiável, é HTTPS de verdade", async () => {
    const secureServer = createQaRadarServer({ trustProxy: true });
    await new Promise<void>((resolve) => secureServer.listen(0, "127.0.0.1", resolve));
    const address = secureServer.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}`, { headers: { "x-forwarded-proto": "https" } });
      assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
    } finally {
      await new Promise<void>((resolve, reject) => secureServer.close((error) => (error ? reject(error) : resolve())));
    }
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

  it("entrega a ajuda em rota própria", async () => {
    const response = await fetch(`${baseUrl}/docs`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Perguntas frequentes/);
    assert.match(html, /href="\/scanner"/);
  });

  it("separa o Modo Jornada de Playwright do scanner e mostra indisponibilidade com segurança", async () => {
    const response = await fetch(`${baseUrl}/journeys`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Execução desligada neste servidor/);
    // Sem execução habilitada a página não pode oferecer o editor, só explicar como habilitar.
    assert.doesNotMatch(html, /id="playwright-code"/);
    assert.match(html, /QA_RADAR_SANDBOX_URL/);
    assert.doesNotMatch(html, /id="scan-form"/);
    assert.doesNotMatch(html, /id="journey-form"/);
  });

  it("entrega os Testes de API como cliente HTTP interativo, separado da Jornada", async () => {
    const response = await fetch(`${baseUrl}/api-tests`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /id="http-client-panel"/);
    assert.match(html, /id="http-send"/);
    assert.doesNotMatch(html, /id="scan-form"/);
    assert.doesNotMatch(html, /id="codegen-start"|id="playwright-code"/);
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

  it("responde 500 genérico a falhas não previstas, sem vazar a mensagem interna", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-internal-error-"));
    // O spawner é injetável e roda no caminho da requisição sem try/catch
    // local: é a forma determinística de provocar uma exceção não prevista.
    const failingServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codegenSpawner: () => {
        throw new TypeError("spawn ENOENT /caminho/interno/playwright/cli.js");
      },
    });
    await new Promise<void>((resolve) => failingServer.listen(0, "127.0.0.1", resolve));
    const address = failingServer.address() as AddressInfo;
    const originalError = console.error;
    console.error = () => {};
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/codegen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });
      // Antes do contrato de erros isto respondia 400 com a mensagem crua,
      // classificando um bug interno como erro do cliente.
      assert.equal(response.status, 500);
      const body = (await response.json()) as { error: string; code: string };
      assert.equal(body.code, "internal_error");
      assert.doesNotMatch(body.error, /spawn|caminho\/interno|cli\.js/);
    } finally {
      console.error = originalError;
      await new Promise<void>((resolve, reject) => failingServer.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("acompanha toda resposta de erro de um código estável de contrato", async () => {
    // Fora de /api, uma rota desconhecida é navegação e ganhou página própria
    // (ver BUG-15 em `mostra uma página com marca...`); o contrato de erro
    // estável que este teste acompanha é o da API.
    const notFound = await fetch(`${baseUrl}/api/rota-inexistente`);
    assert.equal(notFound.status, 404);
    assert.deepEqual(await notFound.json(), { error: "Rota não encontrada.", code: "not_found" });

    const invalid = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as { code: string }).code, "invalid_request");

    const disabled = await fetch(`${baseUrl}/api/history?project=loja&environment=staging`);
    assert.equal(disabled.status, 403);
    assert.equal(((await disabled.json()) as { code: string }).code, "feature_disabled");
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

  it("associa passos de API às suas evidências .json intercaladas com screenshots", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-api-steps-"));
    const codeServer = createQaRadarServer({
      allowCodeMode: true,
      resultsDir,
      codeRunner: async ({ outputDir }) => {
        // Simula o que o fixture (src/code-step-fixtures.ts) realmente produz
        // quando página e API se intercalam: 000 (goto, .png), 001 (API, .json).
        const stepsDir = join(outputDir, "test-results", "qa-radar-steps");
        await mkdir(stepsDir, { recursive: true });
        await writeFile(join(stepsDir, "000.png"), Buffer.from("screenshot-do-goto"));
        await writeFile(join(stepsDir, "001.json"), JSON.stringify({ method: "GET", url: "https://example.com/api/status", status: 200, responseBody: '{"ok":true}' }));
        return { exitCode: 0, stdout: '{"stats":{"expected":1}}', stderr: "" };
      },
    });
    await new Promise<void>((resolve) => codeServer.listen(0, "127.0.0.1", resolve));
    const address = codeServer.address() as AddressInfo;
    const codeUrl = `http://127.0.0.1:${address.port}`;
    const code =
      "import { test, expect } from '@playwright/test';\n" +
      "test('busca com API', async ({ page, request }) => {\n" +
      "  await page.goto('https://example.com');\n" +
      "  const apiResponse = await request.get('https://example.com/api/status');\n" +
      "  expect(apiResponse.status()).toBe(200);\n" +
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
      const { steps } = (await stepsResponse.json()) as { steps: Array<{ index: number; action: string; description: string }> };
      assert.equal(steps.length, 2);
      assert.equal(steps[0]?.action, "goto");
      assert.equal(steps[1]?.action, "apiRequest");
      assert.match(steps[1]?.description ?? "", /GET https:\/\/example\.com\/api\/status/);

      await fetch(`${codeUrl}/api/code-executions/${execution.id}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: JSON.stringify({ testerName: "QA", testType: "smoke" }),
      });
      const html = await (await fetch(`${codeUrl}/api/code-executions/${execution.id}/code-evidence.html`, { headers: authorization })).text();
      assert.match(html, /src="data:image\/png;base64,/);
      assert.match(html, /class="api-evidence"/);
      assert.match(html, /GET/);
      assert.match(html, /https:\/\/example\.com\/api\/status/);
      assert.match(html, /class="api-status ok">200/);
      assert.match(html, /\{&quot;ok&quot;:true\}/);
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

  it("reporta prontidão com o detalhe de cada dependência", async () => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = (await response.json()) as { status: string; checks: Record<string, unknown> };
    assert.equal(response.status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.checks.resultsDir, "ok");
    assert.equal(body.checks.queue, "ok");
    assert.equal(body.checks.codeMode, "disabled");
    // Sem banco nem storage configurados, os dois se declaram desligados em
    // vez de fingir que estão bem — é assim que se confere a provisionagem.
    assert.equal(body.checks.database, "disabled");
    assert.equal(body.checks.artifacts, "disabled");
  });

  it("reprova a prontidão quando resultsDir não pode ser criado, sem derrubar a vivacidade", async () => {
    const tempParent = await mkdtemp(join(tmpdir(), "qa-radar-health-"));
    const resultsDir = join(tempParent, "blocked-by-a-file", "results");
    await writeFile(join(tempParent, "blocked-by-a-file"), "");
    const unhealthyServer = createQaRadarServer({ resultsDir });
    await new Promise<void>((resolve) => unhealthyServer.listen(0, "127.0.0.1", resolve));
    const address = unhealthyServer.address() as AddressInfo;
    const unhealthyUrl = `http://127.0.0.1:${address.port}`;
    try {
      const ready = await fetch(`${unhealthyUrl}/ready`);
      const body = (await ready.json()) as { status: string; checks: { resultsDir: string } };
      assert.equal(ready.status, 503);
      assert.equal(body.status, "not_ready");
      assert.equal(body.checks.resultsDir, "unwritable");

      // O processo continua vivo: reiniciar o contêiner não conserta o disco,
      // então a vivacidade não pode cair junto com a prontidão.
      const health = await fetch(`${unhealthyUrl}/health`);
      assert.equal(health.status, 200);
      assert.equal(((await health.json()) as { status: string }).status, "ok");
    } finally {
      await new Promise<void>((resolve, reject) => unhealthyServer.close((error) => (error ? reject(error) : resolve())));
      await rm(tempParent, { recursive: true, force: true });
    }
  });

  it("marca a fila saturada sem reprovar a prontidão", async () => {
    // Reprovar por fila cheia faria a hospedagem reiniciar a instância
    // exatamente quando ela está ocupada trabalhando.
    const busyServer = createQaRadarServer({ concurrency: 0, maxQueueSize: 1, allowPrivateTargets: true });
    await new Promise<void>((resolve) => busyServer.listen(0, "127.0.0.1", resolve));
    const address = busyServer.address() as AddressInfo;
    const busyUrl = `http://127.0.0.1:${address.port}`;
    try {
      await fetch(`${busyUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: busyUrl }),
      });
      const ready = await fetch(`${busyUrl}/ready`);
      const body = (await ready.json()) as { status: string; checks: { queue: string } };
      assert.equal(ready.status, 200);
      assert.equal(body.status, "ready");
      assert.equal(body.checks.queue, "saturated");
    } finally {
      await new Promise<void>((resolve) => busyServer.close(() => resolve()));
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

  // BUG-15 do relatório de 04/09/2026: um link quebrado ou favorito antigo
  // caía num JSON cru, sem <title>, layout ou link de volta — um beco sem
  // saída. Uma navegação (GET fora de /api) agora recebe uma página; a API
  // continua devolvendo JSON, porque é isso que o cliente dela espera.
  it("mostra uma página com marca e link de volta para navegação em rota desconhecida, mas mantém JSON na API", async () => {
    const page = await fetch(`${baseUrl}/rota-que-nao-existe-123`);
    assert.equal(page.status, 404);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    const html = await page.text();
    assert.match(html, /<title>Página não encontrada/);
    assert.match(html, /href="\/"/);
    assert.match(html, /QA RADAR/);

    const api = await fetch(`${baseUrl}/api/v1/rota-que-nao-existe-123`);
    assert.equal(api.status, 404);
    assert.match(api.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(((await api.json()) as { code?: string }).code, "not_found");
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

  it("serve a API sob /api/v1 e mantém /api como alias, cada um com seu cookie", async () => {
    const versionedServer = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true });
    await new Promise<void>((resolve) => versionedServer.listen(0, "127.0.0.1", resolve));
    const address = versionedServer.address() as AddressInfo;
    const versionedUrl = `http://127.0.0.1:${address.port}`;
    try {
      const created = await fetch(`${versionedUrl}/api/v1/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: versionedUrl }),
      });
      assert.equal(created.status, 202);
      const job = (await created.json()) as { id: string; accessToken: string };

      // O cookie tem de apontar para o prefixo que o cliente usou: preso em
      // /api ele não acompanharia as consultas seguintes em /api/v1.
      assert.match(created.headers.get("set-cookie") ?? "", new RegExp(`Path=/api/v1/scans/${job.id}`));

      const status = await fetch(`${versionedUrl}/api/v1/scans/${job.id}`, {
        headers: { authorization: `Bearer ${job.accessToken}` },
      });
      assert.equal(status.status, 200);
      assert.equal(((await status.json()) as { id: string }).id, job.id);

      // O mesmo job continua acessível pelo caminho legado.
      const legacy = await fetch(`${versionedUrl}/api/scans/${job.id}`, {
        headers: { authorization: `Bearer ${job.accessToken}` },
      });
      assert.equal(legacy.status, 200);

      // A query string sobrevive à remoção do prefixo.
      const history = await fetch(`${versionedUrl}/api/v1/history?project=loja&environment=staging`);
      assert.equal(history.status, 403);
      assert.equal(((await history.json()) as { code: string }).code, "feature_disabled");

      // Uma versão que não existe não pode cair no alias por acidente.
      assert.equal((await fetch(`${versionedUrl}/api/v2/scans/${job.id}`)).status, 404);
    } finally {
      await new Promise<void>((resolve) => versionedServer.close(() => resolve()));
    }
  });

  it("repete a criação com Idempotency-Key sem enfileirar uma segunda análise", async () => {
    // concurrency 0 mantém o job na fila, que é onde a repetição importa.
    const idempotentServer = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true });
    await new Promise<void>((resolve) => idempotentServer.listen(0, "127.0.0.1", resolve));
    const address = idempotentServer.address() as AddressInfo;
    const idempotentUrl = `http://127.0.0.1:${address.port}`;
    const send = (key: string, body: Record<string, unknown>) =>
      fetch(`${idempotentUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
    try {
      const first = await send("chave-a", { url: idempotentUrl });
      assert.equal(first.status, 202);
      const created = (await first.json()) as { id: string; accessToken: string };

      // A repetição devolve o MESMO job e o mesmo token: sem o token o cliente
      // que perdeu a primeira resposta não conseguiria acompanhar a análise.
      const replay = await send("chave-a", { url: idempotentUrl });
      assert.equal(replay.status, 200);
      const replayed = (await replay.json()) as { id: string; accessToken: string; status: string };
      assert.equal(replayed.id, created.id);
      assert.equal(replayed.accessToken, created.accessToken);
      assert.equal(replayed.status, "queued");

      // Reusar a chave com outro corpo é erro do cliente, não uma repetição:
      // devolver o job antigo esconderia que a segunda análise nunca rodou.
      const divergent = await send("chave-a", { url: idempotentUrl, sitemap: false });
      assert.equal(divergent.status, 409);
      assert.equal(((await divergent.json()) as { code: string }).code, "conflict");

      const health = (await (await fetch(`${idempotentUrl}/health`)).json()) as { jobs: number };
      assert.equal(health.jobs, 1, "a repetição não pode ter criado um segundo job");

      // Chave diferente continua criando uma análise nova.
      const other = await send("chave-b", { url: idempotentUrl });
      assert.equal(other.status, 202);
      assert.notEqual(((await other.json()) as { id: string }).id, created.id);

      const invalidKey = await fetch(`${idempotentUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "chave inválida com espaços" },
        body: JSON.stringify({ url: idempotentUrl }),
      });
      assert.equal(invalidKey.status, 400);
      assert.equal(((await invalidKey.json()) as { code: string }).code, "invalid_request");
    } finally {
      await new Promise<void>((resolve) => idempotentServer.close(() => resolve()));
    }
  });

  it("converge ao repetir o cancelamento, mas recusa cancelar o que já concluiu", async () => {
    const cancelServer = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true });
    await new Promise<void>((resolve) => cancelServer.listen(0, "127.0.0.1", resolve));
    const address = cancelServer.address() as AddressInfo;
    const cancelUrl = `http://127.0.0.1:${address.port}`;
    try {
      const created = (await (
        await fetch(`${cancelUrl}/api/scans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: cancelUrl }),
        })
      ).json()) as { id: string; accessToken: string };
      const authorization = { authorization: `Bearer ${created.accessToken}` };
      const cancel = () => fetch(`${cancelUrl}/api/scans/${created.id}/cancel`, { method: "POST", headers: authorization });

      assert.equal((await cancel()).status, 202);
      // Repetir o cancelamento pede o mesmo estado a que o job já chegou.
      const second = await cancel();
      assert.equal(second.status, 202);
      assert.equal(((await second.json()) as { status: string }).status, "cancelled");
    } finally {
      await new Promise<void>((resolve) => cancelServer.close(() => resolve()));
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

  it("persiste atividades do dashboard com isolamento por navegador", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-dashboard-"));
    const dashboardServer = createQaRadarServer({ resultsDir });
    await new Promise<void>((resolve) => dashboardServer.listen(0, "127.0.0.1", resolve));
    const address = dashboardServer.address() as AddressInfo;
    const dashboardUrl = `http://127.0.0.1:${address.port}/api/dashboard/activity`;
    let cookie = "";
    try {
      const initialResponse = await fetch(dashboardUrl);
      cookie = (initialResponse.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      assert.match(cookie, /^qa_radar_dashboard=[0-9a-f-]+$/);
      assert.deepEqual(await initialResponse.json(), { activities: [] });

      const streamAbort = new AbortController();
      const streamResponse = await fetch(`${dashboardUrl}/events`, {
        headers: { cookie },
        signal: streamAbort.signal,
      });
      assert.equal(streamResponse.status, 200);
      assert.match(streamResponse.headers.get("content-type") ?? "", /^text\/event-stream/);
      const streamReader = streamResponse.body?.getReader();
      assert.ok(streamReader);
      const decoder = new TextDecoder();
      assert.match(decoder.decode((await streamReader.read()).value), /retry: 3000/);

      const createResponse = await fetch(dashboardUrl, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: "api-1",
          type: "api",
          title: "GET jsonplaceholder.typicode.com/todos/1",
          detail: "200 OK",
          status: "success",
          errors: 0,
          warnings: 0,
          durationMs: 120,
          href: "/api-tests?activity=1234567890123",
          scores: { http: 100 },
        }),
      });
      assert.equal(createResponse.status, 201);
      const streamedActivity = decoder.decode((await streamReader.read()).value);
      assert.match(streamedActivity, /^data: /);
      assert.equal((JSON.parse(streamedActivity.slice(6)) as { id: string }).id, "api-1");
      streamAbort.abort();

      const ownResponse = await fetch(dashboardUrl, { headers: { cookie } });
      const ownBody = (await ownResponse.json()) as { activities: Array<{ id: string; href: string }> };
      assert.equal(ownBody.activities.length, 1);
      assert.equal(ownBody.activities[0]?.id, "api-1");
      assert.equal(ownBody.activities[0]?.href, "/api-tests?activity=1234567890123");

      const isolatedResponse = await fetch(dashboardUrl);
      assert.deepEqual(await isolatedResponse.json(), { activities: [] });

      const unsafeResponse = await fetch(dashboardUrl, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          id: "unsafe",
          type: "api",
          title: "Inseguro",
          detail: "",
          status: "success",
          errors: 0,
          warnings: 0,
          durationMs: 1,
          href: "https://example.com/",
          scores: {},
        }),
      });
      assert.equal(unsafeResponse.status, 400);
    } finally {
      await new Promise<void>((resolve) => dashboardServer.close(() => resolve()));
    }

    const restartedServer = createQaRadarServer({ resultsDir });
    await new Promise<void>((resolve) => restartedServer.listen(0, "127.0.0.1", resolve));
    const restartedAddress = restartedServer.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${restartedAddress.port}/api/dashboard/activity`, { headers: { cookie } });
      const body = (await response.json()) as { activities: Array<{ id: string }> };
      assert.equal(body.activities[0]?.id, "api-1");

      const cleared = await fetch(`http://127.0.0.1:${restartedAddress.port}/api/dashboard/activity`, { method: "DELETE", headers: { cookie } });
      assert.equal(cleared.status, 204);

      const afterClear = await fetch(`http://127.0.0.1:${restartedAddress.port}/api/dashboard/activity`, { headers: { cookie } });
      assert.deepEqual(await afterClear.json(), { activities: [] });

      // Apagar duas vezes não é erro: quem clicou já não tem histórico nenhum.
      const again = await fetch(`http://127.0.0.1:${restartedAddress.port}/api/dashboard/activity`, { method: "DELETE", headers: { cookie } });
      assert.equal(again.status, 204);

      // E limpar um navegador não pode alcançar o histórico de outro.
      const otherUrl = `http://127.0.0.1:${restartedAddress.port}/api/dashboard/activity`;
      const otherCookie = ((await fetch(otherUrl)).headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      assert.notEqual(otherCookie, cookie);
      await fetch(otherUrl, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: otherCookie },
        body: JSON.stringify({
          id: "de-outro",
          type: "scan",
          title: "Inspeção de outro navegador",
          detail: "",
          status: "success",
          errors: 0,
          warnings: 0,
          durationMs: 10,
          href: "/scanner",
          scores: {},
        }),
      });
      await fetch(otherUrl, { method: "DELETE", headers: { cookie } });
      const otherBrowser = (await (await fetch(otherUrl, { headers: { cookie: otherCookie } })).json()) as { activities: Array<{ id: string }> };
      assert.deepEqual(
        otherBrowser.activities.map((item) => item.id),
        ["de-outro"],
      );
    } finally {
      await new Promise<void>((resolve) => restartedServer.close(() => resolve()));
      await rm(resultsDir, { recursive: true, force: true });
    }
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

describe("opções da análise", () => {
  const config = {
    resultsDir: "/tmp/qa-radar-results",
    historyDir: "/tmp/qa-radar-history",
    allowHistory: true,
    allowCustomIgnorePatterns: true,
    maxSitemapPages: 20,
  } as unknown as Parameters<typeof scanOptions>[2];

  // A barra de contexto do dashboard preenche o campo "Ambiente" sozinha, e
  // "Projeto" nasce vazio. Enquanto o par era obrigatório, a primeira execução
  // de quem nunca digitou um projeto morria com a mensagem da CLI
  // "--environment exige a opção --project".
  it("ignora ambiente e baseline quando não há projeto, em vez de reprovar", () => {
    const options = scanOptions({ url: "https://exemplo.com", environment: "local", acceptBaseline: true }, "/tmp/saida", config);

    assert.equal(options.environment, undefined);
    assert.ok(!options.acceptBaseline);
    assert.equal(options.project, undefined);
  });

  it("mantém ambiente e baseline quando o projeto existe", () => {
    const options = scanOptions({ url: "https://exemplo.com", project: "loja-web", environment: "staging", acceptBaseline: true }, "/tmp/saida", config);

    assert.equal(options.project, "loja-web");
    assert.equal(options.environment, "staging");
    assert.equal(options.acceptBaseline, true);
  });

  it("usa o padrão da conta quando o corpo não traz o campo", () => {
    const scanDefaults = { timeoutMs: 45_000, settleMs: 5_000, ignoredStatuses: "401,404", screenshot: "always" as const };
    const options = scanOptions({ url: "https://exemplo.com" }, "/tmp/saida", config, scanDefaults);

    assert.equal(options.timeoutMs, 45_000);
    assert.equal(options.settleMs, 5_000);
    assert.deepEqual([...options.ignoredStatuses], [401, 404]);
    assert.equal(options.screenshot, "always");
  });

  it("o campo enviado no corpo sempre vence o padrão da conta", () => {
    const scanDefaults = { timeoutMs: 45_000, settleMs: 5_000, ignoredStatuses: "401,404", screenshot: "always" as const };
    const options = scanOptions({ url: "https://exemplo.com", timeoutMs: 10_000, screenshot: "never" }, "/tmp/saida", config, scanDefaults);

    assert.equal(options.timeoutMs, 10_000);
    assert.equal(options.screenshot, "never");
    // Campos não enviados continuam caindo para o padrão da conta.
    assert.equal(options.settleMs, 5_000);
  });
});

describe("módulos de navegador", () => {
  // A rota é o que permite escrever o cliente como TypeScript de verdade em vez
  // de texto dentro de `String.raw`. A lista fechada é o que impede o nome vindo
  // da URL de virar leitura arbitrária de arquivo.
  it("serve o módulo listado e recusa qualquer outro caminho", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-assets-"));
    const assetServer = createQaRadarServer({ resultsDir });
    await new Promise<void>((resolve) => assetServer.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(assetServer.address() as AddressInfo).port}`;
    try {
      const servido = await fetch(`${base}/assets/js/auth.js`);
      assert.equal(servido.status, 200);
      assert.match(servido.headers.get("content-type") ?? "", /^text\/javascript/);
      assert.equal(servido.headers.get("x-content-type-options"), "nosniff");
      const code = await servido.text();
      assert.match(code, /auth-signin-form/);
      assert.doesNotMatch(code, /sourceMappingURL/, "o .map não é servido: a referência renderia 404 no DevTools");

      for (const caminho of ["/assets/js/server.js", "/assets/js/nao-existe.js", "/assets/js/auth.ts"]) {
        assert.equal((await fetch(`${base}${caminho}`)).status, 404, caminho);
      }
    } finally {
      await new Promise<void>((resolve) => assetServer.close(() => resolve()));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("libera 'self' no script-src de toda página que carrega módulo", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-csp-"));
    const cspServer = createQaRadarServer({ resultsDir, allowCodeMode: true });
    await new Promise<void>((resolve) => cspServer.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(cspServer.address() as AddressInfo).port}`;
    try {
      const paginas = ["/", "/scanner", "/journeys", "/api-tests", "/docs", "/aplicacoes", "/entrar", "/configuracoes", "/toolbox", "/toolbox/json-diff"];
      let comModulo = 0;
      for (const caminho of paginas) {
        const response = await fetch(`${base}${caminho}`);
        assert.equal(response.status, 200, caminho);
        const body = await response.text();
        if (!/src="\/assets\//.test(body)) continue;
        comModulo += 1;
        const csp = response.headers.get("content-security-policy") ?? "";
        const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";
        assert.match(scriptSrc, /'self'/, `${caminho} carrega módulo mas o script-src não permite 'self': o navegador bloqueia sem quebrar a página`);
      }
      assert.ok(comModulo >= 2, "o teste precisa estar olhando para páginas que de fato carregam módulo");
    } finally {
      await new Promise<void>((resolve) => cspServer.close(() => resolve()));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });
});
