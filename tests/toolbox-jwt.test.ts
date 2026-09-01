import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeBase64Url, formatDuration, inspectJwt, JWT_STATUS_LABELS } from "../src/toolbox/jwt.js";

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function token(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }): string {
  return `${segment(header)}.${segment(payload)}.assinatura`;
}

const NOW = Date.parse("2026-09-01T12:00:00Z");

describe("toolbox · jwt inspector", () => {
  it("decodifica header e payload de um token estruturalmente válido", () => {
    const result = inspectJwt(token({ sub: "1234", name: "Ana" }), NOW);

    assert.equal(result.decoded, true);
    assert.equal(result.status, "valid_structure");
    assert.equal(JWT_STATUS_LABELS[result.status], "VALID STRUCTURE");
    assert.deepEqual(result.header, { alg: "HS256", typ: "JWT" });
    assert.deepEqual(result.payload, { sub: "1234", name: "Ana" });
    assert.equal(result.algorithm, "HS256");
  });

  it("nunca afirma que a assinatura foi verificada", () => {
    // O ponto central da ferramenta: decodificar não é verificar. Um token
    // forjado é decodificado igual, e dizer "válido" aqui ensinaria o time a
    // confiar nele.
    const result = inspectJwt(token({ sub: "1" }), NOW);

    assert.equal(result.signatureVerified, false);
    assert.equal(result.signaturePresent, true);
    assert.notEqual(JWT_STATUS_LABELS[result.status], "VALID");
  });

  it("interpreta iat, exp e nbf como segundos desde a epoch", () => {
    const issued = Math.floor(NOW / 1000) - 60;
    const expires = Math.floor(NOW / 1000) + 3600;
    const result = inspectJwt(token({ iat: issued, exp: expires, nbf: issued }), NOW);

    assert.equal(result.timestamps.issuedAt, issued * 1000);
    assert.equal(result.timestamps.expiresAt, expires * 1000);
    assert.equal(result.timestamps.notBefore, issued * 1000);
    assert.equal(result.timeRemainingMs, 3600 * 1000);
  });

  it("reconhece token expirado", () => {
    const result = inspectJwt(token({ exp: Math.floor(NOW / 1000) - 10 }), NOW);

    assert.equal(result.status, "expired");
    assert.equal(JWT_STATUS_LABELS[result.status], "EXPIRED");
    assert.ok((result.timeRemainingMs ?? 0) < 0);
  });

  it("reconhece token que ainda não entrou em vigor", () => {
    const result = inspectJwt(token({ nbf: Math.floor(NOW / 1000) + 600, exp: Math.floor(NOW / 1000) + 3600 }), NOW);

    assert.equal(result.status, "not_active_yet");
  });

  it("prefere dizer expirado quando o token já venceu e ainda tem nbf futuro", () => {
    const result = inspectJwt(token({ nbf: Math.floor(NOW / 1000) + 600, exp: Math.floor(NOW / 1000) - 1 }), NOW);

    assert.equal(result.status, "expired");
  });

  it("recusa token com número de partes errado", () => {
    const invalid = inspectJwt("abc.def", NOW);

    assert.equal(invalid.decoded, false);
    assert.equal(invalid.status, "invalid");
    assert.match(invalid.error ?? "", /três partes/);
  });

  it("recusa payload que não é JSON", () => {
    const result = inspectJwt(`${segment({ alg: "HS256" })}.${Buffer.from("nao json", "utf8").toString("base64url")}.sig`, NOW);

    assert.equal(result.decoded, false);
    assert.match(result.error ?? "", /payload não contém um JSON válido/);
  });

  it("recusa segmento fora do alfabeto base64url", () => {
    const result = inspectJwt("cabeç@lho.payload.sig", NOW);

    assert.equal(result.decoded, false);
    assert.match(result.error ?? "", /base64url/);
  });

  it("aceita o token colado junto com o prefixo Bearer", () => {
    const result = inspectJwt(`Bearer ${token({ sub: "1" })}`, NOW);

    assert.equal(result.decoded, true);
  });

  it("pede o token quando o campo está vazio", () => {
    assert.match(inspectJwt("   ", NOW).error ?? "", /Cole um JWT/);
  });

  it("decodifica base64url com acento e sem padding", () => {
    assert.equal(decodeBase64Url(Buffer.from("ação", "utf8").toString("base64url")), "ação");
  });

  it("escreve a duração em unidades legíveis", () => {
    assert.equal(formatDuration(3600 * 1000), "1 h");
    assert.equal(formatDuration(90 * 60 * 1000), "1 h 30 min");
    assert.equal(formatDuration(-45 * 1000), "45 s");
    assert.equal(formatDuration(3 * 86_400_000), "3 d");
  });
});
