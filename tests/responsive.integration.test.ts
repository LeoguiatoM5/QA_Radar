import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createQaRadarServer } from "../src/server.js";

describe("responsive integration", () => {
  it("mantém as páginas principais dentro do viewport mobile", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-responsive-"));
    const app = createQaRadarServer({ resultsDir, allowCodeMode: true });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const address = app.address() as AddressInfo;
    const appUrl = `http://127.0.0.1:${address.port}`;
    let browser: Browser | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

      for (const path of ["/", "/scanner", "/journeys", "/relatorios", "/central-de-qualidade", "/alertas", "/configuracoes", "/docs"]) {
        await page.goto(`${appUrl}${path}`, { waitUntil: "domcontentloaded" });
        const layout = await page.evaluate(() => {
          const visibleControls = [...document.querySelectorAll<HTMLElement>("input, select, textarea, button")].filter((element) => element.getClientRects().length > 0);
          return {
            h1Count: document.querySelectorAll("h1").length,
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            controlsOutsideViewport: visibleControls
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.left < -1 || rect.right > window.innerWidth + 1;
              })
              .map((element) => element.id || element.tagName.toLowerCase()),
          };
        });

        assert.equal(layout.innerWidth, 390, `${path}: viewport inesperado`);
        assert.equal(layout.scrollWidth, 390, `${path}: possui overflow horizontal`);
        assert.equal(layout.h1Count, 1, `${path}: deve conter um único h1`);
        assert.deepEqual(layout.controlsOutsideViewport, [], `${path}: possui controles fora da tela`);
      }

      await page.goto(`${appUrl}/journeys`, { waitUntil: "domcontentloaded" });
      assert.equal(await page.locator("#playwright-code").isVisible(), true);
      assert.equal(await page.locator("#code-execute").isVisible(), true);
      assert.equal(await page.locator("#journey-json").count(), 0);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });
});
