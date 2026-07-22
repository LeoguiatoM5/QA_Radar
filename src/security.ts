import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function blockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function blockedIp(address: string): boolean {
  if (isIP(address) === 4) return blockedIpv4(address);
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) return blockedIpv4(normalized.slice(7));
  return normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith("2001:db8");
}

export type PublicUrlResolver = (hostname: string) => Promise<Array<{ address: string }>>;

const systemResolver: PublicUrlResolver = async (hostname) =>
  isIP(hostname) ? [{ address: hostname }] : lookup(hostname, { all: true, verbatim: true });

async function publicResolution(rawUrl: string, resolver: PublicUrlResolver): Promise<{ hostname: string; fingerprint: string }> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("O destino deve utilizar HTTP ou HTTPS.");
  }
  if (url.username || url.password) throw new Error("URLs com credenciais não são permitidas.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Endereços locais ou privados não são permitidos.");
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new Error("Não foi possível resolver o endereço informado.");
  }
  if (!addresses.length || addresses.some(({ address }) => blockedIp(address))) {
    throw new Error("Endereços locais ou privados não são permitidos.");
  }
  return {
    hostname,
    fingerprint: [...new Set(addresses.map(({ address }) => address.toLowerCase()))].sort().join(","),
  };
}

export class PublicNetworkGuard {
  readonly #resolutions = new Map<string, string>();

  constructor(private readonly resolver: PublicUrlResolver = systemResolver) {}

  async assert(rawUrl: string): Promise<void> {
    const resolution = await publicResolution(rawUrl, this.resolver);
    const previous = this.#resolutions.get(resolution.hostname);
    if (previous !== undefined && previous !== resolution.fingerprint) {
      throw new Error("O endereço do destino mudou durante a análise; possível DNS rebinding bloqueado.");
    }
    this.#resolutions.set(resolution.hostname, resolution.fingerprint);
  }
}

export async function assertPublicUrl(rawUrl: string): Promise<void> {
  await publicResolution(rawUrl, systemResolver);
}
