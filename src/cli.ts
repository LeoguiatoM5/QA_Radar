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
  --format <formato>     console, json, html ou all (padrão: all)
  --screenshot <modo>    never, on-failure ou always (padrão: on-failure)
  --fail-on <nível>      none, warning ou error (padrão: error)
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
        format = oneOf(value, ["console", "json", "html", "all"] as const, arg);
        break;
      case "--screenshot":
        screenshot = oneOf(value, ["never", "on-failure", "always"] as const, arg);
        break;
      case "--fail-on":
        failOn = oneOf(value, ["none", "warning", "error"] as const, arg);
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
    },
  };
}
