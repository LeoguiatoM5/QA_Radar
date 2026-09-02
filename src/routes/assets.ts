import { BROWSER_MODULE_HEADERS, browserModule } from "../browser-assets.js";
import type { RouteHandler } from "./context.js";

/**
 * Módulos de navegador do produto, servidos de `src/browser/`.
 *
 * A lista fecha a rota: sem ela, o nome vindo da URL viraria leitura de arquivo
 * arbitrária dentro do diretório.
 */
const MODULES = new Set(["applications", "auth"]);

export const tryHandleAssets: RouteHandler = async (_context, request, response, url) => {
  if (request.method !== "GET" || !url.pathname.startsWith("/assets/js/")) return false;
  const name = /^([a-z0-9-]+)\.js$/.exec(url.pathname.slice("/assets/js/".length))?.[1];
  const code = name ? await browserModule("browser", MODULES, name) : undefined;
  if (code === undefined) return false;
  response.writeHead(200, BROWSER_MODULE_HEADERS);
  response.end(code);
  return true;
};
