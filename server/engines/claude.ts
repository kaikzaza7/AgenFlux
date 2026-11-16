import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import type { Approval, CatalogModel, EngineStatus, ProviderInfo, Task } from "../../src/lib/types.ts";
import { redact } from "../redact.ts";
import { isAuthError, isLimitError, type Engine, type EngineHost, type StartContext, type TestResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Adaptador do Claude, via Claude Code CLI em modo não interativo:
//   claude -p --output-format stream-json --verbose --model <modelo> --tools Read,Glob,Grep
// (opções conferidas em `claude --help`, versão 2.1.x). O prompt entra pela entrada
// padrão e cada linha da saída é um evento JSON real (início, uso de ferramenta,
// resultado final com tokens e custo estimado).
//
// SOMENTE LEITURA: o modo não interativo não tem como pedir a sua aprovação a cada
// edição, então o AgenFlux entrega ao Claude apenas as ferramentas Read, Glob e
// Grep. Ele analisa, orienta a equipe, revisa e redige — é o papel de Orquestrador.
// Edições de arquivos continuam com os agentes do OpenCode, que pedem aprovação.
//
// CUSTO: usa o login do Claude Code (assinatura). Não é gratuito: fica bloqueado
// enquanto "Somente modelos gratuitos" estiver ligado sem "Permitir assinatura já
// contratada". A variável ANTHROPIC_API_KEY é removida do processo filho para que
// nunca haja cobrança por token de API sem você saber.
// ---------------------------------------------------------------------------

const MODELS = [
  { id: "sonnet", name: "Claude Sonnet (mais recente)", tier: "medium" as const },
  { id: "opus", name: "Claude Opus (mais recente)", tier: "heavy" as const },
  { id: "haiku", name: "Claude Haiku (mais recente)", tier: "light" as const },
  { id: "fable", name: "Claude Fable (mais recente)", tier: "heavy" as const },
];
const READ_TOOLS = "Read,Glob,Grep";

export function claudeCommand(): { file: string; args: string[] } {
  const explicit = process.env.CLAUDE_BIN;
  if (explicit) {
    if (!existsSync(explicit) || /\.(cmd|bat|ps1)$/i.test(explicit)) throw new Error("CLAUDE_BIN deve apontar para claude(.exe) ou para o cli.js do Claude Code; arquivos .cmd/.ps1 não são executados via shell.");
    return /\.[cm]?js$/.test(explicit) ? { file: process.execPath, args: [explicit] } : { file: explicit, args: [] };
  }
  const win = process.platform === "win32";
  const dirs = [...(process.env.PATH ?? "").split(delimiter).filter(Boolean), join(homedir(), ".local", "bin"), join(homedir(), ".claude", "local")];
  for (const dir of dirs) {
    const binary = join(dir, win ? "claude.exe" : "claude"); if (existsSync(binary)) return { file: binary, args: [] };
    const script = join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"); if (existsSync(script)) return { file: process.execPath, args: [script] };
  }
  throw new Error("Claude Code não encontrado. Instale-o (npm install -g @anthropic-ai/claude-code), faça login com `claude` e reconecte; ou defina CLAUDE_BIN.");
}

interface Run { child: ChildProcess; aborted: boolean; error?: string }

export class ClaudeEngine implements Engine {
  readonly id = "claude" as const;
  private host: EngineHost;
  private state: EngineStatus = { id: "claude", name: "Claude (Claude Code)", status: "disconnected", message: "Opcional: usa a sua assinatura Claude. Ideal como Orquestrador (somente leitura)." };
  private list: CatalogModel[] = [];
  private runs = new Map<string, Run>();
  private resolve: typeof claudeCommand;
  constructor(host: EngineHost, resolve: typeof claudeCommand = claudeCommand) { this.host = host; this.resolve = resolve; }
  status() { return { ...this.state, models: this.list.length, freeModels: 0 }; }
  models() { return this.list; }
  providers(): ProviderInfo[] { return [{ id: "anthropic", engine: "claude", name: "Anthropic via Claude Code", connected: this.state.status === "connected", env: [], authMethods: [{ type: "oauth", label: "login do Claude Code (comando `claude`)" }], models: this.list.length, freeModels: 0, note: "Consome os limites da assinatura Claude. Somente leitura dentro do AgenFlux." }]; }
  private set(patch: Partial<EngineStatus>) { this.state = { ...this.state, ...patch }; this.host.statusChanged("claude"); }
  private env() { const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; return env; }

  async connect() {
    this.set({ status: "connecting", message: "Procurando o Claude Code…" });
    try {
      const command = this.resolve();
      const version = await new Promise<string>((done, fail) => {
        const child = spawn(command.file, [...command.args, "--version"], { windowsHide: true, env: this.env() }); let out = "";
        const timer = setTimeout(() => { child.kill(); fail(new Error("O Claude Code não respondeu.")); }, 20000);
        child.stdout.on("data", chunk => { out += chunk; }); child.on("error", error => { clearTimeout(timer); fail(error); });
        child.on("exit", code => { clearTimeout(timer); if (code === 0) done(out.trim().split("\n")[0]); else fail(new Error(`claude --version encerrou com código ${code}.`)); });
      });
      this.list = MODELS.map(m => ({ key: `claude:anthropic/${m.id}`, engine: "claude" as const, providerId: "anthropic", providerName: "Anthropic via Claude Code", modelId: m.id, name: m.name, cost: "subscription" as const,
        costNote: "Incluído na assinatura Claude, com os limites de uso do seu plano. Não é gratuito. A disponibilidade de cada modelo depende do plano: use Testar.", toolCall: false, readTools: true, reasoning: true, efforts: ["low", "medium", "high"], connected: true, status: "active", tier: m.tier, chat: true }));
      this.set({ status: "connected", version, message: `Claude Code ${version} encontrado. Use "Testar" em um modelo para confirmar o login. Dentro do AgenFlux o Claude atua somente em leitura.` });
    } catch (error) { this.list = []; this.set({ status: "error", message: redact((error as Error).message) }); throw error; }
  }

  private spawnRun(cwd: string, model: CatalogModel, system: string, prompt: string, effort?: string) {
    const command = this.resolve();
    const args = [...command.args, "-p", "--output-format", "stream-json", "--verbose", "--model", model.modelId, "--tools", READ_TOOLS, "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", ...(effort ? ["--effort", effort] : []), ...(system ? ["--append-system-prompt", system] : [])];
    const child = spawn(command.file, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: this.env() });
    child.stdin!.on("error", () => undefined); child.stdin!.end(prompt);
    return child;
  }

  async start(context: StartContext) {
    const { task, model } = context;
    if (!model) throw new Error("Etapa sem modelo definido.");
    if (!context.readOnly) throw new Error("O Claude atua somente em leitura dentro do AgenFlux. Deixe as etapas de edição com um modelo do OpenCode.");
    const child = this.spawnRun(task.cwd, model, context.system, context.prompt, context.effort && model.efforts.includes(context.effort) ? context.effort : undefined);
    const run: Run = { child, aborted: false }; this.runs.set(task.id, run);
    let steps = 0, finished = false, stderr = "", lastText = "";
    const finish = (status: "completed" | "failed" | "interrupted", error?: string) => {
      if (finished) return; finished = true; this.runs.delete(task.id);
      this.host.patch(task.id, { tool: undefined });
      this.host.finish(task.id, status, error, error ? { limit: isLimitError(error), auth: isAuthError(error) || /login|logged/i.test(error) } : undefined);
    };
    const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    lines.on("line", line => {
      let message: any; try { message = JSON.parse(line); } catch { return; }
      if (message.type === "system" && message.subtype === "init") {
        this.host.patch(task.id, { sessionId: message.session_id, effectiveModel: String(message.model ?? model.modelId) });
        this.host.event(task.id, "session", `Sessão do Claude iniciada com ${message.model ?? model.modelId}. Ferramentas disponíveis: ${(message.tools ?? []).join(", ") || "nenhuma"} (somente leitura).`);
      } else if (message.type === "assistant") {
        steps++; this.host.patch(task.id, { steps });
        for (const block of message.message?.content ?? []) {
          if (block.type === "tool_use") {
            const target = block.input?.file_path ?? block.input?.pattern ?? block.input?.path ?? "";
            this.host.patch(task.id, { tool: String(block.name) }); this.host.event(task.id, "tool", `Usando ferramenta ${block.name}${target ? `: ${String(target).slice(0, 300)}` : ""}`);
          } else if (block.type === "text" && block.text) lastText = String(block.text);
        }
        if (context.maxSteps && steps > context.maxSteps && !run.aborted) { run.error = `Limite de ${context.maxSteps} etapas do agente atingido.`; child.kill(); }
        this.host.changed();
      } else if (message.type === "result") {
        const usage = message.usage ?? {};
        const input = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0), output = Number(usage.output_tokens ?? 0);
        const text = String(message.result ?? lastText ?? "");
        // total_cost_usd é uma estimativa equivalente de API; na assinatura não há cobrança por token.
        this.host.patch(task.id, { result: redact(text).slice(-100000), cost: Number(message.total_cost_usd ?? 0), tokenUsage: { totalTokens: input + output, inputTokens: input, outputTokens: output } });
        if (message.is_error || message.subtype !== "success") finish("failed", redact(text || `Claude encerrou com ${message.subtype}.`));
        else finish(text.trim() ? "completed" : "failed", text.trim() ? undefined : "O Claude não produziu resposta.");
      }
    });
    child.stderr!.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
    child.on("error", error => finish("failed", redact(error.message)));
    child.on("exit", code => {
      lines.close();
      setTimeout(() => {
        if (run.aborted) finish("interrupted", "Execução interrompida a pedido do usuário.");
        else if (run.error) finish("failed", run.error);
        else finish("failed", redact(`O Claude Code encerrou sem resultado (código ${code}). ${stderr.slice(-600)}`));
      }, 150);
    });
  }
  async interrupt(task: Task) {
    const run = this.runs.get(task.id);
    if (!run) { this.host.finish(task.id, "interrupted", "Execução interrompida."); return; }
    run.aborted = true; run.child.kill();
    this.host.event(task.id, "interrupt", "Processo do Claude encerrado.");
  }
  decide(_approval: Approval, _approve: boolean) { throw new Error("O Claude atua somente em leitura e não solicita aprovações."); }
  async test(model: CatalogModel): Promise<TestResult> {
    const started = Date.now();
    const child = this.spawnRun(process.cwd(), model, "", "Responda somente com a palavra OK.");
    return new Promise((done, fail) => {
      let out = "", err = ""; const timer = setTimeout(() => { child.kill(); fail(new Error("Tempo esgotado no teste do Claude.")); }, 120000);
      child.stdout!.on("data", chunk => { out += chunk; }); child.stderr!.on("data", chunk => { err += chunk; });
      child.on("error", error => { clearTimeout(timer); fail(error); });
      child.on("exit", () => {
        clearTimeout(timer);
        const result = out.split("\n").flatMap(line => { try { const m = JSON.parse(line); return m.type === "result" ? [m] : []; } catch { return []; } }).at(-1);
        if (!result) return fail(new Error(redact(`O Claude Code não devolveu resultado. Faça login executando \`claude\` no terminal. ${err.slice(-300)}`)));
        if (result.is_error) return fail(new Error(redact(String(result.result ?? "Falha informada pelo Claude."))));
        done({ ok: true, text: redact(String(result.result ?? "")).slice(0, 300), ms: Date.now() - started, cost: Number(result.total_cost_usd ?? 0), tokens: Number(result.usage?.output_tokens ?? 0) + Number(result.usage?.input_tokens ?? 0) });
      });
    });
  }
  disconnect() { for (const run of this.runs.values()) { run.aborted = true; run.child.kill(); } this.list = []; this.set({ status: "disconnected", message: "Claude desconectado.", version: undefined }); }
  close() { for (const run of this.runs.values()) { run.aborted = true; run.child.kill(); } }
}
