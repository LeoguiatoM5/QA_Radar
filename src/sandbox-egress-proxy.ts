import { chmod, rm } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import { PublicNetworkGuard, type PublicResolution } from "./security.js";

const socketPath = process.argv[2];
if (!socketPath) throw new Error("Informe o caminho do socket de egress.");

const maxConnections = positiveInteger(process.env.QA_RADAR_EGRESS_MAX_CONNECTIONS, 32);
const maxBytes = positiveInteger(process.env.QA_RADAR_EGRESS_MAX_BYTES, 64 * 1024 * 1024);
const allowedPorts = new Set(
  (process.env.QA_RADAR_EGRESS_ALLOWED_PORTS ?? "80,443")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 65_535),
);
const guard = new PublicNetworkGuard();
let transferredBytes = 0;
let connectionCount = 0;
let requestCount = 0;

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error("Limite de egress inválido.");
  return value;
}

interface Destroyable {
  destroy(error?: Error): unknown;
}

function count(chunk: Buffer | string, sockets: readonly Destroyable[]): void {
  transferredBytes += Buffer.byteLength(chunk);
  if (transferredBytes <= maxBytes) return;
  for (const socket of sockets) socket.destroy(new Error("Limite de transferência excedido."));
}

function sanitizedHeaders(headers: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
  const blocked = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  const result: IncomingHttpHeaders = { host, connection: "close" };
  for (const [name, value] of Object.entries(headers)) {
    if (!blocked.has(name.toLowerCase()) && name.toLowerCase() !== "host") result[name] = value;
  }
  return result;
}

function sanitizedResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result = sanitizedHeaders(headers, "");
  delete result.host;
  return result;
}

function selectedAddress(resolution: PublicResolution): { address: string; family: number } {
  const ordered = [...resolution.addresses].sort((left, right) =>
    (isIP(left.address) === 4 ? 0 : 1) - (isIP(right.address) === 4 ? 0 : 1));
  const candidate = ordered[0];
  if (!candidate) throw new Error("Destino público sem endereço.");
  return {
    address: candidate.address,
    family: candidate.family ?? isIP(candidate.address),
  };
}

function checkedPort(value: string, fallback: number): number {
  const port = value ? Number(value) : fallback;
  if (!Number.isInteger(port) || !allowedPorts.has(port)) {
    throw new Error("Porta de destino não permitida.");
  }
  return port;
}

async function resolveTarget(url: URL): Promise<{ address: string; family: number; port: number }> {
  const fallbackPort = url.protocol === "https:" ? 443 : 80;
  const port = checkedPort(url.port, fallbackPort);
  const resolution = await guard.resolve(url.href);
  return { ...selectedAddress(resolution), port };
}

function openSocket(
  address: string,
  family: number,
  port: number,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, family, port });
    const onError = (error: Error): void => {
      clearTimeout(deadline);
      reject(error);
    };
    const deadline = setTimeout(() => {
      socket.destroy(new Error("Timeout ao conectar ao destino."));
    }, 10_000);
    socket.once("connect", () => {
      clearTimeout(deadline);
      socket.removeListener("error", onError);
      socket.setTimeout(30_000, () => socket.destroy());
      resolve(socket);
    });
    socket.once("error", onError);
  });
}

const server = createServer(async (request, response) => {
  requestCount += 1;
  if (requestCount > 2_000) {
    response.writeHead(429, { connection: "close" });
    response.end();
    return;
  }
  try {
    const target = new URL(request.url ?? "");
    if (target.protocol !== "http:" || target.username || target.password) {
      throw new Error("Destino HTTP inválido.");
    }
    const resolved = await resolveTarget(target);
    const upstream = httpRequest({
      host: resolved.address,
      family: resolved.family,
      port: resolved.port,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers: sanitizedHeaders(request.headers, target.host),
      agent: false,
    }, (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        sanitizedResponseHeaders(upstreamResponse.headers),
      );
      upstreamResponse.on("data", (chunk: Buffer) => count(chunk, [upstreamResponse.socket]));
      upstreamResponse.once("error", () => response.destroy());
      response.once("error", () => upstreamResponse.destroy());
      upstreamResponse.pipe(response);
    });
    upstream.once("error", () => {
      if (!response.headersSent) response.writeHead(502, { connection: "close" });
      response.end();
    });
    request.on("data", (chunk: Buffer) => count(chunk, [request.socket, upstream.socket].filter(
      (value): value is Socket => value !== null,
    )));
    request.pipe(upstream);
  } catch {
    response.writeHead(403, { connection: "close" });
    response.end();
  }
});

server.on("connect", async (request, clientSocket, head) => {
  requestCount += 1;
  let upstream: Socket | undefined;
  try {
    if (requestCount > 2_000 || !request.url || request.url.includes("/")) {
      throw new Error("CONNECT inválido.");
    }
    const target = new URL(`https://${request.url}`);
    const resolved = await resolveTarget(target);
    upstream = await openSocket(resolved.address, resolved.family, resolved.port);
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.byteLength > 0) upstream.write(head);
    clientSocket.on("data", (chunk: Buffer) => count(chunk, [clientSocket, upstream as Socket]));
    upstream.on("data", (chunk: Buffer) => count(chunk, [clientSocket, upstream as Socket]));
    clientSocket.once("error", () => upstream?.destroy());
    upstream.once("error", () => clientSocket.destroy());
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  } catch {
    clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    upstream?.destroy();
  }
});

server.on("connection", (socket) => {
  connectionCount += 1;
  socket.once("close", () => {
    connectionCount -= 1;
  });
  if (connectionCount > maxConnections) {
    socket.destroy();
    return;
  }
});
server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));

await rm(socketPath, { force: true });
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660);
  process.stdout.write("READY\n");
});

const shutdown = (): void => {
  server.close(() => {
    void rm(socketPath, { force: true }).finally(() => process.exit(0));
  });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
