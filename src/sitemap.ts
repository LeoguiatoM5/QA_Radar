import { assertPublicUrl } from "./security.js";
import type { ScanControl, ScanOptions } from "./types.js";

const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
const MAX_SITEMAP_FILES = 10;

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

export function parseSitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => decodeXml(match[1]?.trim() ?? ""))
    .filter(Boolean);
}

async function responseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SITEMAP_BYTES) {
      await reader.cancel();
      throw new Error("Sitemap excede o limite de 5 MB.");
    }
    chunks.push(value);
  }
  const content = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(content);
}

async function fetchSitemap(
  rawUrl: string,
  publicNetworkOnly: boolean,
  signal?: AbortSignal,
): Promise<{ url: string; xml: string }> {
  let current = rawUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (publicNetworkOnly) await assertPublicUrl(current);
    const timeout = AbortSignal.timeout(15_000);
    const response = await fetch(current, {
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { "user-agent": "QA-Radar-Sitemap/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Sitemap redirecionou sem destino (${response.status}).`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Sitemap respondeu com HTTP ${response.status}: ${current}`);
    return { url: current, xml: await responseText(response) };
  }
  throw new Error("Sitemap excedeu o limite de redirecionamentos.");
}

function normalizedPage(rawUrl: string, origin: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) return undefined;
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function discoverSitemapUrls(
  options: ScanOptions,
  control: ScanControl = {},
): Promise<string[]> {
  const root = new URL(options.url);
  const initialSitemap = new URL("/sitemap.xml", root).toString();
  const pending = [initialSitemap];
  const visitedSitemaps = new Set<string>();
  const pages = new Set<string>();
  const maxPages = options.maxPages ?? 20;

  while (pending.length > 0 && visitedSitemaps.size < MAX_SITEMAP_FILES && pages.size < maxPages) {
    control.signal?.throwIfAborted();
    const candidate = pending.shift();
    if (!candidate || visitedSitemaps.has(candidate)) continue;
    visitedSitemaps.add(candidate);
    const fetched = await fetchSitemap(
      candidate,
      options.publicNetworkOnly === true,
      control.signal,
    );
    const locations = parseSitemapLocations(fetched.xml);
    const sitemapIndex = /<sitemapindex\b/i.test(fetched.xml);
    for (const location of locations) {
      const normalized = normalizedPage(location, root.origin);
      if (!normalized) continue;
      if (sitemapIndex) {
        if (!visitedSitemaps.has(normalized) && pending.length < MAX_SITEMAP_FILES) pending.push(normalized);
      } else {
        pages.add(normalized);
        if (pages.size >= maxPages) break;
      }
    }
  }

  if (pages.size === 0) throw new Error(`Nenhuma URL válida do mesmo domínio foi encontrada em ${initialSitemap}.`);
  return [...pages];
}
