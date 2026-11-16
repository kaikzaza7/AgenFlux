import type { Approval, CatalogModel, EngineStatus, ProviderInfo, Task } from "../../src/lib/types.ts";
import type { CodexTransport, Payload, RpcMessage } from "../codex.ts";
import { discoverModels } from "../models.ts";
import { modelTier } from "../catalog.ts";
import { localExecutionConfig } from "../execution-config.ts";
import { READ_ONLY_POLICY, canApproveReadOnly } from "../approval-policy.ts";
import { lowRiskApproval } from "../low-risk-approvals.ts";
import { redact } from "../redact.ts";
import { isLimitError, type Engine, type EngineHost, type StartContext } from "./types.ts";

// ---------------------------------------------------------------------------
// Adaptador do Codex (opcional). É o mesmo fluxo do AgenFlux 2 — App Server via
// stdio, com threads, turnos e aprovações — agora atrás da interface Engine.
// Usa a sua sessão ChatGPT: por isso os modelos são classificados como
// "Pago (assinatura)" e ficam bloqueados enquanto "Somente modelos gratuitos"
// estiver ativa sem a permissão explícita de usar a assinatura.
// ---------------------------------------------------------------------------

export class CodexEngine implements Engine {
  readonly id = "codex" as const;
  private host: EngineHost;
  private codex: CodexTransport;
  private state: EngineStatus = { id: "codex", name: "Codex (ChatGPT)", status: "disconnected", message: "Opcional: usa a sua assinatura ChatGPT pelo Codex CLI." };
  private list: CatalogModel[] = [];
  private authenticated = false;
  private closing = false;
  private fileItems = new Map<string, Payload>();
  private messageBuffers = new Map<string, string>();
  private pendingInterruptions = new Set<string>();
  constructor(host: EngineHost, codex: CodexTransport) {
    this.host = host; this.codex = codex;
    codex.on("notification", (message: RpcMessage) => this.notification(message));
    codex.on("serverRequest", (message: RpcMessage) => this.serverRequest(message));
    codex.on("disconnect", (message: string) => {
      if (this.closing) return;
      this.list = []; this.authenticated = false;
      for (const task of this.host.activeTasks("codex")) this.host.finish(task.id, "interrupted", message);
      this.set({ status: this.state.status === "disconnected" ? "disconnected" : "error", message: redact(message) });
    });
  }
  status() { return { ...this.state, models: this.list.length, freeModels: 0 }; }
  get isAuthenticated() { return this.authenticated; }
  models() { return this.list; }
  providers(): ProviderInfo[] {
    return [{ id: "openai", engine: "codex", name: "OpenAI via Codex (ChatGPT)", connected: this.authenticated, env: [], authMethods: [{ type: "oauth", label: "codex login (ChatGPT)" }], models: this.list.length, freeModels: 0, note: "Consome os limites da assinatura ChatGPT. Não é gratuito e não concede créditos de API." }];
  }
  private set(patch: Partial<EngineStatus>) { this.state = { ...this.state, ...patch }; this.host.statusChanged("codex"); }

  async connect() {
    this.set({ status: "connecting", message: "Inicializando o Codex App Server…" });
    try {
      await this.codex.connect();
      const account = await this.codex.request("account/read", { refreshToken: false });
      // Detalhes da conta, tokens e credenciais nunca saem do backend.
      this.authenticated = account.account?.type === "chatgpt";
      this.list = [];
      let catalogError = "";
      if (this.authenticated) {
        try {
          this.list = (await discoverModels(this.codex)).map(model => ({
            key: `codex:openai/${model.model}`, engine: "codex" as const, providerId: "openai", providerName: "OpenAI via Codex", modelId: model.model, name: model.displayName,
            cost: "subscription" as const, costNote: "Incluído na assinatura ChatGPT, com limites de uso do plano. Não é gratuito.", toolCall: true, reasoning: model.efforts.length > 0,
            efforts: model.efforts, connected: true, status: "active", tier: modelTier(model.model, model.displayName), chat: true,
          }));
        } catch (error) { catalogError = redact((error as Error).message); }
      }
      this.set({ status: "connected", message: catalogError ? `Codex conectado, mas o catálogo falhou: ${catalogError}` : this.authenticated ? `Codex conectado • autenticação ChatGPT disponível • ${this.list.length} modelo(s).` : account.account ? "Autenticação sem ChatGPT detectada. O AgenFlux não usa API keys do Codex. Entre com: codex login" : "Codex conectado. Execute `codex login` no terminal antes de delegar." });
    } catch (error) {
      this.set({ status: "error", message: redact((error as Error).message) });
      throw error;
    }
  }

  async start(context: StartContext) {
    const { task, model } = context;
    if (!model) throw new Error("Etapa sem modelo definido.");
    if (!this.authenticated) throw new Error("Codex não autenticado. Execute `codex login` e reconecte.");
    const effort = context.effort && model.efforts.includes(context.effort) ? context.effort : undefined;
    const localConfig = await localExecutionConfig(this.codex, task.cwd);
    const response = await this.codex.request("thread/start", {
      cwd: task.cwd, modelProvider: "openai", model: model.modelId, approvalPolicy: task.missionId && context.readOnly ? READ_ONLY_POLICY : "untrusted", approvalsReviewer: "user", sandbox: "read-only",
      config: { ...localConfig, ...(effort ? { model_reasoning_effort: effort } : {}) }, developerInstructions: context.system,
    });
    if (this.closing) return;
    if (typeof response.thread?.id !== "string") throw new Error("Codex não retornou um thread.id válido.");
    if (!this.host.task(task.id)) return;
    if (this.pendingInterruptions.delete(task.id)) { this.host.finish(task.id, "interrupted", "Cancelada antes de iniciar o turno."); return; }
    this.host.patch(task.id, { threadId: response.thread.id, effectiveModel: typeof response.model === "string" ? response.model : undefined, effectiveEffort: typeof response.reasoningEffort === "string" ? response.reasoningEffort : undefined });
    if (response.model && response.model !== model.modelId) throw new Error(`Codex selecionou modelo diferente (${response.model}). Execução bloqueada sem iniciar turno.`);
    if (effort && response.reasoningEffort && response.reasoningEffort !== effort) throw new Error(`Codex informou raciocínio diferente (${response.reasoningEffort}). Nenhum turno iniciado.`);
    const result = await this.codex.request("turn/start", { threadId: response.thread.id, model: model.modelId, ...(effort ? { effort } : {}), ...(context.schema ? { outputSchema: context.schema } : {}), input: [{ type: "text", text: context.prompt, text_elements: [] }] });
    if (this.closing) return;
    // Notificações podem chegar antes da resposta; não sobrescrevemos o status delas.
    if (typeof result.turn?.id === "string") this.host.patch(task.id, { turnId: result.turn.id });
    if (this.pendingInterruptions.delete(task.id) && result.turn?.id) await this.codex.request("turn/interrupt", { threadId: response.thread.id, turnId: result.turn.id });
  }

  private find(threadId: unknown) { return this.host.activeTasks("codex").find(t => t.threadId === threadId); }

  private notification(message: RpcMessage) {
    if (this.closing) return;
    const p = message.params ?? {};
    const task = this.find(p.threadId);
    if (!task) return;
    const method = message.method!;
    if (method === "turn/started") this.host.patch(task.id, { turnId: p.turn?.id });
    else if (method === "item/agentMessage/delta") {
      const key = `${task.id}:${p.itemId ?? "message"}`;
      this.messageBuffers.set(key, ((this.messageBuffers.get(key) ?? "") + String(p.delta ?? "")).slice(-100000));
      return; // deltas não geram snapshot: evita uma atualização por token
    } else if (method === "thread/tokenUsage/updated") {
      const usage = p.tokenUsage?.total;
      if (usage && Number.isSafeInteger(usage.totalTokens) && usage.totalTokens >= 0) {
        const tokenUsage: NonNullable<Task["tokenUsage"]> = { totalTokens: usage.totalTokens };
        for (const key of ["inputTokens", "outputTokens", "cachedInputTokens", "reasoningOutputTokens"] as const) if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) tokenUsage[key] = usage[key];
        this.host.patch(task.id, { tokenUsage });
      }
    } else if (method === "model/rerouted") {
      if (typeof p.toModel === "string") { this.host.patch(task.id, { effectiveModel: p.toModel }); this.host.event(task.id, "model", `Codex informou roteamento para ${p.toModel}. ${p.reason ?? ""}`); }
    } else if (method === "item/started" || method === "item/completed") {
      const item = p.item ?? {};
      if (item.type === "commandExecution") {
        const command = String(item.command ?? "Comando");
        this.host.patch(task.id, { commands: [...new Set([...task.commands, command])].slice(-100), tool: method === "item/started" ? "bash" : undefined });
        this.host.event(task.id, item.type, `${method === "item/started" ? "Executando" : "Finalizado"}: ${command}${item.aggregatedOutput ? `\n${String(item.aggregatedOutput).slice(-6000)}` : ""}`);
      } else if (item.type === "fileChange") {
        if (item.id) this.fileItems.set(`${task.id}:${item.id}`, item);
        const files = (item.changes ?? []).map((c: Payload) => String(c.path));
        if (method === "item/completed" && item.status === "completed") this.host.patch(task.id, { files: [...new Set([...task.files, ...files])].slice(-200) });
        this.host.event(task.id, item.type, `Alterações (${item.status ?? "em andamento"}): ${files.join(", ")}`);
      } else if (method === "item/started") this.host.event(task.id, item.type ?? "activity", item.type === "agentMessage" ? "Preparando resposta…" : `Atividade: ${item.type ?? "Codex"}`);
      else if (item.type === "agentMessage" && item.text) {
        this.messageBuffers.delete(`${task.id}:${item.id ?? "message"}`);
        if (item.phase === "commentary") this.host.event(task.id, "message", redact(String(item.text)));
        else this.host.patch(task.id, { result: redact(String(item.text)).slice(-100000) });
      }
    } else if (method === "turn/completed") {
      const status = p.turn?.status;
      const buffered = [...this.messageBuffers.entries()].filter(([key]) => key.startsWith(`${task.id}:`)).map(([, value]) => value).join("\n");
      if (buffered && !this.host.task(task.id)?.result) this.host.patch(task.id, { result: redact(buffered) });
      this.cleanup(task.id);
      const error = p.turn?.error?.message as string | undefined;
      this.host.finish(task.id, status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed", error, { limit: isLimitError(error ?? "") });
      return;
    } else if (method === "error") {
      // O Codex pode repetir erros transitórios; só turn/completed é terminal.
      this.host.event(task.id, "error", String(p.error?.message ?? "Erro do Codex"));
    } else if (method === "serverRequest/resolved") this.host.expireApproval("codex", p.requestId);
    this.host.changed();
  }

  private serverRequest(message: RpcMessage) {
    if (this.closing) return;
    const p = message.params ?? {};
    const task = this.find(p.threadId);
    if (!task || message.id === undefined) { if (message.id !== undefined) this.codex.reject(message.id, "Solicitação sem tarefa ativa no AgenFlux."); return; }
    const supported = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"];
    if (!supported.includes(message.method!)) {
      // RPCs desconhecidos nunca recebem uma aprovação fabricada.
      this.codex.reject(message.id, `Solicitação não suportada pelo AgenFlux: ${message.method}`);
      this.host.event(task.id, "unsupported", `Solicitação recusada por incompatibilidade: ${message.method}. Interrompa e use o CLI se precisar desse recurso.`); this.host.changed(); return;
    }
    const network = p.networkApprovalContext;
    const fileRequest = message.method === "item/fileChange/requestApproval";
    const action = network ? `Autorizar rede: ${network.protocol ?? ""}://${network.host ?? "destino informado nos detalhes"}${network.port ? `:${network.port}` : ""}`
      : p.command ?? (fileRequest ? `Autorizar alteração de arquivos${p.grantRoot ? ` em ${p.grantRoot}` : ""}` : "Autorizar ação");
    const fileChange = this.fileItems.get(`${task.id}:${p.itemId}`);
    const readOnly = Boolean(task.missionId && task.permission === "read-only");
    const automatic = lowRiskApproval(task, message.method!, p, fileChange?.changes);
    const canApprove = !readOnly || canApproveReadOnly(task, message.method!, p) || automatic?.category === "read";
    this.host.requestApproval({
      taskId: task.id, rpcId: message.id, method: message.method!, kind: network ? "network" : fileRequest ? "edit" : "command", canApprove,
      action: String(action), reason: String(p.reason ?? "O Codex solicitou sua autorização para continuar."),
      details: redact(JSON.stringify({ ...p, ...(fileChange ? { proposedFileChanges: fileChange.changes } : {}) }, null, 2)).slice(0, 24000),
      risks: readOnly ? canApprove ? "Comando classificado pelo Codex como leitura, listagem ou busca dentro do workspace. A sandbox de leitura permanece ativa; esta decisão não concede escrita, rede ou regra permanente." : "Missão somente leitura: ação incompatível ou não classificável. Recuse a solicitação; não serão concedidas permissões adicionais." : "Verifique o comando, o destino, a alteração proposta e o alcance dos privilégios antes de autorizar.",
      ...(automatic ? { automatic: { reason: automatic.reason } } : {}),
    });
  }

  decide(approval: Approval, approve: boolean) {
    if (this.state.status !== "connected") throw new Error("A conexão original com o Codex foi encerrada.");
    this.codex.respond(approval.rpcId, { decision: approve ? "accept" : "decline" });
  }
  async interrupt(task: Task) {
    if (!task.threadId || !task.turnId) {
      this.pendingInterruptions.add(task.id);
      this.host.event(task.id, "interrupt", "Cancelamento solicitado durante a inicialização; o turno será interrompido assim que seu ID for informado."); return;
    }
    await this.codex.request("turn/interrupt", { threadId: task.threadId, turnId: task.turnId });
    this.host.event(task.id, "interrupt", "Interrupção solicitada. Aguardando confirmação do Codex.");
  }
  private cleanup(taskId: string) {
    for (const key of this.fileItems.keys()) if (key.startsWith(`${taskId}:`)) this.fileItems.delete(key);
    for (const key of this.messageBuffers.keys()) if (key.startsWith(`${taskId}:`)) this.messageBuffers.delete(key);
  }
  disconnect() { this.list = []; this.authenticated = false; this.state = { ...this.state, status: "disconnected", message: "Codex desconectado.", version: undefined }; this.codex.close(); this.host.statusChanged("codex"); }
  close() { this.closing = true; this.codex.close(); }
}
