/**
 * Gerador de massa de teste sintética.
 *
 * Duas metades igualmente importantes: o dado válido, que faz o fluxo feliz
 * andar, e o dado **propositalmente inválido**, que é o que de fato encontra
 * bug. Cada tipo sabe produzir os dois, e a interface deixa explícito qual está
 * pedindo — massa inválida entregue como se fosse válida é pior que massa
 * nenhuma.
 *
 * Nada aqui usa `Math.random` diretamente: a fonte de aleatoriedade entra por
 * parâmetro, o que torna a geração reproduzível nos testes sem precisar de
 * mocks globais.
 */

export type TestDataFieldType = "name" | "cpf" | "cnpj" | "email" | "phone" | "uuid" | "date" | "birthdate" | "integer" | "decimal" | "boolean" | "text" | "cep";

export type TestDataMode = "valid" | "invalid";

export interface TestDataField {
  /** Nome da propriedade no JSON, da coluna no CSV e no SQL. */
  key: string;
  type: TestDataFieldType;
  mode: TestDataMode;
}

export type TestDataValue = string | number | boolean;

export type TestDataRow = Record<string, TestDataValue>;

export interface TestDataFieldDefinition {
  type: TestDataFieldType;
  label: string;
  /** Sugestão de nome da propriedade quando a pessoa marca o tipo. */
  defaultKey: string;
  /** O que a variação inválida produz, dito em uma linha na interface. */
  invalidHint: string;
}

export const TEST_DATA_FIELDS: readonly TestDataFieldDefinition[] = [
  { type: "name", label: "Nome", defaultKey: "nome", invalidHint: "Texto acima do tamanho normalmente aceito" },
  { type: "cpf", label: "CPF", defaultKey: "cpf", invalidHint: "Dígitos verificadores incorretos" },
  { type: "cnpj", label: "CNPJ", defaultKey: "cnpj", invalidHint: "Dígitos verificadores incorretos" },
  { type: "email", label: "E-mail", defaultKey: "email", invalidHint: "Endereço sem @ ou sem domínio" },
  { type: "phone", label: "Telefone", defaultKey: "telefone", invalidHint: "Quantidade de dígitos insuficiente" },
  { type: "uuid", label: "UUID", defaultKey: "id", invalidHint: "UUID truncado" },
  { type: "date", label: "Data", defaultKey: "data", invalidHint: "Dia que não existe no mês" },
  { type: "birthdate", label: "Data de nascimento", defaultKey: "dataNascimento", invalidHint: "Data no futuro" },
  { type: "integer", label: "Número inteiro", defaultKey: "quantidade", invalidHint: "Abaixo do mínimo e acima do máximo" },
  { type: "decimal", label: "Número decimal", defaultKey: "valor", invalidHint: "Valor negativo com casas demais" },
  { type: "boolean", label: "Boolean", defaultKey: "ativo", invalidHint: "Texto no lugar do booleano" },
  { type: "text", label: "Texto", defaultKey: "descricao", invalidHint: "String acima do tamanho permitido" },
  { type: "cep", label: "CEP", defaultKey: "cep", invalidHint: "CEP com menos dígitos" },
];

/** Fonte de aleatoriedade: `Math.random` em produção, sequência fixa nos testes. */
export type RandomSource = () => number;

const FIRST_NAMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabriela", "Heitor", "Isabela", "João", "Karina", "Lucas", "Mariana", "Nicolas", "Olívia", "Paulo"];
const LAST_NAMES = ["Almeida", "Barbosa", "Carvalho", "Duarte", "Esteves", "Ferreira", "Gomes", "Henriques", "Ibrahim", "Junqueira", "Klein", "Lima", "Moreira", "Nogueira", "Oliveira", "Pereira"];
const EMAIL_DOMAINS = ["exemplo.com", "teste.com.br", "qaradar.dev", "mail.example.org"];
const WORDS = ["cadastro", "pedido", "pagamento", "entrega", "estoque", "usuário", "relatório", "carrinho", "cupom", "assinatura"];

function pick<T>(items: readonly T[], random: RandomSource): T {
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  // `noUncheckedIndexedAccess` obriga o fallback; ele só é alcançável se a lista
  // estiver vazia, o que nenhuma das listas deste módulo permite.
  return items[index] ?? (items[0] as T);
}

function digits(count: number, random: RandomSource): string {
  let value = "";
  for (let index = 0; index < count; index += 1) value += String(Math.floor(random() * 10));
  return value;
}

function integerBetween(minimum: number, maximum: number, random: RandomSource): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function checkDigit(base: string, weights: readonly number[]): number {
  const sum = base.split("").reduce((total, digit, index) => total + Number(digit) * (weights[index] ?? 0), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

const CPF_FIRST_WEIGHTS = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const CPF_SECOND_WEIGHTS = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** CPF apenas com dígitos, com os dois verificadores corretos. */
export function generateCpf(random: RandomSource): string {
  let base = digits(9, random);
  // Todos os dígitos iguais passam no cálculo mas é recusado por qualquer
  // validação séria; gerar isso entregaria "válido" que reprova em produção.
  if (/^(\d)\1{8}$/.test(base)) base = `${base.slice(0, 8)}${(Number(base[8]) + 1) % 10}`;
  const first = checkDigit(base, CPF_FIRST_WEIGHTS);
  const second = checkDigit(`${base}${first}`, CPF_SECOND_WEIGHTS);
  return `${base}${first}${second}`;
}

export function isValidCpf(value: string): boolean {
  const clean = value.replace(/\D/g, "");
  if (clean.length !== 11 || /^(\d)\1{10}$/.test(clean)) return false;
  const base = clean.slice(0, 9);
  const first = checkDigit(base, CPF_FIRST_WEIGHTS);
  const second = checkDigit(`${base}${first}`, CPF_SECOND_WEIGHTS);
  return clean === `${base}${first}${second}`;
}

export function generateCnpj(random: RandomSource): string {
  const base = `${digits(8, random)}0001`;
  const first = checkDigit(base, CNPJ_FIRST_WEIGHTS);
  const second = checkDigit(`${base}${first}`, CNPJ_SECOND_WEIGHTS);
  return `${base}${first}${second}`;
}

export function isValidCnpj(value: string): boolean {
  const clean = value.replace(/\D/g, "");
  if (clean.length !== 14 || /^(\d)\1{13}$/.test(clean)) return false;
  const base = clean.slice(0, 12);
  const first = checkDigit(base, CNPJ_FIRST_WEIGHTS);
  const second = checkDigit(`${base}${first}`, CNPJ_SECOND_WEIGHTS);
  return clean === `${base}${first}${second}`;
}

/** Quebra o verificador sem mexer no formato: é assim que o campo reprova. */
function breakCheckDigits(document: string): string {
  const head = document.slice(0, -2);
  const tail = document.slice(-2);
  const broken = `${(Number(tail[0]) + 1) % 10}${(Number(tail[1]) + 1) % 10}`;
  return `${head}${broken}`;
}

function generateUuid(random: RandomSource): string {
  const hex = "0123456789abcdef";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    if (index === 12) value += "4";
    else if (index === 16) value += hex[8 + Math.floor(random() * 4)] ?? "8";
    else value += hex[Math.floor(random() * 16)] ?? "0";
  }
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function isoDay(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fullName(random: RandomSource): string {
  return `${pick(FIRST_NAMES, random)} ${pick(LAST_NAMES, random)}`;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
}

function sentence(random: RandomSource): string {
  const words = [pick(WORDS, random), pick(WORDS, random), pick(WORDS, random)];
  return `Cenário de ${words.join(" ")}`;
}

function generateValid(type: TestDataFieldType, random: RandomSource): TestDataValue {
  switch (type) {
    case "name":
      return fullName(random);
    case "cpf":
      return generateCpf(random);
    case "cnpj":
      return generateCnpj(random);
    case "email":
      return `${slug(fullName(random))}${integerBetween(1, 999, random)}@${pick(EMAIL_DOMAINS, random)}`;
    case "phone":
      return `(${integerBetween(11, 99, random)}) 9${digits(4, random)}-${digits(4, random)}`;
    case "uuid":
      return generateUuid(random);
    case "date":
      return isoDay(integerBetween(2020, 2026, random), integerBetween(1, 12, random), integerBetween(1, 28, random));
    case "birthdate":
      return isoDay(integerBetween(1950, 2006, random), integerBetween(1, 12, random), integerBetween(1, 28, random));
    case "integer":
      return integerBetween(1, 999, random);
    case "decimal":
      return Number((integerBetween(1, 99_999, random) / 100).toFixed(2));
    case "boolean":
      return random() >= 0.5;
    case "text":
      return sentence(random);
    case "cep":
      return `${digits(5, random)}-${digits(3, random)}`;
  }
}

function generateInvalid(type: TestDataFieldType, random: RandomSource): TestDataValue {
  switch (type) {
    case "name":
      // Acima do tamanho que praticamente todo cadastro aceita.
      return "N".repeat(300);
    case "cpf":
      return breakCheckDigits(generateCpf(random));
    case "cnpj":
      return breakCheckDigits(generateCnpj(random));
    case "email":
      return `${slug(fullName(random))}${pick(EMAIL_DOMAINS, random)}`;
    case "phone":
      return digits(4, random);
    case "uuid":
      return generateUuid(random).slice(0, 20);
    case "date":
      // 31 de fevereiro: formato correto, dia inexistente.
      return isoDay(integerBetween(2020, 2026, random), 2, 31);
    case "birthdate":
      return isoDay(integerBetween(2990, 2999, random), integerBetween(1, 12, random), integerBetween(1, 28, random));
    case "integer":
      // Alterna abaixo do mínimo e acima do máximo comum de um int de 32 bits.
      return random() >= 0.5 ? -1 : 2_147_483_648;
    case "decimal":
      return -Number(`${integerBetween(1, 999, random)}.98765`);
    case "boolean":
      return "sim";
    case "text":
      return "x".repeat(5000);
    case "cep":
      return digits(5, random);
  }
}

export function generateFieldValue(type: TestDataFieldType, mode: TestDataMode, random: RandomSource): TestDataValue {
  return mode === "valid" ? generateValid(type, random) : generateInvalid(type, random);
}

export interface TestDataRequest {
  fields: readonly TestDataField[];
  count: number;
}

export const MAX_TEST_DATA_ROWS = 1000;

/** Identificador aceito nos três formatos de saída ao mesmo tempo. */
const SAFE_FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function generateTestData(request: TestDataRequest, random: RandomSource = Math.random): TestDataRow[] {
  const { fields, count } = request;
  if (fields.length === 0) throw new Error("Escolha ao menos um campo.");
  if (!Number.isInteger(count) || count < 1) throw new Error("A quantidade deve ser um número inteiro maior que zero.");
  if (count > MAX_TEST_DATA_ROWS) throw new Error(`A quantidade máxima é ${MAX_TEST_DATA_ROWS} registros.`);
  const keys = new Set<string>();
  for (const field of fields) {
    const key = field.key.trim();
    if (!key) throw new Error("Todo campo precisa de um nome.");
    // O mesmo nome vira propriedade no JSON, coluna no CSV e **identificador no
    // INSERT**. Sem esta trava, `nome'); DROP TABLE users;--` sai como coluna
    // crua num SQL que alguém vai colar num banco.
    if (!SAFE_FIELD_KEY.test(key)) throw new Error(`Nome de campo inválido: ${key}. Use letras, números e _, começando por letra ou _.`);
    if (keys.has(key)) throw new Error(`Nome de campo repetido: ${key}.`);
    keys.add(key);
  }
  const rows: TestDataRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const row: TestDataRow = {};
    for (const field of fields) row[field.key.trim()] = generateFieldValue(field.type, field.mode, random);
    rows.push(row);
  }
  return rows;
}

function csvCell(value: TestDataValue): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function testDataToCsv(rows: readonly TestDataRow[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0] as TestDataRow);
  const header = columns.map((column) => csvCell(column)).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(","));
  return [header, ...body].join("\n");
}

function sqlLiteral(value: TestDataValue): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${value.replaceAll("'", "''")}'`;
}

export function testDataToSql(rows: readonly TestDataRow[], table = "test_data"): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0] as TestDataRow);
  const safeTable = /^[A-Za-z_][A-Za-z0-9_]*$/.test(table) ? table : "test_data";
  return rows.map((row) => `INSERT INTO ${safeTable} (${columns.join(", ")}) VALUES (${columns.map((column) => sqlLiteral(row[column] ?? "")).join(", ")});`).join("\n");
}
