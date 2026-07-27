import { LanguageVariant, SyntaxKind } from "typescript/unstable/ast";
import { createScanner } from "typescript/unstable/ast/scanner";

const ALLOWED_HOSTED_IMPORTS = new Set(["@playwright/test", "playwright/test"]);
const FORBIDDEN_IDENTIFIERS = new Set([
  "process",
  "require",
  "eval",
  "global",
  "globalThis",
  "Function",
]);

interface Token {
  kind: SyntaxKind;
  text: string;
  value: string;
}

function scan(source: string): Token[] {
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const tokens: Token[] = [];
  for (;;) {
    const kind = scanner.scan();
    if (kind === SyntaxKind.EndOfFile) return tokens;
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
    });
  }
}

function assertAllowedModule(name: string): void {
  if (!ALLOWED_HOSTED_IMPORTS.has(name)) {
    throw new Error(
      `Importação não permitida na execução hospedada: ${name}. Use somente a API oficial do Playwright.`,
    );
  }
}

export function assertHostedPlaywrightCode(source: string): void {
  const tokens = scan(source);
  for (const [index, token] of tokens.entries()) {
    const previous = tokens[index - 1];
    const next = tokens[index + 1];

    if (FORBIDDEN_IDENTIFIERS.has(token.text)) {
      if (token.text === "Function") {
        throw new Error("Construção dinâmica de funções não é permitida na execução hospedada.");
      }
      throw new Error(`A API ${token.text} não é permitida na execução hospedada.`);
    }
    if (
      token.text === "import"
      && next?.kind === SyntaxKind.OpenParenToken
    ) {
      throw new Error("Importações dinâmicas não são permitidas na execução hospedada.");
    }
    if (
      (token.kind === SyntaxKind.StringLiteral || token.kind === SyntaxKind.NoSubstitutionTemplateLiteral)
      && token.value === "constructor"
    ) {
      throw new Error("Acesso dinâmico a constructor não é permitido na execução hospedada.");
    }
    if (
      token.kind === SyntaxKind.StringLiteral
      && (previous?.text === "from" || previous?.text === "import")
    ) {
      assertAllowedModule(token.value);
    }
  }
}
