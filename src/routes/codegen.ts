import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { terminateProcessTree } from "../code-execution.js";
import { ACCESS_HASH_FILE, accessCookie, json, readJson, requireAccess, textField, tokenHash } from "../http-helpers.js";
import { MAX_JSON_BODY_BYTES } from "../code-limits.js";
import type { CodegenSession } from "../codegen-session-store.js";
import type { RouteHandler } from "./context.js";

export const tryHandleCodegen: RouteHandler = async (context, request, response, url) => {
  const { config, codegenSessions } = context;

  if (request.method === "POST" && url.pathname === "/api/codegen") {
    if (!context.requireCodeModeCreation(request, response, false)) return true;
    if (!context.consumeRateLimit(request, response)) return true;
    if (codegenSessions.hasActive()) {
      json(response, 429, { error: "Já existe uma gravação do Playwright Codegen em andamento." });
      return true;
    }
    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const target = textField(body, "url");
    if (!target) throw new Error("Informe a URL para iniciar o Codegen.");
    const parsed = new URL(target);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("A URL deve usar http ou https.");
    const id = randomUUID();
    const dir = join(config.resultsDir, `codegen-${id}`);
    await mkdir(dir, { recursive: true });
    const accessToken = randomBytes(32).toString("base64url");
    const accessTokenHash = tokenHash(accessToken);
    await writeFile(join(dir, ACCESS_HASH_FILE), `${accessTokenHash}\n`, { encoding: "utf8", mode: 0o600 });
    const outputPath = join(dir, "recorded.spec.ts");
    const child = config.codegenSpawner(process.execPath, [join(process.cwd(), "node_modules", "playwright", "cli.js"), "codegen", "--target=playwright-test", `--output=${outputPath}`, target], {
      stdio: "ignore",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const session: CodegenSession = { id, outputDir: dir, outputPath, process: child, active: true, accessTokenHash };
    codegenSessions.set(session);
    let finished = false;
    const deadline = setTimeout(() => {
      void terminateProcessTree(child);
    }, config.maxCodegenDurationMs);
    deadline.unref();
    const finish = (): void => {
      if (finished) return;
      finished = true;
      session.active = false;
      clearTimeout(deadline);
      context.expireCodegen(session);
    };
    child.once("error", finish);
    child.once("exit", finish);
    response.setHeader("set-cookie", accessCookie(request, `/api/codegen/${id}`, accessToken, config.retentionMs, config.trustProxy));
    json(response, 201, { id, accessToken });
    return true;
  }

  const codegenMatch = /^\/api\/codegen\/([0-9a-f-]+)$/.exec(url.pathname);
  if (request.method === "GET" && codegenMatch) {
    if (!context.requireCodeModeEnabled(response)) return true;
    const session = codegenSessions.get(codegenMatch[1] ?? "");
    if (!session) { json(response, 404, { error: "Sessão de Codegen não encontrada." }); return true; }
    if (!requireAccess(request, response, session.accessTokenHash)) return true;
    try { json(response, 200, { status: "completed", code: await readFile(session.outputPath, "utf8") }); }
    catch { json(response, 200, { status: "recording" }); }
    return true;
  }

  return false;
};
