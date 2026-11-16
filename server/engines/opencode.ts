import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Approval, CatalogModel, EngineStatus, ProviderInfo, Task } from "../../src/lib/types.ts";
import { classifyCost, modelTier } from "../catalog.ts";
import { commandRisk, readOnlyCommand } from "../command-safety.ts";
import { redact } from "../redact.ts";
import { isAuthError, isLimitError, type Engine, type EngineHost, type StartContext, type TestResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Adaptador do OpenCode.
//
// Usa a API HTTP oficial do `opencode serve` (documentada em
// https://opencode.ai/docs/server/ e descrita pelo próprio servidor em GET /doc).
// Os caminhos abaixo foram conferidos contra a especificação OpenAPI emitida pelo
// OpenCode 1.19.5:
//   GET  /global/health                 saúde e versão
//   GET  /global/event                  eventos em tempo real (SSE)
//   GET  /provider, /provider/auth      provedores, modelos, preços e formas de login
//   PUT  /auth/{providerID}             grava a credencial NO OpenCode (nunca aqui)
//   POST /session                       cria sessão (com regras de permissão)
//   POST /session/{id}/prompt_async     inicia a tarefa sem bloquear
//   POST /session/{id}/message          envio síncrono (teste de conexão)
//   GET  /session/{id}/message          mensagens, ferramentas, tokens e custo
//   GET  /session/status                estado (busy/idle/retry) para reconexão
//   POST /session/{id}/abort            interrompe
//   GET  /permission                    aprovações pendentes
//   POST /permission/{id}/reply         responde once | reject
//
// A comunicação fica restrita a 127.0.0.1 e protegida por senha (HTTP Basic).
// No modo gerenciado, o AgenFlux inicia o servidor com uma senha aleatória que só
// existe na memória deste processo.
// ---------------------------------------------------------------------------

type Json = Record<string, any>;
interface Tracked { taskId: string; sessionId: string; cwd: string; prompted: boolean; harvesting: boolean; aborted: boolean; error?: string; seen: Set<string>; steps: number; maxSteps?: number; readOnly: boolean; commandPolicy: "read" | "ask" }

export function opencodeCommand(): string {
  const explicit = process.env.OPENCODE_BIN;
  if (explicit) {
    if (!existsSync(explicit) || /\.(cmd|bat|ps1)$/i.test(explicit)) throw new Error("OPENCODE_BIN deve apontar para o executável opencode(.exe); arquivos .cmd/.ps1 não são executados via shell.");
    return explicit;
  }
  const win = process.platform === "win32";
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  if (win && process.env.USERPROFILE) dirs.push(join(process.env.USERPROFILE, ".opencode", "bin"));
  if (!win && process.env.HOME) dirs.push(join(process.env.HOME, ".opencode", "bin"));
  for (const dir of dirs) {
    // O pacote npm `opencode-ai` instala o binário nativo em bin/opencode.exe em todos os sistemas.
    for (const candidate of [join(dir, win ? "opencode.exe" : "opencode"), join(dir, "node_modules", "opencode-ai", "bin", "opencode.exe")]) if (existsSync(candidate)) return candidate;
  }
  throw new Error("OpenCode não encontrado. Instale-o (veja o assistente em Modelos e Provedores) ou defina OPENCODE_BIN com o caminho do executável.");
}

const loopback = (url: string) => { try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname); } catch { return false; } };

export class OpenCodeEngine implements Engine {
  readonly id = "opencode" as const;
  private host: EngineHost;
  private state: EngineStatus = { id: "opencode", name: "OpenCode", status: "disconnected", message: "Conecte o OpenCode para usar modelos gratuitos com ferramentas." };
  private child?: ChildProcess;
  private base = "";
  private authorization = "";
  private stream?: AbortController;
  private closing = false;
  private catalog: { models: CatalogModel[]; providers: ProviderInfo[] } = { models: [], providers: [] };
  private sessions = new Map<string, Tracked>();
  private workspace: string;
  private resolveCommand: () => string;
  private reconnectTimer?: NodeJS.Timeout;
  constructor(host: EngineHost, workspace: string, resolveCommand: () => string = opencodeCommand) { this.host = host; this.workspace = workspace; this.resolveCommand = resolveCommand; }

  status() { return { ...this.state, models: this.catalog.models.length, freeModels: this.catalog.models.filter(m => m.connected && ["free", "free-limited", "free-temporary", "local"].includes(m.cost)).length }; }
  models() { return this.catalog.models; }
  providers() { return this.catalog.providers; }
  private set(patch: Partial<EngineStatus>) { this.state = { ...this.state, ...patch }; this.host.statusChanged("opencode"); }

  async connect() {
    if (this.state.status === "connecting") return;
    this.disconnect(true);
    this.closing = false;
    this.set({ status: "connecting", message: "Procurando o servidor do OpenCode…" });
    try {
      const external = process.env.OPENCODE_URL?.replace(/\/+$/, "");
      if (external) {
        if (!loopback(external) && process.env.AGENFLUX_ALLOW_REMOTE_OPENCODE !== "1") throw new Error("OPENCODE_URL deve apontar para 127.0.0.1/localhost. Conexões remotas ficam bloqueadas por segurança.");
        this.base = external;
        const password = process.env.OPENCODE_SERVER_PASSWORD;
        this.authorization = password ? "Basic " + Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`).toString("base64") : "";
        this.state.managed = false;
      } else await this.spawnManaged();
      // O servidor anuncia a porta um instante antes de aceitar conexões: tentamos algumas vezes.
      let health: Json | undefined, lastError: unknown;
      for (let attempt = 0; attempt < 12 && !health; attempt++) {
        try { health = await this.api("GET", "/global/health", undefined, { timeout: 5000 }); }
        catch (error) { lastError = error; if (/senha/.test((error as Error).message)) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      if (health?.healthy !== true) throw new Error(`O servidor do OpenCode não respondeu como saudável. ${(lastError as Error | undefined)?.message ?? ""}`);
      await this.refresh();
      this.subscribe();
      const free = this.status().freeModels ?? 0;
      this.set({ status: "connected", version: String(health.version ?? ""), url: this.base, message: `OpenCode ${health.version} conectado • ${this.catalog.providers.filter(p => p.connected).length} provedor(es) ativo(s) • ${free} modelo(s) sem custo por token.` });
    } catch (error) {
      this.killChild();
      this.set({ status: "error", message: redact((error as Error).message) });
      throw error;
    }
  }

  private spawnManaged(): Promise<void> {
    const file = this.resolveCommand();
    const password = randomBytes(24).toString("hex");
    this.authorization = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
    return new Promise((resolve, reject) => {
      const child = spawn(file, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
        cwd: this.workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: "opencode", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
      });
      this.child = child; this.state.managed = true;
      let output = "", settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error("O OpenCode não iniciou em 30 segundos.")); } }, 30000);
      const read = (chunk: Buffer) => {
        output = (output + String(chunk)).slice(-4000);
        const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match && !settled) { settled = true; clearTimeout(timer); this.base = match[1]; resolve(); }
      };
      child.stdout?.on("data", read); child.stderr?.on("data", read);
      child.on("error", error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
      child.on("exit", code => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`OpenCode encerrou ao iniciar (${code}). ${redact(output.slice(-600))}`)); return; }
        if (this.child === child && !this.closing) this.lost(`O servidor do OpenCode encerrou (${code}).`);
      });
    });
  }

  private async api(method: string, path: string, body?: unknown, options: { cwd?: string; timeout?: number } = {}): Promise<any> {
    if (!this.base) throw new Error("OpenCode desconectado.");
    const url = new URL(this.base + path);
    if (options.cwd) url.searchParams.set("directory", options.cwd);
    const response = await fetch(url, {
      method, signal: AbortSignal.timeout(options.timeout ?? 30000),
      headers: { ...(this.authorization ? { Authorization: this.authorization } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (response.status === 401) throw new Error("O OpenCode recusou a senha do servidor. Confira OPENCODE_SERVER_PASSWORD.");
    if (!response.ok) throw new Error(`OpenCode respondeu ${response.status} em ${path}: ${redact(text.slice(0, 300))}`);
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { return text; }
  }

  // Lê provedores e modelos reais. Preço, uso de ferramentas e níveis de raciocínio
  // vêm do OpenCode; nada é presumido.
  async refresh() {
    const [list, auth] = await Promise.all([this.api("GET", "/provider"), this.api("GET", "/provider/auth").catch(() => ({}))]);
    const connected = new Set<string>(Array.isArray(list?.connected) ? list.connected : []);
    const models: CatalogModel[] = [], providers: ProviderInfo[] = [];
    for (const provider of (list?.all ?? []) as Json[]) {
      const isConnected = connected.has(provider.id);
      const entries = Object.values(provider.models ?? {}) as Json[];
      const baseUrl = typeof provider.options?.baseURL === "string" ? provider.options.baseURL : undefined;
      let free = 0;
      for (const model of entries) {
        const chat = model.capabilities?.output?.text !== false && model.capabilities?.input?.text !== false && (model.limit?.context ?? 0) >= 2048;
        const { cost, note } = classifyCost({ providerId: provider.id, modelId: model.id, name: model.name, costIn: Number(model.cost?.input ?? 0), costOut: Number(model.cost?.output ?? 0), baseUrl: baseUrl ?? model.api?.url, connected: isConnected, status: model.status });
        if (chat && ["free", "free-limited", "free-temporary", "local"].includes(cost)) free++;
        // Só os modelos de provedores conectados entram no catálogo navegável: os
        // demais (centenas) ficam resumidos na lista de provedores.
        if (!isConnected) continue;
        models.push({
          key: `opencode:${provider.id}/${model.id}`, engine: "opencode", providerId: provider.id, providerName: provider.name, modelId: model.id, name: model.name ?? model.id,
          cost, costNote: note, toolCall: model.capabilities?.toolcall === true, reasoning: model.capabilities?.reasoning === true,
          efforts: Object.keys(model.variants ?? {}), context: model.limit?.context, connected: true, status: model.status, tier: modelTier(model.id, model.name), chat,
        });
      }
      providers.push({ id: provider.id, engine: "opencode", name: provider.name, connected: isConnected, env: Array.isArray(provider.env) ? provider.env : [], authMethods: (auth?.[provider.id] ?? [{ type: "api", label: "Chave de API" }]).map((m: Json) => ({ type: String(m.type), label: String(m.label) })), models: entries.length, freeModels: free });
    }
    this.catalog = { models, providers };
    this.host.statusChanged("opencode");
  }

  // Entrega a chave diretamente ao OpenCode. O AgenFlux não a grava, não a devolve
  // ao navegador e não a registra em log.
  async setAuth(providerId: string, key: string) {
    if (!/^[a-z0-9._-]{1,64}$/i.test(providerId)) throw new Error("Provedor inválido.");
    if (typeof key !== "string" || key.length < 8 || key.length > 400 || /\s/.test(key)) throw new Error("Chave inválida.");
    await this.api("PUT", `/auth/${encodeURIComponent(providerId)}`, { type: "api", key });
    await this.api("POST", "/global/dispose").catch(() => undefined);
    await this.refresh();
    if (!this.catalog.providers.find(p => p.id === providerId)?.connected) throw new Error("O OpenCode gravou a credencial, mas o provedor ainda não aparece conectado. Reconecte o OpenCode.");
  }
  async removeAuth(providerId: string) {
    if (!/^[a-z0-9._-]{1,64}$/i.test(providerId)) throw new Error("Provedor inválido.");
    await this.api("DELETE", `/auth/${encodeURIComponent(providerId)}`);
    await this.api("POST", "/global/dispose").catch(() => undefined);
    await this.refresh();
  }

  private subscribe() {
    this.stream?.abort();
    const controller = new AbortController(); this.stream = controller;
    void (async () => {
      try {
        const response = await fetch(this.base + "/global/event", { signal: controller.signal, headers: { Accept: "text/event-stream", ...(this.authorization ? { Authorization: this.authorization } : {}) } });
        if (!response.ok || !response.body) throw new Error(`Fluxo de eventos indisponível (${response.status}).`);
        const decoder = new TextDecoder(); let buffer = "";
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          let index: number;
          while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
            const frame = buffer.slice(0, index); buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
            const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            try { const message = JSON.parse(data); this.handle(message.payload ?? message); } catch { /* quadro inválido é ignorado */ }
          }
        }
        throw new Error("O fluxo de eventos foi encerrado pelo servidor.");
      } catch (error) {
        if (controller.signal.aborted || this.closing) return;
        this.scheduleReconnect((error as Error).message);
      }
    })();
  }

  // Queda do fluxo de eventos: reconecta com espera crescente e reconcilia o estado
  // das sessões ativas, para não perder conclusões nem aprovações ocorridas no intervalo.
  private scheduleReconnect(reason: string, attempt = 0) {
    if (this.closing || this.state.status === "disconnected") return;
    this.set({ status: "connecting", message: `Reconectando ao OpenCode… (${redact(reason)})` });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      try {
        const health = await this.api("GET", "/global/health", undefined, { timeout: 5000 });
        if (health?.healthy !== true) throw new Error("sem resposta");
        this.subscribe();
        this.set({ status: "connected", message: `OpenCode ${health.version} reconectado. Estado das sessões recuperado.` });
        await this.reconcile();
      } catch (error) {
        if (attempt >= 5) this.lost(`Não foi possível reconectar ao OpenCode: ${(error as Error).message}`);
        else this.scheduleReconnect(reason, attempt + 1);
      }
    }, Math.min(1000 * 2 ** attempt, 15000));
  }
  async reconcile() {
    for (const tracked of [...this.sessions.values()]) {
      try {
        const [statuses, pending] = await Promise.all([
          this.api("GET", "/session/status", undefined, { cwd: tracked.cwd }),
          this.api("GET", "/permission", undefined, { cwd: tracked.cwd }),
        ]);
        for (const request of (Array.isArray(pending) ? pending : []) as Json[]) if (request.sessionID === tracked.sessionId) this.permission(tracked, request);
        const state = statuses?.[tracked.sessionId]?.type;
        if (tracked.prompted && (!state || state === "idle")) await this.harvest(tracked);
      } catch (error) { this.host.event(tracked.taskId, "error", `Falha ao recuperar o estado da sessão: ${redact((error as Error).message)}`); }
    }
  }
  private lost(message: string) {
    this.stream?.abort(); this.killChild(); this.base = "";
    for (const tracked of [...this.sessions.values()]) this.host.finish(tracked.taskId, "interrupted", message);
    this.sessions.clear();
    this.catalog = { models: [], providers: [] };
    this.set({ status: "error", message });
  }

  private tracked(sessionId: unknown) { return typeof sessionId === "string" ? this.sessions.get(sessionId) : undefined; }

  private handle(event: Json) {
    const p: Json = event?.properties ?? {};
    switch (event?.type) {
      case "message.part.updated": {
        const part: Json = p.part ?? {}; const tracked = this.tracked(part.sessionID);
        if (!tracked) return;
        if (part.type === "step-start") {
          const key = `step:${part.id}`; if (tracked.seen.has(key)) return; tracked.seen.add(key);
          tracked.steps++; this.host.patch(tracked.taskId, { steps: tracked.steps });
          if (tracked.maxSteps && tracked.steps > tracked.maxSteps && !tracked.aborted) {
            tracked.error = `Limite de ${tracked.maxSteps} etapas do agente atingido. Aumente o limite em Agentes ou divida a missão.`;
            void this.api("POST", `/session/${tracked.sessionId}/abort`, undefined, { cwd: tracked.cwd }).catch(() => undefined);
          }
        } else if (part.type === "tool") this.tool(tracked, part);
        this.host.changed(); return;
      }
      case "permission.asked": { const tracked = this.tracked(p.sessionID); if (tracked) this.permission(tracked, p); return; }
      case "permission.replied": this.host.expireApproval("opencode", String(p.requestID ?? p.permissionID ?? "")); return;
      case "question.asked": {
        // Perguntas interativas não têm equivalente no escritório: são recusadas e registradas.
        const tracked = this.tracked(p.sessionID);
        if (tracked && p.id) { void this.api("POST", `/question/${p.id}/reject`, undefined, { cwd: tracked.cwd }).catch(() => undefined); this.host.event(tracked.taskId, "unsupported", "O modelo tentou fazer uma pergunta interativa; o AgenFlux recusou e pediu que prossiga com as informações da missão."); }
        return;
      }
      case "file.edited": { const tracked = [...this.sessions.values()].find(t => typeof p.file === "string" && p.file.startsWith(t.cwd)); if (tracked) this.files(tracked, [p.file]); return; }
      case "session.diff": { const tracked = this.tracked(p.sessionID); if (tracked && Array.isArray(p.diff)) this.files(tracked, p.diff.map((d: Json) => d.file).filter((f: unknown) => typeof f === "string")); return; }
      case "session.error": { const tracked = this.tracked(p.sessionID); if (tracked) tracked.error ??= `${p.error?.name ?? "Erro"}: ${p.error?.data?.message ?? "falha informada pelo OpenCode"}`; return; }
      case "session.status": {
        const tracked = this.tracked(p.sessionID);
        if (tracked && p.status?.type === "retry") {
          const message = redact(String(p.status.message ?? ""));
          this.host.event(tracked.taskId, "retry", `O provedor pediu nova tentativa (${p.status.attempt}): ${message}`);
          // O OpenCode insiste indefinidamente em erros de cota. Na segunda tentativa
          // encerramos a sessão e devolvemos a falha, para o AgenFlux poder trocar de modelo.
          if (p.status.attempt >= 2 && !tracked.aborted && !tracked.error) {
            tracked.error = `Limite de uso do provedor: ${message}`;
            void this.api("POST", `/session/${tracked.sessionId}/abort`, undefined, { cwd: tracked.cwd }).catch(() => undefined);
            setTimeout(() => void this.harvest(tracked), 2000);
          }
        }
        if (tracked && p.status?.type === "idle") void this.harvest(tracked);
        return;
      }
      case "session.idle": { const tracked = this.tracked(p.sessionID); if (tracked) void this.harvest(tracked); return; }
    }
  }

  private files(tracked: Tracked, files: string[]) {
    const task = this.host.task(tracked.taskId); if (!task || !files.length) return;
    const relative = files.map(file => file.startsWith(tracked.cwd) ? file.slice(tracked.cwd.length).replace(/^[\\/]/, "") : file);
    const merged = [...new Set([...task.files, ...relative])].slice(-200);
    if (merged.length !== task.files.length) { this.host.patch(tracked.taskId, { files: merged }); this.host.changed(); }
  }

  private tool(tracked: Tracked, part: Json) {
    const status = part.state?.status; const key = `tool:${part.id}:${status}`;
    if (tracked.seen.has(key) || status === "pending") return; tracked.seen.add(key);
    const input: Json = part.state?.input ?? {};
    const target = input.command ?? input.filePath ?? input.path ?? input.pattern ?? input.url ?? part.state?.title ?? "";
    const label = `${part.tool}${target ? `: ${String(target).slice(0, 300)}` : ""}`;
    const task = this.host.task(tracked.taskId); if (!task) return;
    if (status === "running") { this.host.patch(tracked.taskId, { tool: String(part.tool) }); this.host.event(tracked.taskId, "tool", `Usando ferramenta ${label}`); return; }
    if (part.tool === "bash" && typeof input.command === "string") this.host.patch(tracked.taskId, { commands: [...new Set([...task.commands, input.command])].slice(-100), tool: undefined });
    else this.host.patch(tracked.taskId, { tool: undefined });
    if (status === "completed" && ["edit", "write", "patch", "apply_patch", "multiedit"].includes(part.tool) && typeof input.filePath === "string") this.files(tracked, [input.filePath]);
    this.host.event(tracked.taskId, status === "error" ? "error" : "tool", status === "error" ? `Ferramenta ${label} falhou: ${redact(String(part.state?.error ?? "")).slice(0, 600)}` : `Ferramenta concluída ${label}`);
  }

  private permission(tracked: Tracked, request: Json) {
    const id = String(request.id ?? ""); if (!id || tracked.seen.has(`perm:${id}`)) return; tracked.seen.add(`perm:${id}`);
    const type = String(request.permission ?? "ação");
    const patterns = Array.isArray(request.patterns) ? request.patterns.map(String) : [];
    const command = typeof request.metadata?.command === "string" ? request.metadata.command : patterns.join(" ");
    const kind: Approval["kind"] = type === "bash" ? "command" : type === "edit" ? "edit" : /web|fetch|search/.test(type) ? "network" : "other";
    const file = request.metadata?.filepath ?? request.metadata?.filePath ?? patterns[0];
    const action = kind === "command" ? command : kind === "edit" ? `Alterar arquivo: ${file ?? "arquivo do workspace"}` : kind === "network" ? `Acessar a rede: ${patterns.join(", ") || type}` : `${type}: ${patterns.join(", ")}`;
    const safeRead = kind === "command" && readOnlyCommand(command);
    // Missão somente leitura: só comandos de leitura podem ser aprovados (o Testador,
    // com política "ask", pode pedir a execução de testes — sempre com decisão humana).
    const canApprove = kind === "edit" ? !tracked.readOnly : kind === "command" ? (safeRead || !tracked.readOnly || tracked.commandPolicy === "ask") : !tracked.readOnly;
    const risks = kind === "command" ? commandRisk(command) : kind === "edit" ? "Modifica um arquivo do workspace autorizado. A alteração proposta está nos detalhes." : kind === "network" ? "Envia uma requisição para fora do seu computador." : "Ação não classificada: leia os detalhes antes de decidir.";
    this.host.requestApproval({
      taskId: tracked.taskId, rpcId: id, method: `opencode/permission/${type}`, kind, action: String(action).slice(0, 2000),
      reason: `O agente pediu permissão para ${kind === "command" ? "executar um comando" : kind === "edit" ? "editar um arquivo" : kind === "network" ? "acessar a rede" : "realizar uma ação"}.`,
      details: redact(JSON.stringify({ permission: type, patterns, metadata: request.metadata ?? {} }, null, 2)).slice(0, 24000),
      risks: canApprove ? risks : `${risks} Bloqueado pela política da missão (somente leitura): recuse a solicitação.`, canApprove,
      ...(safeRead ? { automatic: { reason: "Comando de leitura dentro do workspace; sem escrita, rede ou regra permanente." } } : {}),
    });
  }

  async start(context: StartContext) {
    const { task, model } = context;
    if (!model) throw new Error("Etapa sem modelo definido.");
    if (this.state.status !== "connected") throw new Error("OpenCode desconectado. Conecte-o em Modelos e Provedores.");
    const readOnly = context.readOnly;
    // Regras por sessão: edição só com aprovação (ou negada em leitura); comandos e
    // rede sempre perguntam; subagentes e pastas externas ficam bloqueados.
    const permission = [
      { permission: "edit", pattern: "*", action: readOnly ? "deny" : "ask" },
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "webfetch", pattern: "*", action: readOnly ? "deny" : "ask" },
      { permission: "websearch", pattern: "*", action: readOnly ? "deny" : "ask" },
      { permission: "external_directory", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "question", pattern: "*", action: "deny" },
    ];
    const session = await this.api("POST", "/session", { title: `AgenFlux • ${context.agent.name} • ${task.title}`.slice(0, 120), permission }, { cwd: task.cwd });
    if (typeof session?.id !== "string") throw new Error("O OpenCode não retornou um ID de sessão.");
    const tracked: Tracked = { taskId: task.id, sessionId: session.id, cwd: task.cwd, prompted: false, harvesting: false, aborted: false, seen: new Set(), steps: 0, maxSteps: context.maxSteps, readOnly, commandPolicy: task.commandPolicy ?? "read" };
    this.sessions.set(session.id, tracked);
    this.host.patch(task.id, { sessionId: session.id, effectiveModel: `${model.providerId}/${model.modelId}`, ...(context.effort ? { effectiveEffort: context.effort } : {}) });
    this.host.event(task.id, "session", `Sessão OpenCode ${session.id} criada com ${model.name} (${model.providerName}).`);
    try {
      await this.api("POST", `/session/${session.id}/prompt_async`, {
        model: { providerID: model.providerId, modelID: model.modelId }, agent: "build", system: context.system,
        ...(context.effort && model.efforts.includes(context.effort) ? { variant: context.effort } : {}),
        parts: [{ type: "text", text: context.prompt }],
      }, { cwd: task.cwd });
      tracked.prompted = true;
    } catch (error) { this.sessions.delete(session.id); throw error; }
  }

  // Sessão ociosa: busca as mensagens finais, soma tokens/custo e conclui a etapa.
  private async harvest(tracked: Tracked) {
    if (!tracked.prompted || tracked.harvesting || !this.sessions.has(tracked.sessionId)) return;
    tracked.harvesting = true;
    try {
      const messages = await this.api("GET", `/session/${tracked.sessionId}/message`, undefined, { cwd: tracked.cwd }) as Json[];
      const assistants = (Array.isArray(messages) ? messages : []).filter(m => m.info?.role === "assistant");
      if (!assistants.length && !tracked.error && !tracked.aborted) { tracked.harvesting = false; return; }
      // Ainda trabalhando (ex.: evento de ociosidade antigo): não conclui antes da hora.
      if (!tracked.error && !tracked.aborted && assistants.at(-1)?.info?.time?.completed === undefined) { tracked.harvesting = false; return; }
      let cost = 0; const usage = { totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, cachedInputTokens: 0 };
      for (const message of assistants) {
        cost += Number(message.info.cost ?? 0); const t = message.info.tokens ?? {};
        usage.inputTokens += Number(t.input ?? 0); usage.outputTokens += Number(t.output ?? 0); usage.reasoningOutputTokens += Number(t.reasoning ?? 0); usage.cachedInputTokens += Number(t.cache?.read ?? 0);
      }
      usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.reasoningOutputTokens;
      const withText = [...assistants].reverse().find(m => (m.parts ?? []).some((part: Json) => part.type === "text" && String(part.text ?? "").trim()));
      const text = withText ? withText.parts.filter((part: Json) => part.type === "text").map((part: Json) => String(part.text ?? "")).join("\n").trim() : "";
      const last = assistants.at(-1);
      const failure = last?.info?.error ? `${last.info.error.name ?? "Erro"}: ${last.info.error.data?.message ?? ""}` : tracked.error;
      this.sessions.delete(tracked.sessionId);
      this.host.patch(tracked.taskId, { cost, tokenUsage: usage, tool: undefined, ...(text ? { result: redact(text).slice(-100000) } : {}) });
      if (tracked.aborted && !tracked.error?.startsWith("Limite de")) this.host.finish(tracked.taskId, "interrupted", "Execução interrompida a pedido do usuário.");
      else if (failure && (!text || last?.info?.error || tracked.error?.startsWith("Limite de"))) {
        // Erro que nós mesmos provocamos (limite de etapas/cota) tem prioridade sobre o "abortado".
        const message = redact(tracked.error?.startsWith("Limite de") ? tracked.error : failure);
        this.host.finish(tracked.taskId, /MessageAbortedError/.test(message) && !tracked.error ? "interrupted" : "failed", message, { limit: tracked.error?.startsWith("Limite de uso") || isLimitError(message), auth: isAuthError(message) });
      } else if (!text) this.host.finish(tracked.taskId, "failed", "O modelo encerrou sem produzir resposta.");
      else this.host.finish(tracked.taskId, "completed");
    } catch (error) {
      tracked.harvesting = false;
      this.host.event(tracked.taskId, "error", `Não foi possível ler o resultado da sessão: ${redact((error as Error).message)}`);
    }
  }

  async interrupt(task: Task) {
    const tracked = [...this.sessions.values()].find(t => t.taskId === task.id);
    if (!tracked) { this.host.finish(task.id, "interrupted", "Execução interrompida."); return; }
    tracked.aborted = true;
    await this.api("POST", `/session/${tracked.sessionId}/abort`, undefined, { cwd: tracked.cwd });
    this.host.event(task.id, "interrupt", "Interrupção enviada ao OpenCode.");
    // Garante a conclusão mesmo que o evento de ociosidade não chegue.
    setTimeout(() => void this.harvest(tracked), 1500);
  }

  async decide(approval: Approval, approve: boolean) {
    const task = this.host.task(approval.taskId);
    await this.api("POST", `/permission/${encodeURIComponent(String(approval.rpcId))}/reply`, { reply: approve ? "once" : "reject", ...(approve ? {} : { message: "Recusado pelo usuário no AgenFlux." }) }, { cwd: task?.cwd });
  }

  // Requisição mínima e real para comprovar que o modelo responde.
  async test(model: CatalogModel): Promise<TestResult> {
    const started = Date.now();
    const session = await this.api("POST", "/session", { title: "AgenFlux • teste de conexão", permission: [{ permission: "*", pattern: "*", action: "deny" }] }, { cwd: this.workspace });
    try {
      const reply = await this.api("POST", `/session/${session.id}/message`, { model: { providerID: model.providerId, modelID: model.modelId }, agent: "build", system: "Responda de forma mínima.", parts: [{ type: "text", text: "Responda somente com a palavra OK." }] }, { cwd: this.workspace, timeout: 90000 });
      const error = reply?.info?.error;
      if (error) throw new Error(`${error.name ?? "Erro"}: ${error.data?.message ?? "falha informada pelo provedor"}`);
      const text = (reply?.parts ?? []).filter((part: Json) => part.type === "text").map((part: Json) => String(part.text ?? "")).join(" ").trim();
      const tokens = reply?.info?.tokens ?? {};
      return { ok: Boolean(text), text: redact(text).slice(0, 300) || "(sem texto)", ms: Date.now() - started, cost: Number(reply?.info?.cost ?? 0), tokens: Number(tokens.input ?? 0) + Number(tokens.output ?? 0) };
    } finally { void this.api("DELETE", `/session/${session.id}`, undefined, { cwd: this.workspace }).catch(() => undefined); }
  }

  // Encerra o servidor gerenciado sem deixar processo órfão: pede o término e, se
  // ele não sair em 2 segundos, força. Os canais são liberados para não prender o Node.
  private killChild() {
    const child = this.child; this.child = undefined;
    if (!child) return;
    child.stdout?.destroy(); child.stderr?.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 2000);
      force.unref();
    }
    child.unref();
  }
  disconnect(silent = false) {
    clearTimeout(this.reconnectTimer); this.stream?.abort(); this.stream = undefined;
    for (const tracked of [...this.sessions.values()]) this.host.finish(tracked.taskId, "interrupted", "OpenCode desconectado.");
    this.sessions.clear(); this.killChild(); this.base = ""; this.catalog = { models: [], providers: [] };
    if (!silent) this.set({ status: "disconnected", message: "OpenCode desconectado.", version: undefined, url: undefined });
  }
  close() { this.closing = true; clearTimeout(this.reconnectTimer); this.stream?.abort(); this.killChild(); }
}
