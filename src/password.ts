import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Senha da conta.
 *
 * `scrypt` do próprio Node, e não argon2/bcrypt de terceiros, por dois motivos:
 * o produto é distribuído como pacote npm e como imagem Docker, e uma dependência
 * nativa quebraria a instalação em qualquer plataforma sem binário pronto; e a
 * CLI, que não tem senha nenhuma, carregaria o peso do mesmo jeito.
 *
 * O custo vai gravado dentro do hash. Subir o parâmetro depois passa a valer para
 * senhas novas sem invalidar as antigas — quem já tem conta continua entrando, e
 * a migração acontece sozinha na próxima troca de senha.
 */
const scrypt = promisify(scryptCallback) as (password: string | Buffer, salt: string | Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * N=16384, r=8 exige 16 MiB por verificação.
 *
 * O plano gratuito do Render dá 0,15 de CPU e 512 MB no total, compartilhados com
 * o Chromium das análises. Dobrar N aqui dobraria também o tempo de resposta do
 * login justamente na instância mais fraca, então o custo foi escolhido para o
 * hardware real e não para o ideal.
 */
export interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

const DEFAULT_COST: ScryptCost = { N: 16_384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** `maxmem` do Node é 32 MiB e não acompanha N: sem folga explícita, subir o custo passa a falhar em runtime. */
function maxmemFor(cost: ScryptCost): number {
  return 256 * cost.N * cost.r;
}

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Teto de 200 caracteres porque a senha entra numa função deliberadamente cara:
 * sem limite, um corpo de alguns megabytes vira consumo de CPU a pedido de
 * qualquer anônimo.
 */
export const MAX_PASSWORD_LENGTH = 200;

export class WeakPasswordError extends Error {}

/**
 * O que é recusado antes de virar hash.
 *
 * Sem exigência de maiúscula/símbolo de propósito: essas regras empurram a pessoa
 * para variações previsíveis do mesmo segredo e o comprimento sozinho protege
 * mais. O que é barrado aqui é o que aparece de fato em vazamento — a senha ser o
 * próprio e-mail e as sequências óbvias.
 */
export function assertPasswordAcceptable(password: string, email?: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);
  }
  const normalized = password.trim().toLowerCase();
  const normalizedEmail = email?.trim().toLowerCase();
  const localPart = normalizedEmail?.split("@")[0];
  const matchesEmail = normalized === normalizedEmail || (localPart !== undefined && localPart.length >= 4 && normalized === localPart);
  if (normalizedEmail !== undefined && matchesEmail) {
    throw new WeakPasswordError("A senha não pode ser igual ao seu e-mail.");
  }
  if (/^(.)\1+$/.test(password)) {
    throw new WeakPasswordError("A senha não pode ser um único caractere repetido.");
  }
  if (["1234567890", "0123456789", "qwertyuiop", "senha123456", "password123"].includes(normalized)) {
    throw new WeakPasswordError("Essa senha é previsível demais. Escolha outra.");
  }
}

/** Formato: `scrypt$N$r$p$salt$chave`, tudo em base64url. */
export async function hashPassword(password: string, cost: ScryptCost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...cost, maxmem: maxmemFor(cost) });
  return ["scrypt", cost.N, cost.r, cost.p, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

/**
 * Nunca lança por hash malformado: um registro corrompido no banco tem de virar
 * "senha errada", e não erro 500 que confirma a existência da conta.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts as [string, string, string, string, string, string];
  const cost = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) return false;
  if (cost.N <= 1 || cost.r <= 0 || cost.p <= 0) return false;
  // Um N absurdo gravado no banco viraria consumo de memória a pedido de quem
  // tentasse entrar naquela conta.
  if (cost.N > 1_048_576 || cost.r > 32 || cost.p > 16) return false;
  const expected = Buffer.from(rawKey, "base64url");
  if (expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), Buffer.from(rawSalt, "base64url"), expected.length, { ...cost, maxmem: maxmemFor(cost) });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Hash descartável para gastar o mesmo tempo quando o e-mail não existe.
 *
 * Sem isto, o login responde na hora para e-mail desconhecido e demora para o
 * conhecido — a diferença é medível e transforma a tela de login numa consulta
 * de "esta pessoa tem conta aqui?".
 */
export const DUMMY_PASSWORD_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

export async function burnPasswordTime(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_PASSWORD_HASH);
}
