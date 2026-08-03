import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { NO_ARTIFACT_STORAGE, createS3ArtifactStorage, type ArtifactStorage } from "../src/artifact-storage.js";
import type { ScanReport } from "../src/types.js";

/** Storage de teste: guarda os bytes num Map, com as mesmas regras de prefixo. */
class MemoryArtifactStorage implements ArtifactStorage {
  readonly objects = new Map<string, Buffer>();

  async upload(prefix: string, directory: string): Promise<number> {
    const { readdir, readFile } = await import("node:fs/promises");
    const { relative, sep } = await import("node:path");
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = join(entry.parentPath ?? directory, entry.name);
      const name = relative(directory, full).split(sep).join("/");
      this.objects.set(`${prefix}/${name}`, await readFile(full));
      count += 1;
    }
    return count;
  }

  async read(prefix: string, name: string): Promise<Buffer | undefined> {
    return this.objects.get(`${prefix}/${name}`);
  }

  async remove(prefix: string): Promise<void> {
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(`${prefix}/`)) this.objects.delete(key);
    }
  }
}

async function sampleDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "qa-radar-artifacts-"));
  await writeFile(join(directory, "report.json"), '{"passed":true}');
  await writeFile(join(directory, "screenshot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));
  await mkdir(join(directory, "pages", "sub"), { recursive: true });
  await writeFile(join(directory, "pages", "sub", "report.html"), "<h1>sub</h1>");
  return directory;
}

function contractFor(name: string, create: () => Promise<ArtifactStorage>, hooks: { setUp?: () => Promise<void>; tearDown?: () => Promise<void> } = {}) {
  describe(`artifact storage (${name})`, () => {
    if (hooks.setUp) before(hooks.setUp);
    if (hooks.tearDown) after(hooks.tearDown);

    it("envia o diretório inteiro, inclusive subpastas", async () => {
      const storage = await create();
      const directory = await sampleDirectory();
      try {
        assert.equal(await storage.upload("analise-1", directory), 3);
        assert.equal((await storage.read("analise-1", "report.json"))?.toString(), '{"passed":true}');
        // O relatório de sitemap referencia pages/<slug>/report.html: perder a
        // subpasta deixaria os links internos quebrados.
        assert.equal((await storage.read("analise-1", "pages/sub/report.html"))?.toString(), "<h1>sub</h1>");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("preserva bytes de binário sem passar por texto", async () => {
      const storage = await create();
      const directory = await sampleDirectory();
      try {
        await storage.upload("analise-2", directory);
        assert.deepEqual([...((await storage.read("analise-2", "screenshot.png")) ?? [])], [0x89, 0x50, 0x4e, 0x47, 0x0d]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("devolve undefined para artefato inexistente, em vez de lançar", async () => {
      const storage = await create();
      assert.equal(await storage.read("analise-3", "report.json"), undefined);
    });

    it("mantém uma análise invisível para a outra", async () => {
      const storage = await create();
      const directory = await sampleDirectory();
      try {
        await storage.upload("analise-4", directory);
        assert.equal(await storage.read("analise-5", "report.json"), undefined);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("apaga só o prefixo pedido", async () => {
      const storage = await create();
      const directory = await sampleDirectory();
      try {
        await storage.upload("analise-6", directory);
        await storage.upload("analise-7", directory);
        await storage.remove("analise-6");
        assert.equal(await storage.read("analise-6", "report.json"), undefined);
        assert.ok(await storage.read("analise-7", "report.json"));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });
}

contractFor("memória", async () => new MemoryArtifactStorage());

/**
 * Contra um S3 de verdade só quando houver um. Suba um MinIO com
 * `docker run -d -p 59000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio server /data`
 * e exporte QA_RADAR_TEST_STORAGE_ENDPOINT.
 */
const TEST_STORAGE_ENDPOINT = process.env.QA_RADAR_TEST_STORAGE_ENDPOINT;
if (TEST_STORAGE_ENDPOINT) {
  const config = {
    bucket: process.env.QA_RADAR_TEST_STORAGE_BUCKET ?? "qa-radar-test",
    region: "auto",
    accessKeyId: process.env.QA_RADAR_TEST_STORAGE_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.QA_RADAR_TEST_STORAGE_SECRET_ACCESS_KEY ?? "minioadmin",
    endpoint: TEST_STORAGE_ENDPOINT,
  };
  contractFor("s3", async () => createS3ArtifactStorage(config), {
    setUp: async () => {
      const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
      const admin = new S3Client({
        region: config.region,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        endpoint: config.endpoint,
        forcePathStyle: true,
      });
      await admin.send(new CreateBucketCommand({ Bucket: config.bucket })).catch(() => {
        /* Já existe de uma execução anterior. */
      });
    },
  });
}

describe("artefatos no servidor", () => {
  it("não faz nada sem armazenamento configurado", async () => {
    assert.equal(await NO_ARTIFACT_STORAGE.upload("x", "."), 0);
    assert.equal(await NO_ARTIFACT_STORAGE.read("x", "report.json"), undefined);
    await NO_ARTIFACT_STORAGE.remove("x");
  });

  it("serve o relatório pelo armazenamento quando o disco não tem mais", async () => {
    // É o caso que hoje quebra: o contêiner foi recriado, o disco foi junto, e
    // o link que a pessoa guardou parou de funcionar.
    const artifacts = new MemoryArtifactStorage();
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-serve-"));
    const report: ScanReport = {
      tool: "QA Radar",
      schemaVersion: "1.0",
      version: "3.1.0",
      startedAt: "2026-08-03T00:00:00.000Z",
      durationMs: 10,
      scanStatus: "completed",
      targetUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      title: "Exemplo",
      mainStatus: 200,
      browser: "chromium",
      passed: true,
      failOn: "error",
      gateScope: "all",
      summary: { warnings: 0, errors: 0, total: 0 },
      issues: [],
      screenshotPath: undefined,
    };
    const server = createQaRadarServer({
      resultsDir,
      allowPrivateTargets: true,
      artifacts,
      scanRunner: async () => report,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const created = (await (
        await fetch(`${baseUrl}/api/v1/scans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: baseUrl }),
        })
      ).json()) as { id: string; accessToken: string };
      const authorization = { authorization: `Bearer ${created.accessToken}` };

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const status = (await (await fetch(`${baseUrl}/api/v1/scans/${created.id}`, { headers: authorization })).json()) as { status: string };
        if (status.status !== "queued" && status.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // O envio acontece depois do desfecho, sem bloquear a análise.
      for (let attempt = 0; attempt < 60 && artifacts.objects.size === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(artifacts.objects.size > 0, "os artefatos deveriam ter subido depois da análise");

      // Some com o disco, como um contêiner recriado faria.
      await rm(resultsDir, { recursive: true, force: true });

      const served = await fetch(`${baseUrl}/api/v1/scans/${created.id}/report.json`, { headers: authorization });
      assert.equal(served.status, 200);
      assert.equal(((await served.json()) as { passed: boolean }).passed, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });
});
