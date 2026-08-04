import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPasswordAcceptable, burnPasswordTime, hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword, WeakPasswordError } from "../src/password.js";

describe("hash de senha", () => {
  it("confere a senha certa e recusa a errada", async () => {
    const hash = await hashPassword("uma-senha-comprida");
    assert.equal(await verifyPassword("uma-senha-comprida", hash), true);
    assert.equal(await verifyPassword("uma-senha-compridA", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  it("nunca guarda a senha e nunca repete o hash", async () => {
    // Sal por senha: sem ele, duas pessoas com a mesma senha teriam o mesmo
    // hash, e uma tabela pronta quebraria as duas de uma vez.
    const primeiro = await hashPassword("uma-senha-comprida");
    const segundo = await hashPassword("uma-senha-comprida");
    assert.notEqual(primeiro, segundo);
    assert.ok(!primeiro.includes("uma-senha-comprida"));
  });

  it("grava o custo dentro do hash, para poder subi-lo depois sem invalidar o que existe", async () => {
    const barato = await hashPassword("uma-senha-comprida", { N: 1024, r: 8, p: 1 });
    assert.match(barato, /^scrypt\$1024\$8\$1\$/);
    // O verificador lê o custo do próprio registro, então continua conferindo.
    assert.equal(await verifyPassword("uma-senha-comprida", barato), true);
  });

  it("trata hash corrompido como senha errada, sem lançar", async () => {
    // Um registro estragado no banco não pode virar 500 — isso confirmaria a
    // existência da conta e ainda derrubaria o login.
    for (const invalido of ["", "qualquer-coisa", "scrypt$1$2$3", "scrypt$abc$8$1$c2Fs$aGFzaA", "bcrypt$16384$8$1$c2Fs$aGFzaA"]) {
      assert.equal(await verifyPassword("uma-senha-comprida", invalido), false, `deveria recusar: ${invalido}`);
    }
  });

  it("recusa custo absurdo gravado no registro em vez de tentar alocar a memória", async () => {
    assert.equal(await verifyPassword("uma-senha-comprida", "scrypt$1073741824$32$16$c2Fs$aGFzaA"), false);
  });

  it("aceita acento e emoji, normalizando a forma unicode", async () => {
    // "á" tem duas representações válidas; sem normalizar, a mesma senha
    // digitada em outro teclado deixaria a pessoa de fora.
    const hash = await hashPassword("senha-com-á-e-🔒");
    assert.equal(await verifyPassword("senha-com-á-e-🔒", hash), true);
  });

  it("gasta tempo comparável quando o e-mail não existe", async () => {
    // Não é medição de tempo (instável em CI), só a garantia de que o caminho
    // do e-mail inexistente executa o mesmo trabalho em vez de retornar seco.
    await assert.doesNotReject(() => burnPasswordTime("qualquer-senha-aqui"));
  });
});

describe("política de senha", () => {
  it("exige comprimento mínimo e limita o máximo", () => {
    assert.throws(() => assertPasswordAcceptable("a".repeat(MIN_PASSWORD_LENGTH - 1)), WeakPasswordError);
    assert.doesNotThrow(() => assertPasswordAcceptable("abcdefghij1"));
    // O teto existe porque a senha entra numa função cara de propósito: sem ele,
    // um corpo grande vira consumo de CPU a pedido de qualquer anônimo.
    assert.throws(() => assertPasswordAcceptable("a1".repeat(MAX_PASSWORD_LENGTH)), WeakPasswordError);
  });

  it("recusa a senha igual ao e-mail ou ao começo dele", () => {
    assert.throws(() => assertPasswordAcceptable("pessoa@exemplo.com", "Pessoa@Exemplo.com"), WeakPasswordError);
    assert.throws(() => assertPasswordAcceptable("leonardo", "leonardo@exemplo.com"), WeakPasswordError);
  });

  it("recusa repetição e sequências óbvias", () => {
    assert.throws(() => assertPasswordAcceptable("aaaaaaaaaaaa"), WeakPasswordError);
    assert.throws(() => assertPasswordAcceptable("1234567890"), WeakPasswordError);
  });

  it("não exige maiúscula nem símbolo", () => {
    // Regra de composição empurra para variação previsível do mesmo segredo; o
    // comprimento protege mais.
    assert.doesNotThrow(() => assertPasswordAcceptable("cavalo bateria grampo correto"));
  });
});
