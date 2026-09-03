import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryIdentityStore, type IdentityStore } from "../src/identity.js";
import { InMemoryApplicationRepository, type ApplicationRepository } from "../src/application-repository.js";
import { InMemoryCodeExecutionRepository, type CodeExecutionRepository } from "../src/code-execution-repository.js";

const SECRET = "segredo-de-sessao-com-32-bytes-x";

/**
 * Relatório mínimo no formato do reporter JSON do Playwright: é dele que sai o
 * resumo mostrado no histórico.
 */
function playwrightReport(title: string): string {
  return JSON.stringify({
    stats: { duration: 4321, expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
    suites: [{ title: "qa-radar.spec.ts", suites: [{ title: "fluxo", specs: [{ title }] }] }],
  });
}

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

interface Shared {
  identity: IdentityStore;
  applications: ApplicationRepository;
  codeExecutions: CodeExecutionRepository;
  resultsDir: string;
}

async function shared(): Promise<Shared> {
  return {
    identity: new InMemoryIdentityStore(),
    applications: new InMemoryApplicationRepository(),
    codeExecutions: new InMemoryCodeExecutionRepository(),
    resultsDir: await mkdtemp(join(tmpdir(), "qa-radar-journey-")),
  };
}

async function startServer(state: Shared, title = "compra concluída"): Promise<Harness> {
  const server = createQaRadarServer({
    allowPrivateTargets: true,
    concurrency: 0,
    sessionSecret: SECRET,
    allowCodeMode: true,
    resultsDir: state.resultsDir,
    identity: state.identity,
    applications: state.applications,
    codeExecutions: state.codeExecutions,
    codeRunner: async () => ({ stdout: playwrightReport(title), stderr: "", exitCode: 0 }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function signUp(baseUrl: string, email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "uma-senha-bem-comprida" }),
  });
  assert.equal(response.status, 201, `cadastro de ${email} falhou`);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function createApplication(baseUrl: string, cookie: string, name: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/applications`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name, baseUrl: "https://app.exemplo.com", environments: [] }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { application: { id: string } }).application.id;
}

async function runJourney(baseUrl: string, body: Record<string, unknown>, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/code-execution`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ code: "import { test } from '@playwright/test';\ntest('fluxo', async () => {});\n", ...body }),
  });
}

interface HistoryBody {
  scans?: Array<{ id: string }>;
  journeys?: Array<{ id: string; status: string; title?: string; durationMs?: number; tests?: { expected?: number } }>;
}

async function history(baseUrl: string, cookie: string, applicationId: string): Promise<HistoryBody> {
  const response = await fetch(`${baseUrl}/api/v1/applications/${applicationId}/scans`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return (await response.json()) as HistoryBody;
}

describe("Jornada · vínculo com aplicação", () => {
  it("guarda a execução na aplicação escolhida e a mostra no histórico dela", async () => {
    const state = await shared();
    const { baseUrl, close } = await startServer(state);
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const application = await createApplication(baseUrl, cookie, "Loja");
      const executada = await runJourney(baseUrl, { applicationId: application }, cookie);
      assert.equal(executada.status, 200);
      const { id } = (await executada.json()) as { id: string };

      const body = await history(baseUrl, cookie, application);
      assert.deepEqual(
        body.journeys?.map((journey) => journey.id),
        [id],
      );
      assert.equal(body.journeys?.[0]?.status, "passed");
      assert.equal(body.journeys?.[0]?.title, "compra concluída");
      assert.equal(body.journeys?.[0]?.durationMs, 4321);
      assert.equal(body.journeys?.[0]?.tests?.expected, 1);
    } finally {
      await close();
      await rm(state.resultsDir, { recursive: true, force: true });
    }
  });

  it("recusa apontar a execução para a aplicação de outra conta", async () => {
    // 404 e não 403: responder "proibido" confirmaria que aquele id existe na
    // conta de outra pessoa.
    const state = await shared();
    const { baseUrl, close } = await startServer(state);
    try {
      const dela = await signUp(baseUrl, "dela@exemplo.com");
      const application = await createApplication(baseUrl, dela, "Dela");
      const minha = await signUp(baseUrl, "eu@exemplo.com");
      const resposta = await runJourney(baseUrl, { applicationId: application }, minha);
      assert.equal(resposta.status, 404);
      assert.deepEqual((await history(baseUrl, dela, application)).journeys, []);
    } finally {
      await close();
      await rm(state.resultsDir, { recursive: true, force: true });
    }
  });

  it("exige conta para vincular a execução a uma aplicação", async () => {
    const state = await shared();
    const { baseUrl, close } = await startServer(state);
    try {
      const resposta = await runJourney(baseUrl, { applicationId: "00000000-0000-4000-8000-000000000000" });
      assert.equal(resposta.status, 401);
    } finally {
      await close();
      await rm(state.resultsDir, { recursive: true, force: true });
    }
  });
});

describe("Jornada · isolamento", () => {
  it("o dono lê a própria execução sem apresentar o token", async () => {
    const state = await shared();
    const { baseUrl, close } = await startServer(state);
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const { id } = (await (await runJourney(baseUrl, {}, cookie)).json()) as { id: string };
      const resposta = await fetch(`${baseUrl}/api/v1/code-executions/${id}/steps`, { headers: { cookie } });
      assert.equal(resposta.status, 200);
    } finally {
      await close();
      await rm(state.resultsDir, { recursive: true, force: true });
    }
  });

  it("outra conta não alcança a execução, mesmo logada", async () => {
    const state = await shared();
    const { baseUrl, close } = await startServer(state);
    try {
      const dono = await signUp(baseUrl, "dono@exemplo.com");
      const { id } = (await (await runJourney(baseUrl, {}, dono)).json()) as { id: string };
      const estranho = await signUp(baseUrl, "estranho@exemplo.com");
      const resposta = await fetch(`${baseUrl}/api/v1/code-executions/${id}/steps`, { headers: { cookie: estranho } });
      assert.equal(resposta.status, 401);
    } finally {
      await close();
      await rm(state.resultsDir, { recursive: true, force: true });
    }
  });

  it("execução anônima continua exigindo o token de quem está logado", async () => {
    // Sem dono ela não pertence a ninguém: entrar numa conta qualquer não pode
    // virar caminho para alcançar o que não é seu.
    const state = await shared();
    const { baseUrl, close } = await startServer(state);
    try {
      const anonima = await runJourney(baseUrl, {});
      const { id, accessToken } = (await anonima.json()) as { id: string; accessToken: string };
      const logado = await signUp(baseUrl, "curioso@exemplo.com");
      assert.equal((await fetch(`${baseUrl}/api/v1/code-executions/${id}/steps`, { headers: { cookie: logado } })).status, 401);
      assert.equal((await fetch(`${baseUrl}/api/v1/code-executions/${id}/steps`, { headers: { authorization: `Bearer ${accessToken}` } })).status, 200);
    } finally {
      await close();
      await rm(state.resultsDir, { recursive: true, force: true });
    }
  });
});

describe("Jornada · sobrevive ao reinício", () => {
  it("a execução continua legível por uma instância nova", async () => {
    // O ponto da fase: antes disto a execução vivia num Map do processo, e
    // qualquer reinício a levava junto.
    const state = await shared();
    const primeira = await startServer(state);
    let id: string;
    let cookie: string;
    let application: string;
    try {
      cookie = await signUp(primeira.baseUrl, "dono@exemplo.com");
      application = await createApplication(primeira.baseUrl, cookie, "Loja");
      id = ((await (await runJourney(primeira.baseUrl, { applicationId: application }, cookie)).json()) as { id: string }).id;
    } finally {
      await primeira.close();
    }

    const segunda = await startServer(state);
    try {
      const body = await history(segunda.baseUrl, cookie, application);
      assert.deepEqual(
        body.journeys?.map((journey) => journey.id),
        [id],
      );
      const resposta = await fetch(`${segunda.baseUrl}/api/v1/code-executions/${id}/steps`, { headers: { cookie } });
      assert.equal(resposta.status, 200);
    } finally {
      await segunda.close();
      await rm(state.resultsDir, { recursive: true, force: true });
    }
  });

  it("limpar o histórico apaga também as execuções da Jornada", async () => {
    const state = await shared();
    const { baseUrl, close } = await startServer(state);
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const application = await createApplication(baseUrl, cookie, "Loja");
      const { id } = (await (await runJourney(baseUrl, { applicationId: application }, cookie)).json()) as { id: string };

      const limpeza = await fetch(`${baseUrl}/api/v1/scans`, { method: "DELETE", headers: { cookie } });
      assert.equal(limpeza.status, 200);
      assert.equal(((await limpeza.json()) as { journeys: number }).journeys, 1);

      assert.deepEqual((await history(baseUrl, cookie, application)).journeys, []);
      // Apagar a linha e deixar a evidência no disco não é apagar: o link
      // continuaria abrindo o relatório.
      assert.equal((await fetch(`${baseUrl}/api/v1/code-executions/${id}/steps`, { headers: { cookie } })).status, 404);
    } finally {
      await close();
      await rm(state.resultsDir, { recursive: true, force: true });
    }
  });
});
