import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consoleErrorIssue } from "../src/scanner-events.js";

describe("diagnóstico de console", () => {
  it("explica CORS de telemetria sem alegar quebra funcional", () => {
    const issue = consoleErrorIssue("Access to fetch at 'https://play.google.com/log?format=json' from origin 'https://www.cantinhodasqas.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: The 'Access-Control-Allow-Origin' header has a value 'http://play.google.com' that is not equal to the supplied origin.");
    assert.equal(issue.ruleId, "console.cors.telemetry-blocked");
    assert.equal(issue.severity, "warning");
    assert.match(issue.impact ?? "", /telemetria/);
    assert.match(issue.recommendation ?? "", /não pode ser corrigido pelo JavaScript/);
    assert.equal(issue.url, "https://play.google.com/log?format=json");
    assert.match(issue.message, /Origem solicitante: https:\/\/www\.cantinhodasqas\.com\.br/);
    assert.equal(issue.referenceUrl, "https://developer.mozilla.org/docs/Web/HTTP/Guides/CORS");
  });
});
