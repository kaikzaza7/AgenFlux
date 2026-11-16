import type { Agent, Approval, CatalogModel, EngineId, EngineStatus, ProviderInfo, Task } from "../../src/lib/types.ts";

// Contrato comum a todos os motores de execução (OpenCode, Codex, Ollama e
// ferramentas locais). O Headquarters só conversa com esta interface; cada
// adaptador traduz para o protocolo oficial do seu provedor.

export interface StartContext {
  task: Task; agent: Agent; model?: CatalogModel; effort?: string;
  system: string;          // persona do agente + skills selecionadas
  prompt: string;          // objetivo da etapa + entregas das dependências
  readOnly: boolean;       // true = o motor deve impedir edições
  schema?: Record<string, unknown>; // contrato JSON esperado na resposta
  maxSteps?: number;
}
export interface ApprovalRequest {
  taskId: string; rpcId: string | number; method: string; kind: Approval["kind"];
  action: string; reason: string; details: string; risks?: string; canApprove?: boolean;
  automatic?: { reason: string };
}
export interface FinishMeta { limit?: boolean; auth?: boolean }
// O que um motor pode pedir ao Headquarters. Todo evento exibido no escritório
// nasce de uma destas chamadas, ou seja, de algo que realmente aconteceu.
export interface EngineHost {
  task(id: string): Task | undefined;
  activeTasks(engine: EngineId): Task[];
  event(taskId: string, kind: string, text: string): void;
  patch(taskId: string, patch: Partial<Task>): Task | undefined;
  finish(taskId: string, status: "completed" | "failed" | "interrupted", error?: string, meta?: FinishMeta): void;
  requestApproval(request: ApprovalRequest): void;
  expireApproval(engine: EngineId, rpcId: string | number): void;
  statusChanged(engine: EngineId): void;
  changed(): void;
}
export interface TestResult { ok: boolean; text: string; ms: number; cost?: number; tokens?: number }
export interface Engine {
  readonly id: EngineId;
  status(): EngineStatus;
  connect(): Promise<void>;
  disconnect(): void;
  models(): CatalogModel[];
  providers(): ProviderInfo[];
  start(context: StartContext): Promise<void>;
  interrupt(task: Task): Promise<void>;
  decide(approval: Approval, approve: boolean): Promise<void> | void;
  test?(model: CatalogModel): Promise<TestResult>;
  close(): void;
}

// Erros que indicam cota/limite gratuito esgotado. Usado para oferecer outro
// modelo gratuito em vez de simplesmente falhar.
export const isLimitError = (message: string) => /\b429\b|rate.?limit|quota|usage limit|FreeTierError|too many requests|limite de uso|insufficient.*(credit|balance)|exceeded/i.test(message);
export const isAuthError = (message: string) => /\b401\b|\b403\b|unauthorized|ProviderAuthError|invalid api key|api key|não autenticad/i.test(message);

// Modelos gratuitos frequentemente devolvem JSON dentro de cercas ou com texto ao
// redor. Em vez de bloquear a missão, extraímos o primeiro objeto JSON válido.
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* tenta as alternativas abaixo */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch { /* segue */ } }
  for (let start = trimmed.indexOf("{"); start >= 0; start = trimmed.indexOf("{", start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = quoted; continue; }
      if (char === '"') quoted = !quoted;
      if (quoted) continue;
      if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return undefined;
}
