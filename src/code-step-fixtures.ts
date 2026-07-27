// Escrito em <outputDir>/qa-radar-fixtures.ts a cada execução local do Modo
// Código, e importado pelo .spec.ts do usuário no lugar de "@playwright/test"
// (a rota já reescreve o import; ver src/routes/code-execution.ts). Envolve
// o fixture `page` do Playwright Test para capturar uma screenshot real após
// cada ação que muda o estado da página, sem exigir nenhuma mudança no
// código do usuário.
//
// Só instrumenta exatamente as ações que codeReportAsJourney() (src/server.ts)
// reconhece e descreve como passo: goto, click, fill, selectOption. Isso é
// proposital, não uma limitação esquecida: o relatório correlaciona cada
// screenshot capturada aqui com o passo correspondente pela ORDEM em que
// aparecem, então instrumentar uma ação que o parser de descrição não
// reconhece (ex.: check/press) desalinharia essa correlação. Asserções
// (expect().toBeVisible(), waitFor) não mudam a página e também não são
// instrumentadas.
export const CODE_STEP_FIXTURES_SOURCE = `import { test as base, expect } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const STEP_DIR = "test-results/qa-radar-steps";
const LOCATOR_FACTORIES = [
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
];
const ACTION_METHODS = ["click", "fill", "selectOption"];

let stepIndex = 0;

async function captureStep(page) {
  try {
    await mkdir(STEP_DIR, { recursive: true });
    const path = join(STEP_DIR, String(stepIndex).padStart(3, "0") + ".png");
    stepIndex += 1;
    await page.screenshot({ path, timeout: 5000 });
  } catch {
    // A screenshot que falha nunca deve derrubar o teste do usuário.
  }
}

function instrumentLocator(locator, page) {
  for (const method of ACTION_METHODS) {
    if (typeof locator[method] !== "function") continue;
    const original = locator[method].bind(locator);
    locator[method] = async (...args) => {
      try {
        return await original(...args);
      } finally {
        await captureStep(page);
      }
    };
  }
  return locator;
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const originalGoto = page.goto.bind(page);
    page.goto = async (...args) => {
      try {
        return await originalGoto(...args);
      } finally {
        await captureStep(page);
      }
    };
    for (const factory of LOCATOR_FACTORIES) {
      const original = page[factory].bind(page);
      page[factory] = (...args) => instrumentLocator(original(...args), page);
    }
    await use(page);
  },
});
export { expect };
`;
