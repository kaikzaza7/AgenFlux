import next from "next";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { Store } from "./store.ts";
import { CodexClient } from "./codex.ts";
import { Headquarters } from "./hq.ts";
import { localRequest } from "./security.ts";
import { ensureEccCatalog } from "./ecc-catalog.ts";
import { redact } from "./redact.ts";

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT deve estar entre 1024 e 65535.");
  const dir = resolve(process.env.AGENT_HQ_DATA_DIR ?? resolve(process.cwd(), "data"));
  mkdirSync(dir, { recursive: true });
  const workspace = resolve(process.env.AGENT_HQ_WORKSPACE ?? join(dir, "workspace"));
  mkdirSync(workspace, { recursive: true });
  const store = new Store(join(dir, "agent-hq.sqlite"));
  await store.migrateTeam(join(dir, "agent-hq.pre-v2.sqlite"));
  await store.migrateV3(join(dir, "agent-hq.pre-v3.sqlite"));
  try { const ecc = ensureEccCatalog(); if (ecc.created) console.log(`Catálogo ECC reconstruído a partir dos arquivos locais (${ecc.entries} entradas).`); } catch (error) { console.warn(`Biblioteca ECC indisponível: ${(error as Error).message}`); }
  const hq = new Headquarters(store, new CodexClient(), workspace, { dataDir: dir });
  const app = next({ dev: !process.argv.includes("--production"), hostname: "127.0.0.1", port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer(async (req, res) => {
    if (!localRequest(req, port, req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(403).end("Acesso permitido somente pela origem local do AgenFlux."); return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/hq")) { await handle(req, res); return; }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      if (pathname === "/api/hq/state" && req.method === "GET") { res.end(JSON.stringify(hq.snapshot())); return; }
      if (pathname === "/api/hq/catalog" && req.method === "GET") { res.end(JSON.stringify(hq.catalog())); return; }
      if (pathname === "/api/hq/skills" && req.method === "GET") {
        const id = url.searchParams.get("id");
        res.end(JSON.stringify(id ? { id, content: hq.skillContent(id) } : { skills: hq.skillList(url.searchParams.get("cwd") || undefined) })); return;
      }
      if (pathname !== "/api/hq/action" || req.method !== "POST") { res.writeHead(404).end(JSON.stringify({ error: "Rota inexistente." })); return; }
      let body = "";
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 40000) throw new Error("Solicitação muito grande."); }
      const data = JSON.parse(body);
      // `result` devolve dados de ações que produzem resposta (plano, teste, inspeção).
      let result: unknown;
      switch (data.action) {
        case "connect": await hq.connect("codex"); break; // compatível com a versão 2
        case "engine.connect": await hq.connect(data.engine); break;
        case "engine.disconnect": hq.disconnect(data.engine); break;
        case "catalog.refresh": await hq.refreshCatalog(); break;
        case "provider.auth": await hq.providerAuth(data.providerId, data.key); break;
        case "provider.logout": await hq.providerLogout(data.providerId); break;
        case "model.test": result = await hq.testModel(data.key); break;
        case "settings.save": hq.saveSettings(data); break;
        case "agent.create": hq.addAgent(data); break;
        case "agent.update": hq.updateAgent(data); break;
        case "agent.settings": hq.saveAgentSettings(data); break;
        case "agent.import": hq.importAgent(data.profileId, data.office === true); break;
        case "office.set": hq.applyOfficeSelection(data.agentIds); break;
        case "team.save": hq.saveTeam(data); break;
        case "team.use": hq.useTeam(data.id); break;
        case "team.delete": hq.deleteTeam(String(data.id)); break;
        case "task.create": hq.createTask({ agentId: data.agentId, title: data.title, prompt: data.prompt, mode: data.mode, cwd: data.cwd, libraryProfileId: data.libraryProfileId, skillIds: data.skillIds }); break;
        case "ai.save": hq.saveConfiguration(data); break;
        case "mission.plan": result = hq.plan(data); break;
        case "mission.create": result = { id: hq.createMission(data).id }; break;
        case "mission.retry": case "mission.resume": hq.retryMission(String(data.id)); break;
        case "mission.cancel":
          hq.missions.cancel(String(data.id));
          for (const task of store.tasks.filter(t => t.missionId === data.id && ["running", "approval"].includes(t.status))) await hq.interrupt(task.id).catch(() => undefined);
          break;
        case "task.interrupt": await hq.interrupt(String(data.id)); break;
        case "approval.decide":
          if (typeof data.approve !== "boolean") throw new Error("Decisão inválida.");
          await hq.decide(String(data.id), data.approve); break;
        case "queue.pause":
          if (typeof data.paused !== "boolean") throw new Error("Estado inválido.");
          hq.setQueue(data.paused); break;
        case "skill.set": hq.setSkill(data); break;
        case "skill.inspect": result = hq.inspectSkill(data.path); break;
        case "skill.install": result = { id: hq.installSkill(data.id) }; break;
        case "skill.remove": hq.removeSkill(data.id); break;
        case "automation.save": result = hq.automations.save(data); break;
        case "automation.toggle":
          if (typeof data.enabled !== "boolean") throw new Error("Estado inválido.");
          hq.automations.toggle(String(data.id), data.enabled); break;
        case "automation.delete": hq.automations.remove(String(data.id)); break;
        case "automation.run": result = { id: hq.automations.run(String(data.id), true)?.id }; break;
        case "demo.start": hq.demoScenario(); break;
        default: throw new Error("Ação desconhecida.");
      }
      res.end(JSON.stringify({ ok: true, ...(result === undefined ? {} : { result }) }));
    } catch (error) { res.writeHead(400).end(JSON.stringify({ error: redact((error as Error).message) })); }
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
  server.listen(port, "127.0.0.1", () => {
    console.log(`\nAgenFlux 3 → http://127.0.0.1:${port}\nWorkspace: ${workspace}\nMotores (OpenCode, Ollama, Codex) só iniciam quando você conecta em "Modelos e Provedores".\n`);
    hq.automations.start(); hq.autoConnect();
  });
  const shutdown = () => { clearInterval(heartbeat); clearTimeout(timer); hq.close(); for (const client of wss.clients) client.terminate(); wss.close(); server.close(); store.close(); void app.close().finally(() => process.exit(0)); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}
main().catch(error => { console.error(error); process.exit(1); });
