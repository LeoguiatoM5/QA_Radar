/**
 * Ambientes oferecidos no seletor da barra de contexto.
 *
 * Fica em módulo próprio, e não em `web-components.ts` (onde nasceu), porque
 * o servidor precisa da mesma lista para validar o `environment` que chega
 * junto de cada análise/jornada/teste de API — sem isso, o filtro aceitaria
 * qualquer string e "todos os ambientes" e "ambiente digitado errado"
 * ficariam indistinguíveis.
 */
export const ENVIRONMENTS = [
  { slug: "local", label: "Local" },
  { slug: "homologacao", label: "Homologação" },
  { slug: "producao", label: "Produção" },
] as const;

export type EnvironmentSlug = (typeof ENVIRONMENTS)[number]["slug"];

const VALID_SLUGS: ReadonlySet<string> = new Set(ENVIRONMENTS.map((environment) => environment.slug));

/** `undefined` para "sem ambiente" (o valor não veio) ou um slug desconhecido — nunca lança. */
export function parseEnvironment(value: unknown): EnvironmentSlug | undefined {
  return typeof value === "string" && VALID_SLUGS.has(value) ? (value as EnvironmentSlug) : undefined;
}
