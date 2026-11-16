import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { Headquarters } from "../server/hq.ts";
import type { CodexTransport } from "../server/codex.ts";
import type { Approval, CatalogModel, EngineStatus, ProviderInfo, Task } from "../src/lib/types.ts";
import type { Engine, EngineHost, StartContext } from "../server/engines/types.ts";

// Transporte Codex inerte: os testes não iniciam o Codex real.
export class NullCodex extends EventEmitter implements CodexTransport {
  async connect() { throw new Error("Codex indisponível nos testes."); }
  async request() { return {}; }
  respond() {} reject() {} close() {}
}

export const model = (patch: Partial<CatalogModel> & { key: string }): CatalogModel => ({ engine: "opencode", providerId: "opencode", providerName: "OpenCode Zen", modelId: patch.key.split("/").pop()!, name: patch.key, cost: "free-temporary", toolCall: true, reasoning: true, efforts: ["low", "medium", "high"], connected: true, status: "active", tier: "light", chat: true, ...patch });

// Motor de TESTE: implementa a interface Engine e responde conforme um roteiro.
// Serve para exercitar o Orquestrador, o agendador e as aprovações sem rede.
// (O adaptador real do OpenCode é testado à parte, contra o binário verdadeiro.)
export class ScriptedEngine implements Engine {
  readonly id = "opencode" as const;
  started: StartContext[] = []; decisions: { id: string | number; approve: boolean }[] = []; maxParallel = 0; private running = 0;
  list: CatalogModel[] = [model({ key: "opencode:opencode/leve-free", tier: "light" }), model({ key: "opencode:opencode/forte-free", tier: "heavy" }), model({ key: "opencode:pago/gpt-pago", providerId: "pago", providerName: "Pago", cost: "paid", tier: "heavy" })];
  // Roteiro por agente: devolve o resultado, ou pede aprovação, ou falha.
  script: (context: StartContext, attempt: number) => { result?: string; approval?: { action: string; kind: Approval["kind"]; canApprove?: boolean }; fail?: string; limit?: boolean; delay?: number; cost?: number } = () => ({});
  private attempts = new Map<string, number>();
  private pending = new Map<string, { taskId: string; result: string }>();
  private host: EngineHost;
  constructor(host: EngineHost) { this.host = host; }
  status(): EngineStatus { return { id: "opencode", name: "OpenCode (roteiro de teste)", status: "connected", message: "teste" }; }
  async connect() {} disconnect() {} close() {}
  models() { return this.list; }
  providers(): ProviderInfo[] { return [{ id: "opencode", engine: "opencode", name: "OpenCode Zen", connected: true, env: [], authMethods: [], models: this.list.length, freeModels: 2 }]; }
  private done(taskId: string, result: string) { this.running--; this.host.patch(taskId, { result, cost: 0 }); this.host.finish(taskId, "completed"); }
  async start(context: StartContext) {
    this.started.push(context); this.running++; this.maxParallel = Math.max(this.maxParallel, this.running);
    const attempt = (this.attempts.get(context.task.id) ?? 0) + 1; this.attempts.set(context.task.id, attempt);
    const step = this.script(context, attempt);
    const result = step.result ?? JSON.stringify({ summary: `Entrega de ${context.agent.name}.`, files: [], findings: [], needsChanges: false, blockers: [] });
    setTimeout(() => {
      if (step.cost) this.host.patch(context.task.id, { cost: step.cost });
      if (step.fail) { this.running--; this.host.finish(context.task.id, "failed", step.fail, { limit: step.limit }); return; }
      if (step.approval) {
        const rpcId = `perm-${context.task.id}`; this.pending.set(rpcId, { taskId: context.task.id, result });
        this.host.requestApproval({ taskId: context.task.id, rpcId, method: "teste/permissao", kind: step.approval.kind, action: step.approval.action, reason: "Roteiro de teste", details: "{}", canApprove: step.approval.canApprove }); return;
      }
      this.done(context.task.id, result);
    }, step.delay ?? 5);
  }
  async interrupt(task: Task) { this.running--; this.host.finish(task.id, "interrupted", "Interrompido no teste."); }
  decide(approval: Approval, approve: boolean) {
    this.decisions.push({ id: approval.rpcId, approve });
    const pending = this.pending.get(String(approval.rpcId)); if (!pending) return;
    this.pending.delete(String(approval.rpcId));
    setTimeout(() => { if (approve) this.done(pending.taskId, pending.result); else { this.running--; this.host.finish(pending.taskId, "failed", "Ação recusada pelo usuário."); } }, 5);
  }
}

export function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "agenflux-ws-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "projeto-teste", scripts: { test: "node --test" }, dependencies: { next: "^16.0.0", react: "^19.0.0" } }));
  writeFileSync(join(dir, "README.md"), "# Projeto de teste\n");
  writeFileSync(join(dir, "src", "app.tsx"), "export const App = () => <main>Olá</main>;\n");
  return dir;
}
export async function createHq(options: { db?: string; dir?: string } = {}) {
  const dir = options.dir ?? workspace();
  const data = mkdtempSync(join(tmpdir(), "agenflux-data-"));
  const store = new Store(options.db ?? ":memory:");
  await store.migrateTeam(); await store.migrateV3();
  let engine!: ScriptedEngine;
  const hq = new Headquarters(store, new NullCodex(), dir, { dataDir: data, eccRoot: join(data, "sem-ecc"), engines: { opencode: host => (engine = new ScriptedEngine(host)), ollama: host => ({ id: "ollama", status: () => ({ id: "ollama", name: "Ollama", status: "disconnected", message: "" }), connect: async () => {}, disconnect() {}, models: () => [], providers: () => [], start: async () => {}, interrupt: async () => {}, decide() {}, close() {} } as Engine) } });
  return { hq, store, engine, dir, data };
}
export async function until(check: () => boolean, label = "condição", ms = 8000) {
  const started = Date.now();
  while (!check()) { if (Date.now() - started > ms) throw new Error(`Tempo esgotado aguardando: ${label}`); await new Promise(r => setTimeout(r, 10)); }
}
