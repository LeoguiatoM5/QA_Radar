import { chromium } from "playwright";
import { auditAccessibility } from "./dist/scanner-accessibility.js";
const BASE = "https://qa-radar.onrender.com";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const erros = [];
page.on("pageerror", (e) => erros.push("PAGEERROR: " + e.message));
page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
page.on("requestfailed", (r) => erros.push("REQFAIL: " + r.url()));
const ok = (n, c) => console.log((c ? "PASS " : "FALHA") + "  " + n);

console.log("=== JSON Schema Validator ===");
await page.goto(BASE + "/toolbox/json-schema", { waitUntil: "networkidle" });
await page.locator("#schema-input").fill(JSON.stringify({ type: "object", required: ["email", "total"], properties: { email: { type: "string", format: "email" }, total: { type: "number", minimum: 0 }, status: { type: "string", enum: ["ativo", "inativo"] } }, additionalProperties: false }));
await page.locator("#schema-payload").fill(JSON.stringify({ email: "sem-arroba", total: -5, status: "pendente", extra: true }));
await page.locator("#schema-run").click();
await page.locator("#schema-result-panel").waitFor();
const linhas = (await page.locator("#schema-violations").textContent()) || "";
ok("4 violacoes com campo e regra", ((await page.locator("#schema-summary").textContent()) || "").includes("4 VIOLAÇÃO") && linhas.includes("$.email") && linhas.includes("additionalProperties"));
await page.locator("#schema-payload").fill(JSON.stringify({ email: "ana@exemplo.com", total: 10, status: "ativo" }));
await page.locator("#schema-run").click();
ok("payload correto passa", ((await page.locator("#schema-summary").textContent()) || "").includes("VÁLIDO"));

console.log("=== OpenAPI Diff ===");
const contrato = (v, req, tipo) => ["openapi: 3.0.3","info:",`  version: '${v}'`,"paths:","  /pedidos:","    post:","      requestBody:","        content:","          application/json:","            schema:","              type: object","              required:",`                - ${req}`,"              properties:","                item:","                  type: string","                cupom:","                  type: string","      responses:","        '201':","          description: criado","          content:","            application/json:","              schema:","                type: object","                properties:","                  total:",`                    type: ${tipo}`].join("\n");
await page.goto(BASE + "/toolbox/openapi-diff", { waitUntil: "networkidle" });
await page.locator("#oas-left").fill(contrato("1.0.0", "item", "number"));
await page.locator("#oas-right").fill(contrato("2.0.0", "cupom", "string"));
await page.locator("#oas-run").click();
await page.locator("#oas-result-panel").waitFor();
const mudancas = (await page.locator("#oas-changes").textContent()) || "";
ok("le YAML e detecta as duas quebras", ((await page.locator("#oas-summary").textContent()) || "").includes("HÁ QUEBRA") && mudancas.includes("passou a ser obrigatório na requisição") && mudancas.includes("mudou de number para string"));
await page.locator("#oas-left").fill("a: &x 1\nb: *x");
await page.locator("#oas-run").click();
await page.locator("#oas-error").waitFor();
ok("recusa YAML nao suportado com mensagem", ((await page.locator("#oas-error").textContent()) || "").includes("ncoras"));

console.log("=== Acessibilidade / console / responsivo ===");
for (const p of ["/toolbox/json-schema", "/toolbox/openapi-diff", "/toolbox/webhook-inspector"]) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  const v = (await auditAccessibility(page, BASE + p)).filter((i) => i.severity === "error");
  const m = await page.evaluate(() => ({ ov: document.documentElement.scrollWidth - window.innerWidth, h1: document.querySelectorAll("h1").length }));
  ok(`${p}: axe limpo, 1 h1, sem overflow`, v.length === 0 && m.h1 === 1 && m.ov === 0);
}
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const p of ["/toolbox/json-schema", "/toolbox/openapi-diff", "/toolbox/webhook-inspector"]) {
  await mobile.goto(BASE + p, { waitUntil: "domcontentloaded" });
  const m = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${p}: cabe em 390px`, m === 0);
}
console.log("erros de console/rede: " + JSON.stringify(erros));
await browser.close(); process.exit(0);
