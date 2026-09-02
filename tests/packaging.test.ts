import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * O build compila mais de um projeto TypeScript, e cada imagem monta o próprio
 * contexto copiando arquivo por arquivo. Quando `tsconfig.browser.json` entrou
 * no `npm run build`, os três Dockerfiles continuaram copiando só o
 * `tsconfig.json` — o build morreu dentro da imagem com `TS5058`, e como aqui
 * não há daemon do Docker isso só apareceu no CI, um ciclo inteiro depois.
 *
 * O teste é de texto puro justamente para rodar onde o Docker não existe.
 */
describe("empacotamento", () => {
  const dockerfiles = ["Dockerfile", "Dockerfile.sandbox-job", "Dockerfile.sandbox-runner"];

  it("copia para as imagens todo tsconfig que o build compila", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
    const projects = [...packageJson.scripts.build!.matchAll(/tsc -p (\S+)/g)].map((match) => match[1]!);
    assert.ok(projects.length >= 2, "o build deveria compilar o projeto do servidor e o do navegador");

    const ignored = (await readFile(".dockerignore", "utf8")).split(/\r?\n/).map((line) => line.trim());

    for (const dockerfile of dockerfiles) {
      const content = await readFile(dockerfile, "utf8");
      for (const project of projects) {
        assert.ok(content.includes(project), `${dockerfile} não copia ${project}, e o build dentro da imagem falha sem ele`);
        assert.ok(!ignored.includes(project), `.dockerignore exclui ${project}, então o COPY de ${dockerfile} não o encontraria`);
      }
    }
  });

  it("leva o dist inteiro para o estágio final, com os módulos de navegador", async () => {
    // Os módulos de `/assets/js/` são servidos de `dist/browser/`. Um COPY
    // seletivo demais os deixaria de fora e a interface carregaria sem cliente.
    for (const dockerfile of dockerfiles) {
      const content = await readFile(dockerfile, "utf8");
      assert.match(content, /COPY --from=build [^\n]*\/app\/dist \.\/dist/, `${dockerfile} precisa copiar dist inteiro`);
    }
  });
});
