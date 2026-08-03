import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Armazenamento dos artefatos de uma análise (relatórios, screenshots, vídeos).
 *
 * O scanner continua escrevendo em disco: ele precisa de sistema de arquivos de
 * verdade, e a CLI grava exatamente ali. O que este módulo faz é copiar o
 * resultado para um armazenamento que sobreviva ao contêiner — no Render o
 * disco é efêmero, então hoje todo relatório morre no próximo deploy e o link
 * que a pessoa guardou para de funcionar.
 *
 * Sem configuração entra a implementação inerte e o comportamento é o atual:
 * disco e nada mais.
 */
export interface ArtifactStorage {
  /** Copia o diretório inteiro sob o prefixo. Devolve quantos arquivos subiram. */
  upload(prefix: string, directory: string): Promise<number>;
  /** Lê um artefato. `undefined` quando não existe lá. */
  read(prefix: string, name: string): Promise<Buffer | undefined>;
  /** Apaga tudo do prefixo, quando a retenção expira. */
  remove(prefix: string): Promise<void>;
  /** Sondagem barata para o readiness. Nunca lança. */
  status(): Promise<"disabled" | "ok" | "unreachable">;
}

export const NO_ARTIFACT_STORAGE: ArtifactStorage = {
  upload: async () => 0,
  read: async () => undefined,
  remove: async () => {},
  status: async () => "disabled",
};

export interface ArtifactStorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Vazio usa a AWS. Preenchido aponta para R2, MinIO ou outro compatível. */
  endpoint: string | undefined;
}

/** Todo objeto sobe com este prefixo, para o bucket poder ser compartilhado. */
const KEY_ROOT = "scans";

function objectKey(prefix: string, name: string): string {
  return `${KEY_ROOT}/${prefix}/${name}`;
}

/** Lista os arquivos do diretório em caminho relativo com barras normais. */
async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(directory, join(entry.parentPath ?? directory, entry.name))
        .split(sep)
        .join("/"),
    );
}

/**
 * Implementação S3-compatível.
 *
 * O SDK entra por import tardio de propósito: ele é dependência opcional e não
 * pode ser exigido de quem usa só a CLI ou o dashboard local. Enquanto o
 * armazenamento não é configurado, o pacote nunca é carregado.
 */
export async function createS3ArtifactStorage(config: ArtifactStorageConfig): Promise<ArtifactStorage> {
  let module: typeof import("@aws-sdk/client-s3");
  try {
    module = await import("@aws-sdk/client-s3");
  } catch {
    throw new Error("Armazenamento de artefatos configurado, mas @aws-sdk/client-s3 não está instalado. Rode `npm install @aws-sdk/client-s3`.");
  }
  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, HeadBucketCommand } = module;
  const client = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });

  const contentTypeOf = (name: string): string => {
    if (name.endsWith(".html")) return "text/html; charset=utf-8";
    if (name.endsWith(".json")) return "application/json; charset=utf-8";
    if (name.endsWith(".xml")) return "application/xml; charset=utf-8";
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".webm")) return "video/webm";
    return "application/octet-stream";
  };

  return {
    async upload(prefix, directory) {
      const files = await filesUnder(directory);
      for (const name of files) {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: objectKey(prefix, name),
            Body: await readFile(join(directory, name)),
            ContentType: contentTypeOf(name),
          }),
        );
      }
      return files.length;
    },

    async read(prefix, name) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: objectKey(prefix, name) }));
        const bytes = await result.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : undefined;
      } catch (error) {
        // Objeto ausente é resposta normal aqui, não falha: quem chama decide.
        if ((error as { name?: string }).name === "NoSuchKey" || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined;
        throw error;
      }
    },

    async remove(prefix) {
      // A listagem é paginada: uma análise de sitemap com muitas páginas passa
      // fácil dos 1000 objetos que uma página devolve.
      let continuationToken: string | undefined;
      do {
        const listed = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: `${KEY_ROOT}/${prefix}/`, ContinuationToken: continuationToken }));
        const keys = (listed.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
        if (keys.length > 0) {
          await client.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: keys } }));
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    },

    async status() {
      // HeadBucket prova credencial e existência do bucket sem ler nada.
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
        return "ok";
      } catch {
        return "unreachable";
      }
    },
  };
}
