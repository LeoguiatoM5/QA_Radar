import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeModeEnabledForHost, loadEnvironmentConfig } from "../src/env.js";

describe("configuração de ambiente", () => {
  it("habilita o Modo Jornada de Playwright por padrão somente em host local", () => {
    assert.equal(codeModeEnabledForHost("127.0.0.1"), true);
    assert.equal(codeModeEnabledForHost("localhost"), true);
    assert.equal(codeModeEnabledForHost("::1"), true);
    assert.equal(codeModeEnabledForHost("0.0.0.0"), false);
    assert.equal(codeModeEnabledForHost("0.0.0.0", "true"), true);
    assert.equal(codeModeEnabledForHost("127.0.0.1", "false"), false);
    assert.throws(() => codeModeEnabledForHost("127.0.0.1", "yes"), /deve ser true ou false/);
  });

  it("trata QA_RADAR_ENABLE_CODE_MODE vazio como não informado", () => {
    // Um painel de hospedagem pode criar a chave sem valor; isso não pode
    // derrubar o processo no boot, só cair no padrão por host.
    assert.equal(codeModeEnabledForHost("0.0.0.0", ""), false);
    assert.equal(codeModeEnabledForHost("0.0.0.0", "   "), false);
    assert.equal(codeModeEnabledForHost("127.0.0.1", ""), true);
    assert.equal(codeModeEnabledForHost("0.0.0.0", " true "), true);
    assert.equal(codeModeEnabledForHost("127.0.0.1", " false "), false);
    assert.equal(loadEnvironmentConfig({ HOST: "0.0.0.0", QA_RADAR_ENABLE_CODE_MODE: "" }).serverOptions.allowCodeMode, false);
  });

  it("aplica os valores padrão quando nenhuma variável é informada", () => {
    const env = loadEnvironmentConfig({});
    assert.equal(env.host, "127.0.0.1");
    assert.equal(env.port, 4173);
    assert.equal(env.sandbox, undefined);
    assert.equal(env.serverOptions.allowPrivateTargets, false);
    assert.equal(env.serverOptions.trustProxy, false);
    assert.equal(env.serverOptions.allowHistory, false);
    assert.equal(env.serverOptions.allowCodeMode, true);
    assert.equal(env.serverOptions.concurrency, 2);
    assert.equal(env.serverOptions.maxQueueSize, 20);
    assert.equal(env.serverOptions.rateLimitMax, 10);
    assert.equal(env.serverOptions.retentionMs, 60 * 60_000);
    assert.equal(env.serverOptions.maxJobDurationMs, 5 * 60_000);
    assert.equal(env.serverOptions.maxCodeExecutionDurationMs, 5 * 60_000);
    assert.equal(env.serverOptions.maxCodeOutputBytes, 1024 * 1024);
    assert.equal(env.serverOptions.maxCodeMemoryMiB, 512);
    assert.equal(env.serverOptions.maxCodegenDurationMs, 10 * 60_000);
    assert.equal(env.serverOptions.maxSitemapPages, 20);
  });

  it("lê host, porta e as flags booleanas quando informadas", () => {
    const env = loadEnvironmentConfig({
      HOST: "0.0.0.0",
      PORT: "8080",
      QA_RADAR_ALLOW_PRIVATE_TARGETS: "true",
      QA_RADAR_TRUST_PROXY: "true",
      QA_RADAR_ENABLE_HISTORY: "true",
      QA_RADAR_ENABLE_CODE_MODE: "true",
      QA_RADAR_CODE_MODE_ADMIN_TOKEN: "token-admin",
      TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_SECRET_KEY: "secret-key",
    });
    assert.equal(env.host, "0.0.0.0");
    assert.equal(env.port, 8080);
    assert.equal(env.serverOptions.allowPrivateTargets, true);
    assert.equal(env.serverOptions.trustProxy, true);
    assert.equal(env.serverOptions.allowHistory, true);
    assert.equal(env.serverOptions.allowCodeMode, true);
    assert.equal(env.serverOptions.codeModeAdminToken, "token-admin");
    assert.equal(env.serverOptions.turnstileSiteKey, "site-key");
    assert.equal(env.serverOptions.turnstileSecretKey, "secret-key");
  });

  it("valida PORT e os limites numéricos", () => {
    assert.throws(() => loadEnvironmentConfig({ PORT: "0" }), /PORT deve ser um número entre 1 e 65535/);
    assert.throws(() => loadEnvironmentConfig({ PORT: "70000" }), /PORT deve ser um número entre 1 e 65535/);
    assert.throws(() => loadEnvironmentConfig({ PORT: "abc" }), /PORT deve ser um número entre 1 e 65535/);
    assert.throws(() => loadEnvironmentConfig({ QA_RADAR_CONCURRENCY: "0" }), /QA_RADAR_CONCURRENCY deve ser um número inteiro positivo/);
    assert.throws(() => loadEnvironmentConfig({ QA_RADAR_MAX_SITEMAP_PAGES: "3.5" }), /QA_RADAR_MAX_SITEMAP_PAGES deve ser um número inteiro positivo/);
  });

  it("nomeia a chave de e-mail que falta, e não só o par", () => {
    // Uma mensagem que só diz "configure A e B em conjunto" manda a pessoa
    // reconferir as duas no painel para descobrir qual é. Isso já reprovou um
    // deploy real com a chave preenchida e o remetente ausente.
    assert.equal(loadEnvironmentConfig({}).email, undefined);
    assert.throws(() => loadEnvironmentConfig({ QA_RADAR_EMAIL_API_KEY: "chave" }), /Falta preencher QA_RADAR_EMAIL_FROM\b/);
    assert.throws(() => loadEnvironmentConfig({ QA_RADAR_EMAIL_FROM: "qa@exemplo.com" }), /Falta preencher QA_RADAR_EMAIL_API_KEY\b/);
    // Presente mas vazio é o que a hospedagem cria para uma chave `sync: false`
    // ainda não preenchida: tem de contar como ausente, não como configurada.
    assert.throws(() => loadEnvironmentConfig({ QA_RADAR_EMAIL_API_KEY: "chave", QA_RADAR_EMAIL_FROM: "   " }), /Falta preencher QA_RADAR_EMAIL_FROM\b/);
  });

  it("monta o remetente com o nome padrão quando só o nome falta", () => {
    const env = loadEnvironmentConfig({ QA_RADAR_EMAIL_API_KEY: " chave ", QA_RADAR_EMAIL_FROM: " qa@exemplo.com " });
    assert.deepEqual(env.email, { apiKey: "chave", from: "qa@exemplo.com", fromName: "QA Radar" });
  });

  it("exige QA_RADAR_SANDBOX_URL e QA_RADAR_SANDBOX_SIGNING_SECRET em conjunto", () => {
    assert.equal(loadEnvironmentConfig({}).sandbox, undefined);
    assert.throws(() => loadEnvironmentConfig({ QA_RADAR_SANDBOX_URL: "https://sandbox.example.com" }), /QA_RADAR_SANDBOX_URL e QA_RADAR_SANDBOX_SIGNING_SECRET em conjunto/);
    assert.throws(() => loadEnvironmentConfig({ QA_RADAR_SANDBOX_SIGNING_SECRET: "segredo-com-32-bytes-no-minimo-ok" }), /QA_RADAR_SANDBOX_URL e QA_RADAR_SANDBOX_SIGNING_SECRET em conjunto/);
    const env = loadEnvironmentConfig({
      QA_RADAR_SANDBOX_URL: " https://sandbox.example.com ",
      QA_RADAR_SANDBOX_SIGNING_SECRET: "segredo-com-32-bytes-no-minimo-ok",
    });
    assert.deepEqual(env.sandbox, {
      url: "https://sandbox.example.com",
      signingSecret: "segredo-com-32-bytes-no-minimo-ok",
    });
  });

  it("normaliza o segredo do sandbox e ignora par vazio vindo do painel", () => {
    // O segredo é comparado byte a byte com o do runner: um \n colado junto
    // viraria 401 sem diagnóstico, então os dois lados fazem trim.
    const env = loadEnvironmentConfig({
      QA_RADAR_SANDBOX_URL: "https://sandbox.example.com",
      QA_RADAR_SANDBOX_SIGNING_SECRET: " segredo-com-32-bytes-no-minimo-ok\n",
    });
    assert.equal(env.sandbox?.signingSecret, "segredo-com-32-bytes-no-minimo-ok");
    // Chaves declaradas com `sync: false` no Blueprint chegam vazias até serem
    // preenchidas: isso é "sandbox não configurado", não erro de configuração.
    assert.equal(loadEnvironmentConfig({ QA_RADAR_SANDBOX_URL: "", QA_RADAR_SANDBOX_SIGNING_SECRET: "" }).sandbox, undefined);
    assert.equal(loadEnvironmentConfig({ QA_RADAR_SANDBOX_URL: "  ", QA_RADAR_SANDBOX_SIGNING_SECRET: "  " }).sandbox, undefined);
  });

  it("trata a persistência como opcional e ignora URL de banco vazia", () => {
    // Sem a variável o produto roda inteiro em memória: a CLI e o dashboard
    // local não podem passar a exigir um banco para funcionar.
    assert.equal(loadEnvironmentConfig({}).databaseUrl, undefined);
    // Chave declarada no Blueprint mas ainda não preenchida chega vazia, e isso
    // é "sem banco", não configuração inválida.
    assert.equal(loadEnvironmentConfig({ QA_RADAR_DATABASE_URL: "" }).databaseUrl, undefined);
    assert.equal(loadEnvironmentConfig({ QA_RADAR_DATABASE_URL: "   " }).databaseUrl, undefined);
    assert.equal(loadEnvironmentConfig({ QA_RADAR_DATABASE_URL: " postgresql://u:p@host/db " }).databaseUrl, "postgresql://u:p@host/db");
  });
});
