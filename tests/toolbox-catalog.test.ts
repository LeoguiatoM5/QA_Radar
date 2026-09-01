import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AVAILABLE_TOOLS, categoryLabel, findTool, normalizeSearchTerm, QA_TOOLS, searchTools, TOOL_CATEGORIES } from "../src/toolbox/catalog.js";
import { createToolPage, createToolboxHomePage } from "../src/web-page.js";
import { escapeHtml } from "../src/web-toolbox.js";
import { TOOLBOX_SCRIPTS } from "../src/toolbox-client.js";

describe("toolbox · catálogo", () => {
  it("mantém id, rota e categoria coerentes em toda ferramenta", () => {
    const ids = new Set<string>();
    const categories = new Set(TOOL_CATEGORIES.map((category) => category.id));

    for (const tool of QA_TOOLS) {
      assert.match(tool.id, /^[a-z0-9-]+$/, `id inválido: ${tool.id}`);
      assert.equal(ids.has(tool.id), false, `id repetido: ${tool.id}`);
      ids.add(tool.id);
      assert.equal(tool.route, `/toolbox/${tool.id}`, `rota fora do padrão: ${tool.route}`);
      assert.equal(categories.has(tool.category), true, `categoria desconhecida: ${tool.category}`);
      assert.ok(tool.tags.length > 0, `${tool.id} sem tags`);
      assert.ok(tool.description.length > 20, `${tool.id} sem descrição útil`);
    }
  });

  it("toda categoria preparada tem ao menos uma ferramenta", () => {
    for (const category of TOOL_CATEGORIES) {
      assert.ok(
        QA_TOOLS.some((tool) => tool.category === category.id),
        `categoria vazia: ${category.id}`,
      );
    }
  });

  it("só marca 'roda local' a ferramenta que de fato não usa o servidor", () => {
    // O selo é uma promessa de privacidade. O health check é a única que sai
    // para a rede pelo servidor, e por isso é a única sem o selo.
    const usamServidor = new Set(["api-health", "webhook-inspector"]);
    for (const id of usamServidor) assert.equal(findTool(id)?.runsLocally, false, `${id} usa o servidor e não pode exibir o selo`);
    for (const tool of AVAILABLE_TOOLS) {
      if (usamServidor.has(tool.id)) continue;
      assert.equal(tool.runsLocally, true, `${tool.id} deveria rodar no navegador`);
    }
  });

  it("entrega uma página para cada ferramenta disponível e nenhuma para as anunciadas", () => {
    for (const tool of QA_TOOLS) {
      const page = createToolPage(tool);
      if (tool.status === "soon") {
        assert.equal(page, undefined, `${tool.id} está anunciada como em breve mas tem página`);
        assert.equal(TOOLBOX_SCRIPTS[tool.id], undefined);
      } else {
        assert.ok(page, `${tool.id} não tem página`);
        assert.ok(TOOLBOX_SCRIPTS[tool.id], `${tool.id} não tem script`);
      }
    }
    assert.equal(AVAILABLE_TOOLS.length, QA_TOOLS.length, "no 1.2 todas as ferramentas anunciadas ganharam página");
    assert.equal(AVAILABLE_TOOLS.length, 13, "seis do MVP, quatro do 1.1 e três do 1.2");
  });
});

describe("toolbox · busca", () => {
  it("encontra pelo nome, ignorando caixa e acento", () => {
    assert.deepEqual(
      searchTools("json-diff").map((tool) => tool.id),
      ["json-diff"],
    );
    assert.deepEqual(
      searchTools("JSON-DIFF").map((tool) => tool.id),
      ["json-diff"],
    );
    assert.ok(searchTools("boundary").some((tool) => tool.id === "boundary-values"));
  });

  it("encontra pela categoria", () => {
    const ids = searchTools("test data").map((tool) => tool.id);

    assert.ok(ids.includes("test-data"));
  });

  it("encontra pela tag e pela descrição", () => {
    assert.ok(searchTools("bearer").some((tool) => tool.id === "jwt-inspector"));
    assert.ok(searchTools("massa").some((tool) => tool.id === "test-data"));
    assert.ok(searchTools("swagger").some((tool) => tool.id === "openapi-diff"));
    assert.ok(searchTools("all pairs").some((tool) => tool.id === "pairwise"));
    assert.ok(searchTools("epoch").some((tool) => tool.id === "timestamp"));
    assert.ok(searchTools("expressao regular").some((tool) => tool.id === "regex-tester"));
    assert.ok(searchTools("breaking change").some((tool) => tool.id === "openapi-diff"));
    assert.ok(searchTools("callback").some((tool) => tool.id === "webhook-inspector"));
  });

  it("mostra a estrela de favoritar só no que tem página", () => {
    const html = createToolboxHomePage();

    for (const tool of QA_TOOLS) {
      const temEstrela = html.includes(`data-tool-favorite="${tool.id}"`);
      assert.equal(temEstrela, tool.status !== "soon", `${tool.id}: estrela e disponibilidade não batem`);
    }
    assert.match(html, /id="toolbox-favorites"[^>]*hidden/, "a faixa de favoritas nasce escondida");
  });

  it("busca por API traz as ferramentas de API", () => {
    const ids = searchTools("api").map((tool) => tool.id);

    for (const expected of ["api-health", "json-diff", "jwt-inspector", "curl-converter"]) {
      assert.ok(ids.includes(expected), `busca por API não trouxe ${expected}`);
    }
  });

  it("exige que todos os termos casem, para refinar em vez de alargar", () => {
    assert.equal(searchTools("json boundary").length, 0);
  });

  it("devolve o catálogo inteiro quando não há busca", () => {
    assert.equal(searchTools("").length, QA_TOOLS.length);
    assert.equal(searchTools("   ").length, QA_TOOLS.length);
  });

  it("normaliza acento e caixa", () => {
    assert.equal(normalizeSearchTerm("  Acessibilidade ÁÉÍ "), "acessibilidade aei");
  });

  it("rotula a categoria pelo nome exibido", () => {
    assert.equal(categoryLabel("api-json"), "API & JSON");
  });
});

describe("toolbox · páginas", () => {
  it("monta a página inicial com busca, categorias e todos os cards", () => {
    const html = createToolboxHomePage();

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /id="toolbox-search-input"/);
    assert.match(html, /Daily tools for Software Quality/);
    for (const tool of QA_TOOLS) assert.ok(html.includes(`data-tool-id="${tool.id}"`), `card ausente: ${tool.id}`);
    for (const category of TOOL_CATEGORIES) assert.ok(html.includes(escapeHtml(category.label)), `categoria ausente: ${category.label}`);
  });

  it("liga a navegação lateral ao Toolbox em toda página", () => {
    assert.match(createToolboxHomePage(), /href="\/toolbox"[^>]*aria-current="page"/);
    assert.match(createToolboxHomePage(), /QA Toolbox/);
  });

  it("carrega o shell comum e o módulo da ferramenta em cada página", () => {
    for (const tool of AVAILABLE_TOOLS) {
      const html = createToolPage(tool) as string;
      assert.match(html, /refreshAccount/, `${tool.id} não carrega o controle de conta`);
      assert.match(html, /<script type="module">/, `${tool.id} não carrega o módulo da ferramenta`);
      assert.match(html, /\/assets\/toolbox\//, `${tool.id} não importa a regra de negócio servida`);
      assert.equal((html.match(/<h1>/g) ?? []).length, 1, `${tool.id} deve ter um único h1`);
      assert.match(html, /class="tool-breadcrumb"/, `${tool.id} sem trilha de volta ao Toolbox`);
    }
  });

  it("mostra o selo de privacidade coerente com o catálogo", () => {
    assert.match(createToolPage(findTool("json-diff")!) as string, /tool-privacy-local/);
    assert.match(createToolPage(findTool("api-health")!) as string, /tool-privacy-server/);
    // A ferramenta que usa o servidor precisa dizer isso na cara do usuário.
    assert.match(createToolPage(findTool("api-health")!) as string, /usa o servidor/i);
  });

  it("avisa que o JWT não tem a assinatura verificada", () => {
    const html = createToolPage(findTool("jwt-inspector")!) as string;

    assert.match(html, /Assinatura não verificada/);
    assert.match(html, /não<\/strong> confere a assinatura/);
  });

  it("avisa que a massa de teste é sintética", () => {
    assert.match(createToolPage(findTool("test-data")!) as string, /Synthetic Test Data — Do not use as real identity data/);
  });

  it("escapa o conteúdo do catálogo ao montar o HTML", () => {
    // Nenhuma ferramenta tem `<` hoje; o teste protege contra alguém adicionar
    // uma amanhã e a descrição virar marcação.
    const html = createToolboxHomePage();
    const cards = html.split("data-tool-id=").length - 1;

    assert.equal(cards, QA_TOOLS.length);
    assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
