import type { IncomingMessage } from "node:http";
export function localRequest(req: IncomingMessage, port: number, mutation = false): boolean {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!hosts.has(req.headers.host ?? "")) return false;
  if (req.headers.origin && ![`http://${req.headers.host}`].includes(req.headers.origin)) return false;
  if (mutation && !req.headers["content-type"]?.startsWith("application/json")) return false;
  return true;
}
