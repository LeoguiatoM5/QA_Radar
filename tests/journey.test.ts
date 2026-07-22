import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJourney } from "../src/journey.js";

describe("journey contract", () => {
  it("aceita somente ações declarativas e secrets por ambiente", () => {
    const journey = parseJourney({ schemaVersion: "1.0", name: "Login", steps: [
      { action: "goto", url: "https://example.com/login" },
      { action: "fill", selector: "#email", value: "qa@example.com" },
      { action: "fill", selector: "#password", valueFromEnv: "QA_RADAR_SECRET_PASSWORD" },
      { action: "click", selector: "button[type=submit]" },
      { action: "assertVisible", selector: "[data-testid=dashboard]" },
    ] });
    assert.equal(journey.steps.length, 5);
    assert.equal(journey.steps[2]?.action, "fill");
  });

  it("bloqueia scripts, campos desconhecidos e contratos incompatíveis", () => {
    assert.throws(() => parseJourney({ schemaVersion: "2.0", name: "x", steps: [{}] }), /schemaVersion/);
    assert.throws(() => parseJourney({ schemaVersion: "1.0", name: "x", steps: [{ action: "evaluate", code: "alert(1)" }] }), /não permitida/);
    assert.throws(() => parseJourney({ schemaVersion: "1.0", name: "x", steps: [{ action: "click", selector: "#ok", force: true }] }), /campo desconhecido/);
  });

  it("exige confirmação explícita para seletores potencialmente destrutivos", () => {
    const base = { schemaVersion: "1.0", name: "Exclusão" };
    assert.throws(() => parseJourney({ ...base, steps: [{ action: "click", selector: "#delete-account" }] }), /allowDestructive/);
    assert.doesNotThrow(() => parseJourney({ ...base, steps: [{ action: "click", selector: "#delete-account", allowDestructive: true }] }));
  });

  it("não aceita secret literal ambíguo nem variável fora do namespace", () => {
    const base = { schemaVersion: "1.0", name: "Login" };
    assert.throws(() => parseJourney({ ...base, steps: [{ action: "fill", selector: "#x", value: "a", valueFromEnv: "TOKEN" }] }), /somente value ou valueFromEnv/);
    assert.throws(() => parseJourney({ ...base, steps: [{ action: "fill", selector: "#x", valueFromEnv: "PASSWORD" }] }), /QA_RADAR_SECRET/);
  });
});
