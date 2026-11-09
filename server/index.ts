import next from "next";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { Store } from "./store.ts";
import { CodexClient } from "./codex.ts";
import { Headquarters } from "./hq.ts";
import { localRequest } from "./security.ts";

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT deve estar entre 1024 e 65535.");
  const dir = resolve(process.env.AGENT_HQ_DATA_DIR ?? resolve(process.cwd(), "data"));
  mkdirSync(dir, { recursive: true });
  const workspace = resolve(process.env.AGENT_HQ_WORKSPACE ?? join(dir, "workspace"));
  mkdirSync(workspace, { recursive: true });
  const store = new Store(join(dir, "agent-hq.sqlite"));
  await store.migrateTeam(join(dir, "agent-hq.pre-v2.sqlite"));
  const hq = new Headquarters(store, new CodexClient(), workspace);
  const app = next({ dev: !process.argv.includes("--production"), hostname: "127.0.0.1", port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer(async (req, res) => {
    if (!localRequest(req, port, req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(403).end("Acesso permitido somente pela origem local do AgenFlux."); return;
    }
    const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname;
    if (!pathname.startsWith("/api/hq")) { await handle(req, res); return; }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      if (pathname === "/api/hq/state" && req.method === "GET") { res.end(JSON.stringify(hq.snapshot())); return; }
      if (pathname !== "/api/hq/action" || req.method !== "POST") { res.writeHead(404).end(JSON.stringify({ error: "Rota inexistente." })); return; }
      let body = "";
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 40000) throw new Error("Solicitação muito grande."); }
      const data = JSON.parse(body);
      switch (data.action) {
        case "connect": await hq.connect(); break;
        case "agent.create": hq.addAgent(data); break;
        case "agent.import": hq.importAgent(data.profileId, data.office === true); break;
        case "office.set": hq.applyOfficeSelection(data.agentIds); break;
        case "team.save": hq.saveTeam(data); break;
        case "team.use": hq.useTeam(data.id); break;
        case "task.create": hq.createTask({ agentId: data.agentId, title: data.title, prompt: data.prompt, mode: data.mode, cwd: data.cwd, libraryProfileId: data.libraryProfileId, skillIds: data.skillIds }); break;
        case "ai.save": hq.saveConfiguration(data); break;
        case "mission.create": {
          const mission = hq.missions.create(data);
          if (mission.team) hq.setOffice(mission.team.agentIds, mission.team.id);
          break;
        }
        case "mission.resume": hq.resumeStructuredReport(String(data.id)); break;
        case "mission.cancel":
          hq.missions.cancel(String(data.id));
          for (const task of store.tasks.filter(t => t.missionId === data.id && ["running", "approval"].includes(t.status))) await hq.interrupt(task.id);
          break;
        case "task.interrupt": await hq.interrupt(String(data.id)); break;
        case "approval.decide":
          if (typeof data.approve !== "boolean") throw new Error("Decisão inválida.");
          hq.decide(String(data.id), data.approve); break;
        case "queue.pause":
          if (typeof data.paused !== "boolean") throw new Error("Estado inválido.");
          hq.setQueue(data.paused); break;
        case "demo.start": hq.demoScenario(); break;
        default: throw new Error("Ação desconhecida.");
      }
      res.end(JSON.stringify({ ok: true }));
    } catch (error) { res.writeHead(400).end(JSON.stringify({ error: (error as Error).message })); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname;
    if (pathname === "/ws") {
      if (!localRequest(req, port) || !req.headers.origin) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => { wss.emit("connection", ws, req); ws.send(JSON.stringify({ type: "snapshot", data: hq.snapshot() })); });
    } else if (pathname.startsWith("/_next/")) { app.getUpgradeHandler()(req, socket, head); }
    else socket.destroy();
  });
  // Coalesce streaming deltas; avoid sending an entire snapshot per token.
  let timer: NodeJS.Timeout | undefined;
  hq.on("change", () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const payload = JSON.stringify({ type: "snapshot", data: hq.snapshot() });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 1000000) client.send(payload);
        else if (client.bufferedAmount >= 1000000) client.terminate();
      }
    }, 100);
  });
  const heartbeat = setInterval(() => { for (const client of wss.clients) client.ping(); }, 25000);
  server.listen(port, "127.0.0.1", () => console.log(`\nAgenFlux → http://127.0.0.1:${port}\nWorkspace: ${workspace}\nCodex só é iniciado ao clicar em Conectar.\n`));
  const shutdown = () => { clearInterval(heartbeat); clearTimeout(timer); hq.close(); for (const client of wss.clients) client.terminate(); wss.close(); server.close(); store.close(); void app.close().finally(() => process.exit(0)); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}
main().catch(error => { console.error(error); process.exit(1); });
