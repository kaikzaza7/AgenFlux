import type { Approval, CatalogModel, EngineStatus, ProviderInfo, Task } from "../../src/lib/types.ts";
import { modelTier } from "../catalog.ts";
import { redact } from "../redact.ts";
import type { Engine, EngineHost, StartContext, TestResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Adaptador direto do Ollama (modelos locais), via API HTTP oficial:
//   GET  /api/version   versão
//   GET  /api/tags      modelos instalados
//   POST /api/chat      conversa com streaming (NDJSON)
//
// Este caminho NÃO oferece ferramentas ao modelo: ele recebe o contexto montado
// localmente pelo AgenFlux (inventário e trechos) e devolve texto. Serve para
// análises, planos, resumos e documentação sem nenhum custo. Para que um modelo do
// Ollama edite arquivos ou execute comandos, adicione o Ollama como provedor dentro
// do OpenCode (o guia em Modelos e Provedores mostra como).
// ---------------------------------------------------------------------------

export class OllamaEngine implements Engine {
  readonly id = "ollama" as const;
  private host: EngineHost;
  private base: string;
  private state: EngineStatus = { id: "ollama", name: "Ollama (local)", status: "disconnected", message: "Opcional: modelos locais, sem internet e sem custo." };
  private list: CatalogModel[] = [];
  private running = new Map<string, AbortController>();
  constructor(host: EngineHost, base = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434") {
    this.host = host;
    this.base = (/^https?:\/\//.test(base) ? base : `http://${base}`).replace(/\/+$/, "");
  }
  status() { return { ...this.state, models: this.list.length, freeModels: this.list.length }; }
  models() { return this.list; }
  providers(): ProviderInfo[] {
    return [{ id: "ollama", engine: "ollama", name: "Ollama (local)", connected: this.state.status === "connected", env: ["OLLAMA_HOST"], authMethods: [], models: this.list.length, freeModels: this.list.length, note: "Sem ferramentas neste modo: ideal para análise, planejamento e documentação." }];
  }
  private set(patch: Partial<EngineStatus>) { this.state = { ...this.state, ...patch }; this.host.statusChanged("ollama"); }

  async connect() {
    this.set({ status: "connecting", message: "Procurando o Ollama local…" });
    try {
      const host = new URL(this.base).hostname;
      if (!["127.0.0.1", "localhost", "[::1]"].includes(host) && process.env.AGENFLUX_ALLOW_REMOTE_OLLAMA !== "1") throw new Error("OLLAMA_HOST deve apontar para este computador.");
      const version = await (await fetch(`${this.base}/api/version`, { signal: AbortSignal.timeout(4000) })).json() as { version?: string };
      const tags = await (await fetch(`${this.base}/api/tags`, { signal: AbortSignal.timeout(8000) })).json() as { models?: { name: string; details?: { parameter_size?: string; family?: string } }[] };
      this.list = (tags.models ?? []).filter(model => !/embed/i.test(model.name)).map(model => ({
        key: `ollama:ollama/${model.name}`, engine: "ollama" as const, providerId: "ollama", providerName: "Ollama (local)", modelId: model.name,
        name: `${model.name}${model.details?.parameter_size ? ` · ${model.details.parameter_size}` : ""}`, cost: "local" as const,
        costNote: "Executa no seu computador; sem cobrança. O desempenho depende da sua máquina.", toolCall: false, reasoning: false, efforts: [], connected: true, status: "active",
        tier: modelTier(`${model.name} ${model.details?.parameter_size ?? ""}`), chat: true,
      }));
      this.set({ status: "connected", version: version.version, url: this.base, message: this.list.length ? `Ollama ${version.version ?? ""} conectado • ${this.list.length} modelo(s) local(is).` : `Ollama ${version.version ?? ""} conectado, mas sem modelos. Execute: ollama pull qwen2.5-coder:7b` });
    } catch (error) {
      this.list = [];
      const message = (error as Error).message;
      this.set({ status: "error", message: /fetch failed|ECONNREFUSED|timeout|aborted/i.test(message) ? "Ollama não está em execução em 127.0.0.1:11434. Instale-o e abra o aplicativo, ou ignore: ele é opcional." : redact(message) });
      throw new Error(this.state.message);
    }
  }

  private async chat(model: string, messages: { role: string; content: string }[], signal: AbortSignal, onDelta?: (text: string) => void) {
    const response = await fetch(`${this.base}/api/chat`, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, stream: true }) });
    if (!response.ok || !response.body) throw new Error(`Ollama respondeu ${response.status}: ${redact((await response.text()).slice(0, 300))}`);
    const decoder = new TextDecoder(); let buffer = "", text = "", input = 0, output = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.error) throw new Error(String(data.error));
        if (data.message?.content) { text += data.message.content; onDelta?.(text); }
        if (data.done) { input = Number(data.prompt_eval_count ?? 0); output = Number(data.eval_count ?? 0); }
      }
    }
    return { text, input, output };
  }

  async start(context: StartContext) {
    const { task, model } = context;
    if (!model) throw new Error("Etapa sem modelo definido.");
    const controller = new AbortController(); this.running.set(task.id, controller);
    this.host.patch(task.id, { effectiveModel: `ollama/${model.modelId}` });
    this.host.event(task.id, "session", `Conversa local iniciada no Ollama com ${model.modelId}. Sem ferramentas: o modelo trabalha sobre o contexto enviado.`);
    // Executa em segundo plano: start() só confirma que a etapa começou.
    void (async () => {
      let last = 0;
      try {
        const reply = await this.chat(model.modelId, [{ role: "system", content: context.system }, { role: "user", content: context.prompt }], controller.signal, text => {
          if (Date.now() - last > 4000) { last = Date.now(); this.host.event(task.id, "progress", `Gerando resposta… ${text.length} caracteres.`); this.host.changed(); }
        });
        this.host.patch(task.id, { result: redact(reply.text).slice(-100000), cost: 0, tokenUsage: { totalTokens: reply.input + reply.output, inputTokens: reply.input, outputTokens: reply.output } });
        this.host.finish(task.id, reply.text.trim() ? "completed" : "failed", reply.text.trim() ? undefined : "O modelo local não produziu resposta.");
      } catch (error) {
        if (controller.signal.aborted) this.host.finish(task.id, "interrupted", "Execução interrompida a pedido do usuário.");
        else this.host.finish(task.id, "failed", redact((error as Error).message));
      } finally { this.running.delete(task.id); }
    })();
  }
  async interrupt(task: Task) {
    const controller = this.running.get(task.id);
    if (controller) controller.abort(); else this.host.finish(task.id, "interrupted", "Execução interrompida.");
  }
  decide(_approval: Approval, _approve: boolean) { throw new Error("O modo local do Ollama não solicita aprovações."); }
  async test(model: CatalogModel): Promise<TestResult> {
    const started = Date.now();
    const reply = await this.chat(model.modelId, [{ role: "user", content: "Responda somente com a palavra OK." }], AbortSignal.timeout(120000));
    return { ok: Boolean(reply.text.trim()), text: redact(reply.text).slice(0, 300), ms: Date.now() - started, cost: 0, tokens: reply.input + reply.output };
  }
  disconnect() { for (const controller of this.running.values()) controller.abort(); this.list = []; this.set({ status: "disconnected", message: "Ollama desconectado.", version: undefined }); }
  close() { for (const controller of this.running.values()) controller.abort(); }
}
