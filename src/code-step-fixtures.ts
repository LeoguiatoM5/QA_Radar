// Escrito em <outputDir>/qa-radar-fixtures.ts a cada execução local do Modo
// Código, e importado pelo .spec.ts do usuário no lugar de "@playwright/test"
// (a rota já reescreve o import; ver src/routes/code-execution.ts). Envolve
// os fixtures `page` e `request` do Playwright Test para capturar uma
// evidência real (screenshot ou requisição/resposta de API) após cada ação
// que muda o estado da página ou faz uma chamada HTTP, sem exigir nenhuma
// mudança no código do usuário.
//
// Só instrumenta exatamente as ações que codeReportAsJourney() (src/server.ts)
// reconhece e descreve como passo: goto, click, fill, selectOption e as
// chamadas request.get/post/put/patch/delete/head/fetch. Isso é proposital,
// não uma limitação esquecida: o relatório correlaciona cada evidência
// capturada aqui (screenshot .png ou requisição .json, num contador `stepIndex`
// compartilhado entre os dois fixtures) com o passo correspondente pela ORDEM
// em que aparecem, então instrumentar uma ação que o parser de descrição não
// reconhece (ex.: check/press) desalinharia essa correlação. Asserções
// (expect().toBeVisible(), waitFor) não mudam a página e também não são
// instrumentadas.
export const CODE_STEP_FIXTURES_SOURCE = `import { test as base, expect } from "playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
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
const MAX_BODY_CHARS = 2000;

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

function requestBodyOf(options) {
  if (!options || options.data === undefined) return undefined;
  return typeof options.data === "string" ? options.data : JSON.stringify(options.data);
}

async function captureApiStep(method, url, response, options) {
  try {
    await mkdir(STEP_DIR, { recursive: true });
    const path = join(STEP_DIR, String(stepIndex).padStart(3, "0") + ".json");
    stepIndex += 1;
    let responseBody = "";
    try {
      responseBody = await response.text();
    } catch {
      responseBody = "";
    }
    const requestBody = requestBodyOf(options);
    await writeFile(
      path,
      JSON.stringify({
        method: method.toUpperCase(),
        url: String(url),
        status: response.status(),
        ...(requestBody === undefined ? {} : { requestBody: requestBody.slice(0, MAX_BODY_CHARS) }),
        responseBody: responseBody.slice(0, MAX_BODY_CHARS),
      }),
    );
  } catch {
    // A evidência que falha nunca deve derrubar o teste do usuário.
  }
}

// get/post/put/patch/delete/head são apenas açúcar sintático que delega para
// fetch(url, { ...options, method }) dentro do próprio Playwright — instrumentar
// cada um deles individualmente capturaria a mesma chamada duas vezes (uma pelo
// método de conveniência, outra pelo fetch interno que ele invoca). Envolver só
// fetch(), lendo o método HTTP real de options.method, captura cada chamada
// exatamente uma vez, não importa qual método de conveniência o usuário chamou.
function instrumentRequest(request) {
  const original = request.fetch.bind(request);
  request.fetch = async (url, options) => {
    const response = await original(url, options);
    await captureApiStep((options && options.method) || "GET", url, response, options);
    return response;
  };
  return request;
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
  request: async ({ request }, use) => {
    await use(instrumentRequest(request));
  },
});
export { expect };
`;
