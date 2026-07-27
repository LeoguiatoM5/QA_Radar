import { createServer, createConnection, type Server, type Socket } from "node:net";

export interface SandboxEgressRelay {
  server: Server;
  sockets: Set<Socket>;
}

export async function startSandboxEgressRelay(
  socketPath = "/run/egress/proxy.sock",
  port = 3128,
): Promise<SandboxEgressRelay> {
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = createConnection(socketPath);
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream);
    upstream.pipe(client);
    const closeBoth = (): void => {
      client.destroy();
      upstream.destroy();
    };
    client.once("close", () => sockets.delete(client));
    upstream.once("close", () => sockets.delete(upstream));
    client.once("error", closeBoth);
    upstream.once("error", closeBoth);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return { server, sockets };
}

export async function closeSandboxEgressRelay(relay: SandboxEgressRelay): Promise<void> {
  for (const socket of relay.sockets) socket.destroy();
  await new Promise<void>((resolve) => relay.server.close(() => resolve()));
}
