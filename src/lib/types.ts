export type Mode = "real" | "demo";
export type Status = "idle" | "queued" | "waiting" | "cancelled" | "running" | "approval" | "completed" | "failed" | "interrupted";
export interface Agent { id: string; name: string; role: string; color: string; instructions: string; archived?: boolean; libraryProfileId?: string }
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
}
export interface Approval {
  id: string; rpcId: string | number; taskId: string; agentId: string; method: string;
  action: string; reason: string; details: string; at: string; state: "pending" | "approved" | "denied" | "expired";
  missionId?: string; risks?: string;
  canApprove?: boolean;
  decisionSource?: "user" | "policy";
}
export interface Snapshot {
  agents: Agent[]; tasks: Task[]; events: Activity[]; approvals: Approval[];
  agentCatalog?: Agent[]; teams?: Team[]; activeTeamId?: string;
  connection: { status: "disconnected" | "connecting" | "connected" | "error"; version?: string; message: string; authenticated?: boolean };
  workspace: string; concurrency: number; queuePaused: boolean;
  missions?: Mission[]; communications?: Communication[]; models?: ModelOption[];
  aiConfigurations?: AIConfiguration[]; catalogError?: string; historicalAgents?: Agent[];
  capabilities?: { readOnlyCommandApprovals: boolean; experimentalApiApprovals?: boolean; resumeStructuredReports?: boolean; libraryProfiles?: boolean };
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
}
export interface Communication { id: string; missionId: string; from: string; to: string; at: string; kind: "handoff" | "system"; content: string; state: "pending" | "delivered"; sourceEventId: string; sourceTaskId: string; targetTaskId: string }
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
