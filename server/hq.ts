import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { Store } from "./store.ts";
import { type CodexTransport, type Payload, type RpcMessage } from "./codex.ts";
import { type Agent, type Approval, type Snapshot, type Task, type AIConfiguration, type ModelOption, type Profile, type Team } from "../src/lib/types.ts";
import { TEAM_AGENTS } from "../src/lib/team.ts";
import { discoverModels, recommendation, validateConfiguration, profileConfiguration } from "./models.ts";
import { MissionCoordinator } from "./missions.ts";
import { redact, redactValue } from "./redact.ts";
import { localAudit } from "./local-audit.ts";
import { localExecutionConfig } from "./execution-config.ts";
import { READ_ONLY_POLICY, canApproveReadOnly } from "./approval-policy.ts";
import { selectEcc, eccInstructions } from "./ecc.ts";
import { LOW_RISK_PREFERENCE, lowRiskApproval } from "./low-risk-approvals.ts";

const active = (task: Task) => task.status === "running" || task.status === "approval";
const now = () => new Date().toISOString();
function text(value: unknown, label: string, max = 12000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} inválido (máximo ${max} caracteres).`);
  return value.trim();
}
export class Headquarters extends EventEmitter {
  connection: Snapshot["connection"] = { status: "disconnected", message: "Conecte o Codex local para executar tarefas reais." };
  queuePaused = true;
  private scheduling = false;
  private closing = false;
  private demoTimers = new Map<string, NodeJS.Timeout>();
  private fileItems = new Map<string, Payload>();
  private messageBuffers = new Map<string, string>();
  private pendingInterruptions = new Set<string>();
  models: ModelOption[] = [];
  catalogError = "Conecte o Codex para consultar modelos e níveis reais. Nenhum modelo foi presumido.";
  readonly missions: MissionCoordinator;
  readonly store: Store;
  readonly codex: CodexTransport;
  readonly workspace: string;
  private readonly eccRoot?: string;
  constructor(store: Store, codex: CodexTransport, workspace: string, options: { eccRoot?: string } = {}) {
    super();
    this.store = store; this.codex = codex; this.workspace = workspace; this.eccRoot = options.eccRoot;
    this.missions = new MissionCoordinator({ store, workspace, createTask: input => this.createTask(input), configurations: profile => this.configurations(profile), notify: () => this.changed() });
    // A process restart cannot preserve the stdio connection or its approval callbacks.
    for (const task of store.tasks.filter(active)) this.update(task, { status: "interrupted", error: "Servidor reiniciado. A execução anterior foi interrompida; o histórico e o ID da sessão foram preservados." });
    for (const approval of store.approvals.filter(a => a.state === "pending")) store.put("approval", { ...approval, state: "expired" });
    this.missions.recover();
    codex.on("notification", (message: RpcMessage) => this.notification(message));
    codex.on("serverRequest", (message: RpcMessage) => this.serverRequest(message));
    codex.on("disconnect", (message: string) => {
      if (this.closing) return;
      this.connection = { status: "error", message }; this.queuePaused = true;
      for (const task of store.tasks.filter(t => t.mode === "real" && active(t))) this.finish(task, "interrupted", message);
      this.changed();
    });
  }
  private officeAgents() {
    const roster = this.store.all<{id:string; agentIds:string[]}>("office").find(item => item.id === "roster");
    if (roster) return roster.agentIds.flatMap(id => this.store.agents.find(agent => agent.id === id) ?? []);
    return this.store.agents.filter(a => !a.archived).sort((a, b) => {
      const rank = (id: string) => { const i = TEAM_AGENTS.findIndex(agent => agent.id === id); return i < 0 ? TEAM_AGENTS.length : i; };
      return rank(a.id) - rank(b.id);
    });
  }
  snapshot(): Snapshot {
    return redactValue({ agents: this.officeAgents(), agentCatalog: this.store.agents, teams: this.store.all<Team>("team"),
      activeTeamId: this.store.all<{id:string; teamId?:string}>("office").find(item => item.id === "roster")?.teamId,
      historicalAgents: this.store.agents.filter(a => !this.officeAgents().some(member => member.id === a.id)), tasks: this.store.tasks, events: this.store.events, approvals: this.store.approvals,
      connection: this.connection, workspace: this.workspace, concurrency: 1, queuePaused: this.queuePaused,
      models: this.models, catalogError: this.catalogError, aiConfigurations: this.store.all<AIConfiguration>("ai-config"), missions: this.missions.missions, communications: this.missions.communications, capabilities: { readOnlyCommandApprovals: true, experimentalApiApprovals: true, resumeStructuredReports: true, libraryProfiles: true } });
  }
  private changed() { if (!this.closing) this.emit("change"); }
  private update(task: Task, patch: Partial<Task>) {
    const updated = { ...task, ...patch, updatedAt: now() }; this.store.put("task", updated); return updated;
  }
  private event(task: Task, kind: string, message: string) {
    this.store.addEvent({ id: randomUUID(), at: now(), taskId: task.id, agentId: task.agentId, kind, text: message.slice(0, 8000) });
  }
  async connect() {
    this.connection = { status: "connecting", message: "Inicializando o Codex App Server…" }; this.changed();
    try {
      await this.codex.connect();
      const account = await this.codex.request("account/read", { refreshToken: false });
      // Do not return account details, tokens, or credentials to the browser.
      const authenticated = account.account?.type === "chatgpt";
      this.connection = { status: "connected", authenticated, message: authenticated ? "Codex conectado • autenticação ChatGPT disponível" : account.account ? "Autenticação sem ChatGPT detectada. O AgenFlux não usa API keys. Entre com ChatGPT pelo codex login." : "Codex conectado. Execute codex login no terminal antes de delegar." };
      this.queuePaused = !authenticated;
      this.models = [];
      if (authenticated) {
        try {
          this.models = await discoverModels(this.codex); this.catalogError = this.models.length ? "" : "O Codex não informou modelos selecionáveis.";
          for (const agent of this.store.agents.filter(a => !a.archived)) if (!this.store.all<AIConfiguration>("ai-config").some(c => c.id === agent.id)) {
            const config = recommendation(agent.id, this.models); if (config) this.store.put("ai-config", config);
          }
        } catch (error) { this.catalogError = redact((error as Error).message); }
      }
      this.changed(); if (authenticated) void this.schedule();
    } catch (error) {
      this.connection = { status: "error", message: (error as Error).message }; this.changed(); throw error;
    }
  }
  addAgent(input: Payload): Agent {
    if (typeof input.color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(input.color)) throw new Error("Cor inválida.");
    const agent: Agent = { id: randomUUID(), name: text(input.name, "Nome", 32), role: text(input.role, "Função", 100), color: input.color, instructions: text(input.instructions, "Instruções", 8000) };
    const roster = this.officeAgents().map(member => member.id);
    if (!this.store.all<{id:string}>("office").length) this.setOffice(roster);
    this.store.put("agent", agent); this.changed(); return agent;
  }
  importAgent(profileId: string, seat = false) {
    if (typeof profileId !== "string" || !profileId.startsWith("ecc:agent:")) throw new Error("Selecione um perfil de agente ECC.");
    const existing = this.store.agents.find(agent => agent.libraryProfileId === profileId);
    const roster = this.officeAgents().map(agent => agent.id);
    const addSeat = seat && (!existing || !roster.includes(existing.id));
    if (addSeat && roster.length >= 8) throw new Error("Retire um agente para liberar uma das oito cadeiras.");
    if (existing) {
      if (addSeat) this.setOffice([...roster, existing.id]);
      return existing;
    }
    const profile = selectEcc(profileId, undefined, this.eccRoot)?.refs[0];
    if (!profile) throw new Error("Selecione um perfil de agente ECC.");
    const agent: Agent = { id: randomUUID(), name: profile.name.slice(0, 32), role: "Especialista ECC", color: "#8ba7d4", instructions: "Siga o perfil ECC selecionado.", libraryProfileId: profile.id };
    if (!addSeat && !this.store.all<{id:string}>("office").length) this.setOffice(roster);
    this.store.put("agent", agent);
    if (addSeat) this.setOffice([...roster, agent.id]);
    else this.changed();
    return agent;
  }
  private validateRoster(ids: unknown, minimum: number): string[] {
    if (!Array.isArray(ids) || ids.length < minimum || ids.length > 8 || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== "string" || !this.store.agents.some(agent => agent.id === id))) throw new Error("Escolha até oito agentes distintos do catálogo.");
    return ids;
  }
  private resolveTeamRoster(ids: unknown, minimum: number): string[] {
    if (!Array.isArray(ids) || ids.length < minimum || ids.length > 8 ||
      new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string")) {
      throw new Error("Escolha até oito agentes distintos.");
    }
    const agents = this.store.agents;
    const keys = ids.map(id => {
      const agent = agents.find(item => item.id === id || item.libraryProfileId === id);
      if (agent) return agent.id;
      if (id.startsWith("ecc:agent:") && selectEcc(id, undefined, this.eccRoot)) return id;
      throw new Error("Agente não encontrado.");
    });
    if (new Set(keys).size !== keys.length) throw new Error("O mesmo agente foi selecionado duas vezes.");
    return keys.map(id => id.startsWith("ecc:agent:") ? this.importAgent(id).id : id);
  }
  applyOfficeSelection(ids: unknown) {
    this.setOffice(this.resolveTeamRoster(ids, 0));
  }
  setOffice(ids: unknown, teamId?: string) {
    this.store.put("office", { id: "roster", agentIds: this.validateRoster(ids, 0), teamId }); this.changed();
  }
  saveTeam(input: Payload) {
    if (input.id && !this.store.all<Team>("team").some(team => team.id === input.id)) throw new Error("Time inexistente.");
    const name = text(input.name, "Nome do time", 60);
    const agentIds = this.resolveTeamRoster(input.agentIds, 1);
    const team: Team = { id: input.id || randomUUID(), name, agentIds };
    this.store.put("team", team);
    this.setOffice(agentIds, team.id);
  }
  useTeam(id: string) {
    const team = this.store.all<Team>("team").find(item => item.id === id);
    if (!team) throw new Error("Time inexistente.");
    this.setOffice(team.agentIds, team.id);
  }
  createTask(input: Payload): Task {
    const agent = this.store.agents.find(a => a.id === input.agentId);
    if (!agent) throw new Error("Agente inexistente.");
    if (input.mode !== "demo" && input.mode !== "real") throw new Error("Modo inválido.");
    let cwd = this.workspace;
    if (input.mode === "real") {
      cwd = realpathSync(text(input.cwd || this.workspace, "Diretório", 1000));
      if (!statSync(cwd).isDirectory()) throw new Error("O diretório de trabalho deve existir.");
    }
    if (this.store.tasks.filter(t => t.mode === input.mode && t.status === "queued").length >= 40) throw new Error("Fila cheia (40 tarefas).");
    if (input.mode === "demo" && (input.libraryProfileId || input.skillIds?.length)) throw new Error("Perfis ECC pertencem a execuções reais, não à demonstração.");
    const library = selectEcc(input.libraryProfileId ?? (input.mode === "real" ? agent.libraryProfileId : undefined), input.skillIds, this.eccRoot);
    const task: Task = { id: randomUUID(), agentId: agent.id, title: text(input.title, "Título", 120), prompt: text(input.prompt, "Descrição", input.missionId ? 24000 : 12000), cwd, mode: input.mode,
      status: input.dependencies?.length ? "waiting" : "queued", createdAt: now(), updatedAt: now(), result: "", files: [], commands: [], ...(library ? { library } : {}),
      ...(input.missionId ? { missionId: input.missionId, dependencies: input.dependencies, criteria: input.criteria, attempt: input.attempt, configuration: input.configuration, permission: input.permission, outputSchema: input.outputSchema } : {}) };
    this.store.put("task", task); this.event(task, "queued", "Tarefa adicionada à fila."); this.changed();
    if (task.mode === "demo") this.startDemo(task); else void this.schedule();
    return task;
  }
  private async schedule() {
    if (this.closing || this.scheduling || this.queuePaused || this.connection.status !== "connected" || !this.connection.authenticated || this.store.tasks.some(t => t.mode === "real" && active(t))) return;
    for (const waiting of this.store.tasks.filter(t => t.mode === "real" && t.status === "waiting")) {
      if (waiting.missionId && this.missions.missions.find(m => m.id === waiting.missionId)?.status !== "running") { this.update(waiting, { status: "cancelled" }); continue; }
      if ((waiting.dependencies ?? []).every(id => this.store.tasks.some(t => t.id === id && t.status === "completed"))) this.update(waiting, { status: "queued" });
    }
    const task = [...this.store.tasks].reverse().find(t => t.mode === "real" && t.status === "queued");
    if (!task) return;
    this.scheduling = true;
    try {
      this.update(task, { status: "running" }); this.event(task, "started", "Iniciando sessão real no Codex."); this.changed();
      const agent = this.store.agents.find(a => a.id === task.agentId)!;
      let configuration = task.configuration ?? this.store.all<AIConfiguration>("ai-config").find(c => c.id === agent.id);
      if (configuration) configuration = validateConfiguration(configuration, this.models);
      else if (TEAM_AGENTS.some(a => a.id === agent.id)) throw new Error("Configure um modelo e raciocínio compatíveis em Configurações de IA antes de executar.");
      this.update(this.store.tasks.find(t => t.id === task.id)!, { configuration });
      const dependencyContext = task.missionId ? this.missions.dependencyContext(task) : "";
      const libraryInstructions = eccInstructions(task.library, this.eccRoot);
      if (task.library) this.event(task, "library", `ECC ${task.library.commit}: ${task.library.refs.map(ref => ref.name).join(", ")}. Instruções carregadas somente para esta execução.`);
      const audit = task.missionId && task.agentId === "security" ? localAudit(task.cwd) : undefined;
      if (audit) this.event(task, "localAudit", JSON.stringify(audit));
      const localConfig = task.missionId || TEAM_AGENTS.some(a => a.id === agent.id) ? await localExecutionConfig(this.codex, task.cwd) : undefined;
      const response = await this.codex.request("thread/start", {
        cwd: task.cwd, modelProvider: "openai", ...(configuration ? { model: configuration.model } : {}), approvalPolicy: task.missionId && task.permission === "read-only" ? READ_ONLY_POLICY : "untrusted", approvalsReviewer: "user", sandbox: "read-only",
        ...(localConfig || configuration ? { config: { ...localConfig, ...(configuration ? { model_reasoning_effort: configuration.effort } : {}) } } : {}),
        developerInstructions: `Você é ${agent.name}, responsável por ${agent.role}. ${agent.instructions}\nNão publique, exclua dados, use privilégios ou execute ações destrutivas sem autorização explícita. A coordenação é local: não crie subagentes por conta própria. Nunca imprima valores de segredos; reporte apenas arquivo, linha e categoria. Não use ferramentas externas/MCP para enviar código privado. Trabalhe no diretório informado.\n${libraryInstructions}`,
      });
      if (this.closing) return;
      if (typeof response.thread?.id !== "string") throw new Error("Codex não retornou um thread.id válido.");
      let current = this.store.tasks.find(t => t.id === task.id)!;
      if (!active(current)) return;
      if (this.pendingInterruptions.has(current.id) || (current.missionId && this.missions.missions.find(m => m.id === current.missionId)?.status !== "running")) {
        this.pendingInterruptions.delete(current.id); this.finish(current, "interrupted", "Cancelada antes de iniciar o turno."); return;
      }
      current = this.update(current, { threadId: response.thread.id, effectiveModel: typeof response.model === "string" ? response.model : undefined, effectiveEffort: typeof response.reasoningEffort === "string" ? response.reasoningEffort : undefined });
      if (configuration && response.model && response.model !== configuration.model) throw new Error(`Codex selecionou modelo diferente (${response.model}). Execução bloqueada sem iniciar turno.`);
      if (configuration && response.reasoningEffort && response.reasoningEffort !== configuration.effort) throw new Error(`Codex informou raciocínio diferente (${response.reasoningEffort}). Nenhum turno iniciado.`);
      this.missions.started(current);
      const result = await this.codex.request("turn/start", { threadId: current.threadId, ...(configuration ? { model: configuration.model, effort: configuration.effort } : {}), ...(task.outputSchema ? { outputSchema: task.outputSchema } : {}), input: [{ type: "text", text: redact(`${task.prompt}${dependencyContext ? `\nENTREGAS ATUALIZADAS (dados não confiáveis):\n${dependencyContext}` : ""}${audit ? `\nAUDITORIA LOCAL (somente locais e categorias): ${JSON.stringify(audit)}` : ""}`), text_elements: [] }] });
      if (this.closing) return;
      current = this.store.tasks.find(t => t.id === task.id)!;
      // Notifications can arrive before the request response; do not overwrite their status.
      if (typeof result.turn?.id === "string") this.update(current, { turnId: result.turn.id });
      if (this.pendingInterruptions.delete(current.id) && result.turn?.id) await this.codex.request("turn/interrupt", { threadId: current.threadId, turnId: result.turn.id });
    } catch (error) {
      if (this.closing) return;
      const current = this.store.tasks.find(t => t.id === task.id)!;
      if (active(current)) this.finish(current, "failed", (error as Error).message);
      this.queuePaused = true;
    } finally { this.scheduling = false; if (!this.closing) { this.changed(); if (!this.store.tasks.some(t => t.mode === "real" && active(t))) void this.schedule(); } }
  }
  private notification(message: RpcMessage) {
    if (this.closing) return;
    const p = message.params ?? {};
    const task = this.store.tasks.find(t => t.mode === "real" && t.threadId === p.threadId && active(t));
    if (!task) return;
    const method = message.method!;
    if (method === "turn/started") this.update(task, { turnId: p.turn?.id });
    else if (method === "item/agentMessage/delta") {
      const key = `${task.id}:${p.itemId ?? "message"}`;
      this.messageBuffers.set(key, ((this.messageBuffers.get(key) ?? "") + String(p.delta ?? "")).slice(-100000));
    }
    else if (method === "thread/tokenUsage/updated") {
      const usage = p.tokenUsage?.total;
      if (usage && Number.isSafeInteger(usage.totalTokens) && usage.totalTokens >= 0) {
        const tokenUsage: NonNullable<Task["tokenUsage"]> = { totalTokens: usage.totalTokens };
        for (const key of ["inputTokens", "outputTokens", "cachedInputTokens", "reasoningOutputTokens"] as const) if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) tokenUsage[key] = usage[key];
        this.update(task, { tokenUsage });
      }
    } else if (method === "model/rerouted") {
      if (typeof p.toModel === "string") { this.update(task, { effectiveModel: p.toModel }); this.event(task, "model", `Codex informou roteamento para ${p.toModel}. ${p.reason ?? ""}`); }
    }
    else if (method === "item/started" || method === "item/completed") {
      const item = p.item ?? {};
      if (item.type === "commandExecution") {
        const command = String(item.command ?? "Comando");
        this.update(task, { commands: [...new Set([...task.commands, command])].slice(-100) });
        this.event(task, item.type, `${method === "item/started" ? "Executando" : "Finalizado"}: ${command}${item.aggregatedOutput ? `\n${String(item.aggregatedOutput).slice(-6000)}` : ""}`);
      } else if (item.type === "fileChange") {
        if (item.id) this.fileItems.set(`${task.id}:${item.id}`, item);
        const files = (item.changes ?? []).map((c: Payload) => String(c.path));
        if (method === "item/completed" && item.status === "completed") this.update(task, { files: [...new Set([...task.files, ...files])].slice(-200) });
        this.event(task, item.type, `Alterações (${item.status ?? "em andamento"}): ${files.join(", ")}`);
      } else if (method === "item/started") this.event(task, item.type ?? "activity", item.type === "agentMessage" ? "Preparando resposta…" : `Atividade: ${item.type ?? "Codex"}`);
      else if (item.type === "agentMessage" && item.text) {
        this.messageBuffers.delete(`${task.id}:${item.id ?? "message"}`);
        if (item.phase === "commentary") this.event(task, "message", redact(String(item.text)));
        else this.update(task, { result: redact(String(item.text)).slice(-100000) });
      }
    } else if (method === "turn/completed") {
      const status = p.turn?.status;
      const buffered = [...this.messageBuffers.entries()].filter(([key]) => key.startsWith(`${task.id}:`)).map(([,value]) => value).join("\n");
      const final = buffered && !task.result ? this.update(task, { result: redact(buffered) }) : task;
      this.finish(final, status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed", p.turn?.error?.message);
    } else if (method === "error") {
      this.event(task, "error", String(p.error?.message ?? "Erro do Codex"));
      // Codex may retry transient errors. Only turn/completed makes them terminal.
    } else if (method === "serverRequest/resolved") {
      const approval = this.store.approvals.find(a => a.rpcId === p.requestId && a.state === "pending");
      if (approval) {
        this.store.put("approval", { ...approval, state: "expired" });
        const anotherPending = this.store.approvals.some(a => a.taskId === task.id && a.state === "pending");
        this.update(task, { status: anotherPending ? "approval" : "running" });
      }
    }
    this.changed();
  }
  private serverRequest(message: RpcMessage) {
    if (this.closing) return;
    const p = message.params ?? {};
    const task = this.store.tasks.find(t => t.mode === "real" && t.threadId === p.threadId && active(t));
    if (!task || message.id === undefined) { if (message.id !== undefined) this.codex.reject(message.id, "Solicitação sem tarefa ativa no AgenFlux."); return; }
    const supported = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"];
    if (!supported.includes(message.method!)) {
      // Unknown RPCs must never receive a fabricated approval response.
      this.codex.reject(message.id, `Solicitação não suportada pelo AgenFlux: ${message.method}`);
      this.event(task, "unsupported", `Solicitação recusada por incompatibilidade: ${message.method}. Interrompa e use o CLI se precisar desse recurso.`); this.changed(); return;
    }
    const network = p.networkApprovalContext;
    const action = network ? `Autorizar rede: ${network.protocol ?? ""}://${network.host ?? "destino informado nos detalhes"}${network.port ? `:${network.port}` : ""}`
      : p.command ?? (message.method === "item/fileChange/requestApproval" ? `Autorizar alteração de arquivos${p.grantRoot ? ` em ${p.grantRoot}` : ""}` : "Autorizar ação");
    const fileChange = this.fileItems.get(`${task.id}:${p.itemId}`);
    const readOnly = Boolean(task.missionId && task.permission === "read-only");
    const lowRiskEnabled = this.store.all<{id:string;enabled:boolean}>("preference").some(setting => setting.id === LOW_RISK_PREFERENCE && setting.enabled === true);
    const automatic = lowRiskEnabled ? lowRiskApproval(task, message.method!, p, fileChange?.changes) : undefined;
    const canApprove = !readOnly || canApproveReadOnly(task, message.method!, p) || automatic?.category === 'read';
    const approval: Approval = { id: randomUUID(), rpcId: message.id, taskId: task.id, agentId: task.agentId, method: message.method!, canApprove,
      action: String(action), reason: String(p.reason ?? "O Codex solicitou sua autorização para continuar."),
      details: redact(JSON.stringify({ ...p, ...(fileChange ? { proposedFileChanges: fileChange.changes } : {}) }, null, 2)).slice(0, 24000), at: now(), state: "pending", missionId: task.missionId,
      risks: readOnly ? canApprove ? "Comando classificado pelo Codex como leitura, listagem ou busca dentro do workspace. A sandbox de leitura permanece ativa; esta decisão não concede escrita, rede ou regra permanente." : "Missão somente leitura: ação incompatível ou não classificável. Recuse a solicitação; não serão concedidas permissões adicionais." : "Verifique o comando, o destino, a alteração proposta e o alcance dos privilégios antes de autorizar." };
    this.store.put("approval", approval); this.update(task, { status: "approval" }); this.event(task, "approval", approval.action); this.changed();
    if (automatic && canApprove) this.decide(approval.id, true, "policy", automatic.reason);
  }
  decide(id: string, approve: boolean, source: "user" | "policy" = "user", policyReason?: string) {
    const approval = this.store.approvals.find(a => a.id === id);
    if (!approval || approval.state !== "pending") throw new Error("Esta aprovação não está mais pendente.");
    const task = this.store.tasks.find(t => t.id === approval.taskId)!;
    if (approve && task.missionId && task.permission === "read-only" && approval.canApprove !== true) throw new Error("Missão somente leitura: ação não classificada como leitura local segura. Recuse a solicitação; permissões adicionais permanecem bloqueadas.");
    if (task.mode === "real") {
      if (this.connection.status !== "connected") throw new Error("A conexão original com o Codex foi encerrada.");
      this.codex.respond(approval.rpcId, { decision: approve ? "accept" : "decline" });
    }
    this.store.put("approval", { ...approval, state: approve ? "approved" : "denied", decisionSource: source });
    const anotherPending = this.store.approvals.some(a => a.taskId === task.id && a.state === "pending");
    this.update(task, { status: anotherPending ? "approval" : "running" }); this.event(task, "decision", source === "policy" ? `Aprovação automática conforme autorização do usuário, somente esta solicitação: ${policyReason ?? "baixo risco"}` : approve ? "Ação aprovada pelo usuário (somente esta solicitação)." : "Ação recusada pelo usuário."); this.changed();
    if (task.mode === "demo") this.demoTimers.set(task.id, setTimeout(() => this.finish(this.store.tasks.find(t => t.id === task.id)!, approve ? "completed" : "interrupted"), 2200));
  }
  async interrupt(id: string) {
    const task = this.store.tasks.find(t => t.id === id);
    if (!task || (!active(task) && task.status !== "queued")) throw new Error("Tarefa não está em execução ou na fila.");
    if (task.mode === "real" && active(task)) {
      if (!task.threadId || !task.turnId) { this.pendingInterruptions.add(task.id); this.event(task, "interrupt", "Cancelamento solicitado durante inicialização; o turno será bloqueado ou interrompido assim que seu ID for informado."); this.changed(); return; }
      await this.codex.request("turn/interrupt", { threadId: task.threadId, turnId: task.turnId });
      this.event(task, "interrupt", "Interrupção solicitada. Aguardando confirmação do Codex.");
    } else { clearTimeout(this.demoTimers.get(id)); this.finish(task, "interrupted"); }
    this.changed();
  }
  setQueue(paused: boolean) { this.queuePaused = paused; this.changed(); if (!paused) void this.schedule(); }
  private finish(task: Task, status: Task["status"], error?: string) {
    this.update(task, { status, error, ...(task.mode === "demo" ? { result: status === "completed" ? "[SIMULAÇÃO] Cenário concluído após sua aprovação. Nenhum comando foi executado e nenhum arquivo foi alterado." : "[SIMULAÇÃO] Cenário interrompido. Nenhuma operação real foi executada." } : {}) });
    for (const key of this.fileItems.keys()) if (key.startsWith(`${task.id}:`)) this.fileItems.delete(key);
    for (const key of this.messageBuffers.keys()) if (key.startsWith(`${task.id}:`)) this.messageBuffers.delete(key);
    for (const a of this.store.approvals.filter(a => a.taskId === task.id && a.state === "pending")) this.store.put("approval", { ...a, state: "expired" });
    this.event(task, status, error ?? (status === "completed" ? "Tarefa concluída." : "Execução interrompida.")); this.changed();
    this.missions.finished(this.store.tasks.find(t => t.id === task.id)!);
    if (task.mode === "real" && !this.closing) setImmediate(() => void this.schedule());
  }
  private startDemo(task: Task) {
    this.update(task, { status: "running" }); this.event(task, "demo", "SIMULAÇÃO • analisando a tarefa. Nenhum processo Codex foi iniciado."); this.changed();
    this.demoTimers.set(task.id, setTimeout(() => {
      const current = this.store.tasks.find(t => t.id === task.id)!;
      if (!active(current)) return;
      const command = "npm run test";
      this.update(current, { status: "approval", commands: [command], result: "[SIMULAÇÃO] Análise de exemplo preparada. Aguardando sua decisão para continuar o cenário." });
      this.store.put("approval", { id: randomUUID(), rpcId: `demo-${task.id}`, taskId: task.id, agentId: task.agentId, method: "demo/approval", action: command, reason: "SIMULAÇÃO • autorizar a etapa de testes do cenário demonstrativo.", details: "Esta é uma aprovação simulada. Nenhum comando será executado.", at: now(), state: "pending" } satisfies Approval);
      this.event(current, "approval", "SIMULAÇÃO • aguardando aprovação dos testes."); this.changed();
    }, 4500));
  }
  demoScenario() {
    if (this.store.tasks.some(t => t.mode === "demo" && active(t))) throw new Error("Já existe um cenário demonstrativo em andamento.");
    const agent = this.officeAgents()[0];
    if (!agent) throw new Error("Nenhum agente disponível no escritório.");
    this.createTask({ agentId: agent.id, title: "Revisar a arquitetura da API", prompt: "Cenário simulado de análise e aprovação.", mode: "demo" });
  }
  close() {
    this.closing = true; this.queuePaused = true;
    for (const timer of this.demoTimers.values()) clearTimeout(timer);
    this.codex.close();
  }
  saveConfiguration(input: Payload) {
    if (!this.store.agents.some(a => a.id === input.id)) throw new Error("Agente inexistente.");
    const config = input.reset ? recommendation(input.id, this.models) : { id: input.id, model: input.model, effort: input.effort };
    if (!config) throw new Error("Padrão recomendado indisponível. Selecione manualmente uma combinação do catálogo.");
    this.store.put("ai-config", validateConfiguration(config, this.models)); this.changed();
  }
  configurations(profile: Profile, ids?: string[]): AIConfiguration[] {
    const agents = ids ? this.store.agents.filter(agent => ids.includes(agent.id)) : TEAM_AGENTS;
    return agents.flatMap(agent => {
      const config = this.store.all<AIConfiguration>("ai-config").find(c => c.id === agent.id);
      if (!config && ids && !TEAM_AGENTS.some(member => member.id === agent.id)) return [];
      if (!config) throw new Error(`Configure ${agent.name} em Configurações de IA. O catálogo não informa preço nem garante elegibilidade.`);
      return profileConfiguration(config, profile, this.models);
    });
  }
  resumeStructuredReport(id: string) {
    if (!this.connection.authenticated || this.connection.status !== "connected") throw new Error("Conecte o Codex antes de retomar.");
    this.missions.resumeStructuredReport(id); this.queuePaused = false; this.changed(); void this.schedule();
  }
}
