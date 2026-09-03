import { BROWSER_MODULE_HEADERS, browserModule } from "../browser-assets.js";
import type { RouteHandler } from "./context.js";

/**
 * Módulos de navegador do produto, servidos de `src/browser/`.
 *
 * A lista fecha a rota: sem ela, o nome vindo da URL viraria leitura de arquivo
 * arbitrária dentro do diretório.
 */
const MODULES = new Set(["alerts", "api-tests", "applications", "auth", "dashboard", "docs", "journey", "quality", "reports", "scanner", "shared", "shell"]);

/**
 * Módulos das telas do QA Toolbox, de `src/browser/toolbox/`.
 *
 * O nome de cada um é o id da ferramenta no catálogo, para que a página só
 * precise apontar para `/assets/js/toolbox/<id>.js`. `home` é a vitrine e `ui`
 * é o que as telas compartilham — ele é baixado pelo import delas, então
 * precisa estar na lista tanto quanto os demais.
 */
export const TOOLBOX_MODULES = new Set([
  "api-health",
  "boundary-values",
  "curl-converter",
  "home",
  "http-status",
  "json-diff",
  "json-schema",
  "jwt-inspector",
  "openapi-diff",
  "pairwise",
  "regex-tester",
  "test-data",
  "timestamp",
  "ui",
  "webhook-inspector",
]);

export const tryHandleAssets: RouteHandler = async (_context, request, response, url) => {
  if (request.method !== "GET" || !url.pathname.startsWith("/assets/js/")) return false;
  const rest = url.pathname.slice("/assets/js/".length);
  const toolbox = rest.startsWith("toolbox/");
  const name = /^([a-z0-9-]+)\.js$/.exec(toolbox ? rest.slice("toolbox/".length) : rest)?.[1];
  const code = name ? await browserModule(toolbox ? "browser/toolbox" : "browser", toolbox ? TOOLBOX_MODULES : MODULES, name) : undefined;
  if (code === undefined) return false;
  response.writeHead(200, BROWSER_MODULE_HEADERS);
  response.end(code);
  return true;
};
