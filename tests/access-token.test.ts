import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { MIN_ACCESS_TOKEN_SECRET_BYTES, createDerivedAccessTokenIssuer, createRandomAccessTokenIssuer } from "../src/access-token.js";

const SECRET = "segredo-de-servidor-com-32-bytes";
const OTHER_SECRET = "outro-segredo-de-servidor-32-byt";

describe("access token", () => {
  it("emite o mesmo token para a mesma análise, que é o que permite reemitir", () => {
    // Sem isto, a repetição de uma criação depois de um reinício não teria como
    // devolver um token utilizável sem guardá-lo em texto claro.
    const issuer = createDerivedAccessTokenIssuer(SECRET);
    const id = randomUUID();
    assert.equal(issuer.issue(id), issuer.issue(id));
    assert.equal(issuer.reissuable, true);
  });

  it("sobrevive ao processo: outro emissor com o mesmo segredo recomputa igual", () => {
    const id = randomUUID();
    assert.equal(createDerivedAccessTokenIssuer(SECRET).issue(id), createDerivedAccessTokenIssuer(SECRET).issue(id));
  });

  it("dá tokens diferentes para análises diferentes", () => {
    const issuer = createDerivedAccessTokenIssuer(SECRET);
    assert.notEqual(issuer.issue(randomUUID()), issuer.issue(randomUUID()));
  });

  it("muda inteiro quando o segredo muda", () => {
    // Trocar o segredo invalida os tokens em circulação, que é o efeito
    // esperado de uma rotação.
    const id = randomUUID();
    assert.notEqual(createDerivedAccessTokenIssuer(SECRET).issue(id), createDerivedAccessTokenIssuer(OTHER_SECRET).issue(id));
  });

  it("produz token opaco e utilizável em URL", () => {
    const token = createDerivedAccessTokenIssuer(SECRET).issue(randomUUID());
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(token.length >= 40, `token curto demais: ${token.length}`);
  });

  it("recusa segredo fraco em vez de aceitar em silêncio", () => {
    assert.throws(() => createDerivedAccessTokenIssuer("curto"), new RegExp(String(MIN_ACCESS_TOKEN_SECRET_BYTES)));
    assert.throws(() => createDerivedAccessTokenIssuer(""), /ACCESS_TOKEN_SECRET/);
  });

  it("sem segredo, volta a ser aleatório e se declara não reemitível", () => {
    // Comportamento anterior preservado: nada quebra para quem não configurar.
    const issuer = createRandomAccessTokenIssuer();
    const id = randomUUID();
    assert.notEqual(issuer.issue(id), issuer.issue(id));
    assert.equal(issuer.reissuable, false);
    assert.match(issuer.issue(id), /^[A-Za-z0-9_-]+$/);
  });
});
