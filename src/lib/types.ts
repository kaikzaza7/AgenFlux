export type Mode = "real" | "demo";
export type Status = "idle" | "queued" | "waiting" | "cancelled" | "running" | "approval" | "completed" | "failed" | "interrupted";
export type EngineId = "codex" | "opencode" | "ollama" | "claude" | "local";
// Classificação de custo exibida na aba "Modelos e Provedores".
// "subscription" = incluído em uma assinatura já paga (ex.: ChatGPT via Codex): não é gratuito.
export type CostClass = "free" | "free-limited" | "free-temporary" | "local" | "paid" | "subscription" | "unavailable";
export type ModelTier = "light" | "medium" | "heavy";
export interface Agent { id: string; name: string; role: string; color: string; instructions: string; archived?: boolean; libraryProfileId?: string; sprite?: number }
export interface Team { id: string; name: string; agentIds: string[] }
export interface Activity { id: string; at: string; taskId: string; agentId: string; kind: string; text: string }
export interface Task {
  id: string; agentId: string; title: string; prompt: string; cwd: string; mode: Mode;
  status: Status; createdAt: string; updatedAt: string; threadId?: string; turnId?: string;
  result: string; files: string[]; commands: string[]; error?: string;
  missionId?: string; dependencies?: string[]; criteria?: string[]; attempt?: number;
  retryOf?: string;
  configuration?: AIConfiguration; effectiveModel?: string; effectiveEffort?: string;
  permission?: "read-only" | "workspace-write"; outputSchema?: Record<string, unknown>;
  library?: { commit: string; profileId?: string; refs: { id: string; name: string; sha256: string }[] };
  tokenUsage?: { totalTokens: number; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningOutputTokens?: number };
  // AgenFlux 3: motor que executa a etapa e como o modelo foi escolhido (rastreável).
  engine?: EngineId; stage?: string; sessionId?: string; routing?: Routing; skills?: SkillRef[];
  cost?: number; steps?: number; tool?: string; retries?: number; forcedModelKey?: string; commandPolicy?: "read" | "ask"; excludedModels?: string[]; weight?: ModelTier;
}
export interface Routing { modelKey: string; modelName: string; providerName: string; engine: EngineId; cost: CostClass; tier: ModelTier; effort?: string; reason: string; fallbackKey?: string }
export interface SkillRef { id: string; name: string; source: string; score?: number; matched?: string[]; sha256?: string }
export interface Approval {
  id: string; rpcId: string | number; taskId: string; agentId: string; method: string;
  action: string; reason: string; details: string; at: string; state: "pending" | "approved" | "denied" | "expired";
  missionId?: string; risks?: string;
  canApprove?: boolean;
  decisionSource?: "user" | "policy";
  engine?: EngineId; kind?: "command" | "edit" | "network" | "other";
}
export interface Snapshot {
  agents: Agent[]; tasks: Task[]; events: Activity[]; approvals: Approval[];
  agentCatalog?: Agent[]; teams?: Team[]; activeTeamId?: string;
  connection: { status: "disconnected" | "connecting" | "connected" | "error"; version?: string; message: string; authenticated?: boolean };
  workspace: string; concurrency: number; queuePaused: boolean;
  missions?: Mission[]; communications?: Communication[]; models?: ModelOption[];
  aiConfigurations?: AIConfiguration[]; catalogError?: string; historicalAgents?: Agent[];
  capabilities?: { readOnlyCommandApprovals: boolean; experimentalApiApprovals?: boolean; resumeStructuredReports?: boolean; libraryProfiles?: boolean };
  // AgenFlux 3
  settings?: Settings; agentSettings?: AgentSettings[]; engines?: EngineStatus[]; catalogVersion?: number;
  automations?: Automation[]; skillsVersion?: number; skillUsage?: SkillUsage[]; version?: string;
}
export interface EngineStatus { id: EngineId; name: string; status: "disconnected" | "connecting" | "connected" | "error"; message: string; version?: string; managed?: boolean; url?: string; models?: number; freeModels?: number }
export interface Settings {
  id: "settings"; freeOnly: boolean; allowSubscription: boolean; profile: Profile; concurrency: number;
  defaultModelKey?: string; officeSpeed: number; officeDwell: number; lowRiskApprovals: boolean;
}
export const DEFAULT_SETTINGS: Settings = { id: "settings", freeOnly: true, allowSubscription: false, profile: "economic", concurrency: 2, officeSpeed: 4, officeDwell: 4, lowRiskApprovals: false };
export interface AgentSettings { id: string; modelKey?: string; fallbackKey?: string; effort?: string; maxSteps?: number; maxAttempts?: number; concurrency?: number; skills?: string[]; tools?: "read-only" | "workspace-write" }
export interface CatalogModel {
  key: string; engine: EngineId; providerId: string; providerName: string; modelId: string; name: string;
  cost: CostClass; costNote?: string; toolCall: boolean; reasoning: boolean; efforts: string[];
  context?: number; connected: boolean; status?: string; tier: ModelTier; chat: boolean; blocked?: string; readTools?: boolean;
}
export interface ProviderInfo { id: string; engine: EngineId; name: string; connected: boolean; env: string[]; authMethods: { type: string; label: string }[]; models: number; freeModels: number; note?: string }
export interface Catalog { version: number; providers: ProviderInfo[]; models: CatalogModel[] }
export interface SkillInfo { id: string; name: string; description: string; source: string; origin: string; path?: string; enabled: boolean; keywords: string[]; compatibility?: string; license?: string; bytes: number; sha256: string; agents: string[] }
export interface SkillUsage { id: string; skillId: string; skillName: string; missionId?: string; taskId: string; agentId: string; at: string; score?: number; matched?: string[] }
export interface PlanStage { key: string; agentId: string; goal: string; dependsOn: string[]; engine: "llm" | "local"; write: boolean; weight: ModelTier; skills: SkillRef[]; routing?: Routing; routingError?: string; criteria: string[]; reason: string; forcedModelKey?: string }
export interface MissionPlan { intents: { id: string; label: string; matched: string[] }[]; complexity: "low" | "medium" | "high"; needsWrite: boolean; stages: PlanStage[]; warnings: string[]; summary: string; llmCalls: number; localSteps: number }
export interface Automation {
  id: string; name: string; objective: string; cwd: string; profile: Profile; allowWrite: boolean; teamId?: string; enabled: boolean;
  schedule: { type: "once"; at: string } | { type: "daily"; time: string; days: number[] } | { type: "interval"; minutes: number };
  createdAt: string; nextRunAt?: string; lastRunAt?: string; lastMissionId?: string; lastError?: string; runs: number; catchUp?: boolean;
}
export const STATUS_LABEL: Record<Status, string> = {
  idle: "Disponível", queued: "Na fila", running: "Executando", approval: "Aguardando aprovação",
  completed: "Concluído", failed: "Erro", interrupted: "Interrompido",
  waiting: "Aguardando dependência", cancelled: "Cancelado",
};
export type Profile = "economic" | "balanced" | "quality";
export interface ModelOption { id: string; model: string; displayName: string; description: string; efforts: string[]; defaultEffort: string; isDefault: boolean }
export interface AIConfiguration { id: string; model: string; effort: string }
export interface Mission {
  id: string; objective: string; cwd: string; profile: Profile; allowWrite: boolean; maxAttempts: number;
  status: "running" | "completed" | "blocked" | "cancelled"; createdAt: string; updatedAt: string;
  taskIds: string[]; report?: string; blockers: string[]; cycle: number;
  configurations: AIConfiguration[];
  team?: Team;
  plan?: MissionPlan; automationId?: string; freeOnly?: boolean; stageTasks?: Record<string, string>;
}
export interface Communication { id: string; missionId: string; from: string; to: string; at: string; kind: "handoff" | "system"; content: string; state: "pending" | "delivered"; sourceEventId: string; sourceTaskId: string; targetTaskId: string; stage?: string }
export const INITIAL_AGENTS: Agent[] = [
  { id: "backend", name: "Backend", role: "Programação e APIs", color: "#a3a0ff", instructions: "Especialista em backend, APIs e arquitetura. Prefira mudanças simples, seguras e bem verificadas." },
  { id: "frontend", name: "Frontend", role: "Interfaces e componentes", color: "#65cbb8", instructions: "Especialista em interfaces acessíveis, componentes e experiência do usuário." },
  { id: "tester", name: "Testador", role: "Testes e qualidade", color: "#e8b779", instructions: "Investigue erros e execute testes relevantes. Relate evidências e limitações." },
  { id: "researcher", name: "Pesquisador", role: "Análise e documentação", color: "#7fb4ef", instructions: "Pesquise documentação técnica e apresente conclusões com fontes verificáveis." },
];
export function latestTask(tasks: Task[], agentId: string) {
  return tasks.find(t => t.agentId === agentId && ["running", "approval"].includes(t.status))
    ?? tasks.find(t => t.agentId === agentId && ["queued", "waiting"].includes(t.status))
    ?? tasks.find(t => t.agentId === agentId);
}
