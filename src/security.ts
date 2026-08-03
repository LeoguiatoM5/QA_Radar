import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { ApiError } from "./api-error.js";

const BLOCKED_ADDRESSES = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(address, prefix, "ipv6");
}

export function isBlockedNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  const family = isIP(normalized);
  if (family === 4) return BLOCKED_ADDRESSES.check(normalized, "ipv4");
  if (family === 6) {
    if (normalized.startsWith("::ffff:")) return true;
    return BLOCKED_ADDRESSES.check(normalized, "ipv6");
  }
  return true;
}

export interface ResolvedAddress {
  address: string;
  family?: number;
}

export interface PublicResolution {
  hostname: string;
  addresses: ResolvedAddress[];
  fingerprint: string;
}

export type PublicUrlResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: PublicUrlResolver = async (hostname) => (isIP(hostname) ? [{ address: hostname }] : lookup(hostname, { all: true, verbatim: true }));

async function publicResolution(rawUrl: string, resolver: PublicUrlResolver): Promise<PublicResolution> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Sem este catch a URL malformada sobe como TypeError e o servidor a
    // classifica como falha interna (500) em vez de entrada inválida.
    throw new ApiError("invalid_target", "A URL informada é inválida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError("invalid_target", "O destino deve utilizar HTTP ou HTTPS.");
  }
  if (url.username || url.password) throw new ApiError("invalid_target", "URLs com credenciais não são permitidas.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new ApiError("invalid_target", "Endereços locais ou privados não são permitidos.");
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new ApiError("invalid_target", "Não foi possível resolver o endereço informado.");
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedNetworkAddress(address))) {
    throw new ApiError("invalid_target", "Endereços locais ou privados não são permitidos.");
  }
  return {
    hostname,
    addresses,
    fingerprint: [...new Set(addresses.map(({ address }) => address.toLowerCase()))].sort().join(","),
  };
}

export class PublicNetworkGuard {
  readonly #resolutions = new Map<string, string>();

  constructor(private readonly resolver: PublicUrlResolver = systemResolver) {}

  async resolve(rawUrl: string): Promise<PublicResolution> {
    const resolution = await publicResolution(rawUrl, this.resolver);
    const previous = this.#resolutions.get(resolution.hostname);
    if (previous !== undefined && previous !== resolution.fingerprint) {
      throw new ApiError("invalid_target", "O endereço do destino mudou durante a análise; possível DNS rebinding bloqueado.");
    }
    this.#resolutions.set(resolution.hostname, resolution.fingerprint);
    return resolution;
  }

  async assert(rawUrl: string): Promise<void> {
    await this.resolve(rawUrl);
  }
}

export async function assertPublicUrl(rawUrl: string): Promise<void> {
  await publicResolution(rawUrl, systemResolver);
}
