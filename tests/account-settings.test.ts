import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryIdentityStore } from "../src/identity.js";
import { InMemoryAccountSettingsRepository } from "../src/account-settings-repository.js";
import { resolveAccountSettings, DEFAULT_SCAN_DEFAULTS } from "../src/account-settings.js";
import { DEFAULT_ALERT_THRESHOLDS } from "../src/alerts.js";

describe("resolveAccountSettings", () => {
  it("sem nada gravado, devolve o padrão do produto inteiro", () => {
    const settings = resolveAccountSettings(undefined);
    assert.deepEqual(settings.alerts, DEFAULT_ALERT_THRESHOLDS);
    assert.deepEqual(settings.scanDefaults, DEFAULT_SCAN_DEFAULTS);
  });

  it("mescla o que foi gravado com o padrão, campo a campo", () => {
    const settings = resolveAccountSettings({ alertWindowDays: 30, scanScreenshot: "always" });
    assert.equal(settings.alerts.windowDays, 30);
    assert.equal(settings.alerts.thresholdPoints, DEFAULT_ALERT_THRESHOLDS.thresholdPoints, "campo não gravado continua no padrão");
    assert.equal(settings.alerts.minSample, DEFAULT_ALERT_THRESHOLDS.minSample);
    assert.equal(settings.scanDefaults.screenshot, "always");
    assert.equal(settings.scanDefaults.timeoutMs, DEFAULT_SCAN_DEFAULTS.timeoutMs);
  });
});

describe("GET/PATCH /api/v1/account/settings", () => {
  async function startServer(withAccountSettings = true) {
    const server = createQaRadarServer({
      sessionSecret: "segredo-de-sessao-com-32-bytes-x",
      identity: new InMemoryIdentityStore(),
      accountSettings: withAccountSettings ? new InMemoryAccountSettingsRepository() : undefined,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  async function signUp(baseUrl: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `dono-${randomUUID()}@exemplo.com`, password: "uma-senha-bem-comprida" }),
    });
    assert.equal(response.status, 201);
    return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }

  it("exige conta tanto no GET quanto no PATCH", async () => {
    const { baseUrl, close } = await startServer();
    try {
      assert.equal((await fetch(`${baseUrl}/api/v1/account/settings`)).status, 401);
      assert.equal((await fetch(`${baseUrl}/api/v1/account/settings`, { method: "PATCH", body: "{}" })).status, 401);
    } finally {
      await close();
    }
  });

  it("recusa método diferente de GET/PATCH com 405", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl);
      assert.equal((await fetch(`${baseUrl}/api/v1/account/settings`, { method: "DELETE", headers: { cookie } })).status, 405);
    } finally {
      await close();
    }
  });

  it("GET sem nada ajustado devolve o padrão do produto", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl);
      const response = await fetch(`${baseUrl}/api/v1/account/settings`, { headers: { cookie } });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { alerts: typeof DEFAULT_ALERT_THRESHOLDS; scanDefaults: typeof DEFAULT_SCAN_DEFAULTS };
      assert.deepEqual(body.alerts, DEFAULT_ALERT_THRESHOLDS);
      assert.deepEqual(body.scanDefaults, DEFAULT_SCAN_DEFAULTS);
    } finally {
      await close();
    }
  });

  it("PATCH sem accountSettings configurado responde feature_disabled", async () => {
    const { baseUrl, close } = await startServer(false);
    try {
      const cookie = await signUp(baseUrl);
      const response = await fetch(`${baseUrl}/api/v1/account/settings`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ alerts: { windowDays: 30 } }),
      });
      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as { code: string }).code, "feature_disabled");
    } finally {
      await close();
    }
  });

  it("PATCH recusa campo fora do intervalo aceito", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl);
      const response = await fetch(`${baseUrl}/api/v1/account/settings`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ alerts: { windowDays: 200 } }),
      });
      assert.equal(response.status, 400);
    } finally {
      await close();
    }
  });

  it("PATCH recusa política de screenshot desconhecida", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl);
      const response = await fetch(`${baseUrl}/api/v1/account/settings`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ scanDefaults: { screenshot: "sempre-por-favor" } }),
      });
      assert.equal(response.status, 400);
    } finally {
      await close();
    }
  });

  it("PATCH corpo vazio responde 400 em vez de não fazer nada silenciosamente", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl);
      const response = await fetch(`${baseUrl}/api/v1/account/settings`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: "{}" });
      assert.equal(response.status, 400);
    } finally {
      await close();
    }
  });

  it("PATCH altera só os campos enviados, em chamadas separadas", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl);
      const primeira = await fetch(`${baseUrl}/api/v1/account/settings`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ alerts: { windowDays: 30, thresholdPoints: 20, minSample: 10 } }),
      });
      assert.equal(primeira.status, 200);

      const segunda = await fetch(`${baseUrl}/api/v1/account/settings`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ scanDefaults: { timeoutMs: 60_000, settleMs: 3_000, ignoredStatuses: "500", screenshot: "never" } }),
      });
      assert.equal(segunda.status, 200);
      const body = (await segunda.json()) as { alerts: typeof DEFAULT_ALERT_THRESHOLDS; scanDefaults: typeof DEFAULT_SCAN_DEFAULTS };
      // O ajuste da primeira chamada precisa sobreviver à segunda.
      assert.equal(body.alerts.windowDays, 30);
      assert.equal(body.alerts.thresholdPoints, 20);
      assert.equal(body.alerts.minSample, 10);
      assert.equal(body.scanDefaults.timeoutMs, 60_000);
      assert.equal(body.scanDefaults.screenshot, "never");
    } finally {
      await close();
    }
  });
});
