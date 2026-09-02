import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Módulos de navegador servidos a partir do TypeScript do projeto.
 *
 * O produto nasceu com a interface inteira dentro de `String.raw`: o JavaScript
 * do cliente era texto para o `tsc` e para o `eslint`, então nenhum dos dois
 * olhava para ele. Foi de lá que saíram os bugs de UI mais caros — inclusive um
 * erro de sintaxe que passou pelo build, pelos 553 testes e só apareceu abrindo
 * a página. Escrever o cliente como módulo de verdade devolve as duas redes.
 *
 * O caminho é o mesmo que o Toolbox já usava: em produção lê o `.js` que o
 * `tsc` emitiu; em desenvolvimento, onde o servidor roda o TypeScript direto
 * pelo tsx e o `.js` não existe, transpila na hora com o mesmo compilador.
 */
const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));

const cache = new Map<string, string>();

async function transpile(path: string): Promise<string | undefined> {
  let source: string;
  try {
    source = await readFile(`${path}.ts`, "utf8");
  } catch {
    return undefined;
  }
  const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
  }).outputText;
}

/**
 * Código de um módulo de navegador, ou `undefined` se ele não está na lista.
 *
 * A lista é obrigatória: sem ela a rota viraria leitura arbitrária de arquivo a
 * partir de um caminho vindo da URL.
 */
export async function browserModule(directory: string, allowed: ReadonlySet<string>, name: string): Promise<string | undefined> {
  if (!allowed.has(name)) return undefined;
  const key = `${directory}/${name}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const path = join(SOURCE_ROOT, directory, name);
  let code: string;
  try {
    code = await readFile(`${path}.js`, "utf8");
  } catch {
    const transpiled = await transpile(path);
    if (transpiled === undefined) return undefined;
    code = transpiled;
  }

  // O `.js` do build aponta para um `.map` que nenhuma rota serve: sem tirar a
  // referência, abrir o DevTools rende um 404 por módulo carregado.
  const served = code.replace(/\n?\/\/# sourceMappingURL=.*$/m, "\n");
  cache.set(key, served);
  return served;
}

/** Cabeçalhos de um módulo ES servido ao navegador. */
export const BROWSER_MODULE_HEADERS = {
  "content-type": "text/javascript; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;
