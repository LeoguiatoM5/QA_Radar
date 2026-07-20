import { resolve } from "node:path";
import type {
  BrowserName,
  FailOn,
  ReportFormat,
  ScanOptions,
  ScreenshotMode,
} from "./types.js";

export const HELP = `
QA Radar - smoke testing sem testes predefinidos

Uso:
  qa-radar <url> [opções]
  npm run dev -- <url> [opções]

Opções:
  --browser <nome>       chromium, firefox ou webkit (padrão: chromium)
  --headed               Exibe o navegador (padrão: headless)
  --timeout <ms>         Timeout de navegação (padrão: 30000)
  --settle <ms>          Tempo para observar erros após carregar (padrão: 2000)
  --output <diretório>   Diretório dos artefatos (padrão: qa-radar-report)
  --format <formato>     console, json, html, junit, sarif ou all (padrão: all)
  --screenshot <modo>    never, on-failure ou always (padrão: on-failure)
  --fail-on <nível>      none, warning ou error (padrão: error)
  --baseline <arquivo>   Compara com um relatório JSON anterior
  --regressions-only     Aplica o quality gate somente a problemas novos
  --project <nome>       Mantém histórico e baseline automático do projeto
  --environment <nome>   Isola o histórico por ambiente (padrão: default)
  --history-dir <dir>    Diretório do histórico (padrão: .qa-radar-history)
  --accept-baseline      Promove esta execução mesmo se o gate reprovar
  --github-annotations   Emite erros e avisos no formato do GitHub Actions
  --sitemap              Analisa URLs publicadas em /sitemap.xml
  --max-pages <número>   Limite de páginas do sitemap (padrão: 20, máximo: 100)
  --ignore-status <lista> Status separados por vírgula, ex.: 401,404
  --ignore-url <regex>   Ignora URLs correspondentes; pode ser repetido
  -h, --help             Exibe esta ajuda
  -v, --version          Exibe a versão

Exit codes: 0 = aprovado, 1 = quality gate reprovado, 2 = erro de execução.
`.trim();

export interface ParsedCli {
  action: "scan" | "help" | "version";
  options: ScanOptions | undefined;
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`A opção ${option} exige um valor.`);
  }
  return value;
}

function positiveInteger(raw: string, option: string, allowZero = false): number {
  const value = Number(raw);
  const valid = Number.isInteger(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) throw new Error(`${option} deve ser um número inteiro ${allowZero ? "não negativo" : "positivo"}.`);
  return value;
}

function oneOf<T extends string>(raw: string, values: readonly T[], option: string): T {
  if (!values.includes(raw as T)) {
    throw new Error(`${option} deve ser: ${values.join(", ")}.`);
  }
  return raw as T;
}

function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`URL inválida: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("A URL deve utilizar HTTP ou HTTPS.");
  }
  return url.toString();
}

function identifier(raw: string, option: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(raw)) {
    throw new Error(`${option} deve conter de 1 a 64 letras, números, ponto, hífen ou underscore.`);
  }
  return raw.toLowerCase();
}

export function parseCli(args: string[]): ParsedCli {
  if (args.includes("--help") || args.includes("-h")) return { action: "help", options: undefined };
  if (args.includes("--version") || args.includes("-v")) return { action: "version", options: undefined };

  let rawUrl: string | undefined;
  let browser: BrowserName = "chromium";
  let headed = false;
  let timeoutMs = 30_000;
  let settleMs = 2_000;
  let outputDir = resolve("qa-radar-report");
  let format: ReportFormat = "all";
  let screenshot: ScreenshotMode = "on-failure";
  let failOn: FailOn = "error";
  let baselinePath: string | undefined;
  let regressionsOnly = false;
  let project: string | undefined;
  let environment: string | undefined;
  let historyDir = resolve(".qa-radar-history");
  let acceptBaseline = false;
  let githubAnnotations = false;
  let sitemap = false;
  let maxPages = 20;
  const ignoredStatuses = new Set<number>();
  const ignoredUrlPatterns: RegExp[] = [];
  const optionsWithValue = new Set([
    "--browser",
    "--timeout",
    "--settle",
    "--output",
    "--format",
    "--screenshot",
    "--fail-on",
    "--baseline",
    "--project",
    "--environment",
    "--history-dir",
    "--max-pages",
    "--ignore-status",
    "--ignore-url",
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (!arg.startsWith("-")) {
      if (rawUrl) throw new Error(`Argumento inesperado: ${arg}`);
      rawUrl = arg;
      continue;
    }

    if (arg === "--headed") {
      headed = true;
      continue;
    }
    if (arg === "--regressions-only") {
      regressionsOnly = true;
      continue;
    }
    if (arg === "--accept-baseline") {
      acceptBaseline = true;
      continue;
    }
    if (arg === "--github-annotations") {
      githubAnnotations = true;
      continue;
    }
    if (arg === "--sitemap") {
      sitemap = true;
      continue;
    }

    if (!optionsWithValue.has(arg)) throw new Error(`Opção desconhecida: ${arg}`);

    const value = takeValue(args, index, arg);
    index += 1;
    switch (arg) {
      case "--browser":
        browser = oneOf(value, ["chromium", "firefox", "webkit"] as const, arg);
        break;
      case "--timeout":
        timeoutMs = positiveInteger(value, arg);
        break;
      case "--settle":
        settleMs = positiveInteger(value, arg, true);
        break;
      case "--output":
        outputDir = resolve(value);
        break;
      case "--format":
        format = oneOf(value, ["console", "json", "html", "junit", "sarif", "all"] as const, arg);
        break;
      case "--screenshot":
        screenshot = oneOf(value, ["never", "on-failure", "always"] as const, arg);
        break;
      case "--fail-on":
        failOn = oneOf(value, ["none", "warning", "error"] as const, arg);
        break;
      case "--baseline":
        baselinePath = resolve(value);
        break;
      case "--project":
        project = identifier(value, arg);
        break;
      case "--environment":
        environment = identifier(value, arg);
        break;
      case "--history-dir":
        historyDir = resolve(value);
        break;
      case "--max-pages":
        maxPages = positiveInteger(value, arg);
        if (maxPages > 100) throw new Error("--max-pages deve ser no máximo 100.");
        break;
      case "--ignore-status":
        for (const status of value.split(",")) {
          ignoredStatuses.add(positiveInteger(status.trim(), arg));
        }
        break;
      case "--ignore-url":
        try {
          ignoredUrlPatterns.push(new RegExp(value));
        } catch {
          throw new Error(`Regex inválida em --ignore-url: ${value}`);
        }
        break;
    }
  }

  if (!rawUrl) throw new Error("Informe uma URL. Use --help para ver exemplos.");
  if (regressionsOnly && !baselinePath && !project) {
    throw new Error("--regressions-only exige --baseline ou --project.");
  }
  if (environment && !project) throw new Error("--environment exige a opção --project.");
  if (acceptBaseline && !project) throw new Error("--accept-baseline exige a opção --project.");

  return {
    action: "scan",
    options: {
      url: normalizeUrl(rawUrl),
      browser,
      headed,
      timeoutMs,
      settleMs,
      outputDir,
      format,
      screenshot,
      failOn,
      ignoredStatuses,
      ignoredUrlPatterns,
      ...(baselinePath ? { baselinePath } : {}),
      regressionsOnly,
      ...(project ? { project, environment: environment ?? "default", historyDir, acceptBaseline } : {}),
      githubAnnotations,
      sitemap,
      maxPages,
    },
  };
}
