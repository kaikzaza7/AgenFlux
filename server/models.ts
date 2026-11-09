import type { CodexTransport, Payload } from "./codex.ts";
import type { AIConfiguration, ModelOption, Profile } from "../src/lib/types.ts";
import { RECOMMENDED_EFFORT } from "../src/lib/team.ts";
export async function discoverModels(codex: CodexTransport): Promise<ModelOption[]> {
  const models: ModelOption[] = []; let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await codex.request("model/list", { limit: 100, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.data)) throw new Error("model/list não retornou um catálogo válido.");
    for (const m of page.data as Payload[]) {
      if (m.hidden || typeof m.model !== "string") continue;
      const efforts = Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts.map((e: Payload) => e.reasoningEffort).filter((e: unknown) => typeof e === "string") : [];
      models.push({ id: String(m.id), model: m.model, displayName: String(m.displayName ?? m.model), description: String(m.description ?? ""), efforts, defaultEffort: String(m.defaultReasoningEffort ?? ""), isDefault: m.isDefault === true });
    }
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
    if (cursor && seen.has(cursor)) throw new Error("Paginação de modelos repetida.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return models.filter((m, i) => models.findIndex(other => other.model === m.model) === i);
}
export function validateConfiguration(config: AIConfiguration, models: ModelOption[]): AIConfiguration {
  const model = models.find(m => m.model === config.model);
  if (!model) throw new Error("Modelo indisponível no catálogo atual. Selecione uma opção retornada pelo Codex; nenhuma troca foi aplicada.");
  if (!model.efforts.includes(config.effort)) throw new Error(`Raciocínio incompatível. Opções para ${model.model}: ${model.efforts.join(", ") || "nenhuma informada"}. Nenhuma troca foi aplicada.`);
  return { id: config.id, model: config.model, effort: config.effort };
}
export function recommendation(agentId: string, models: ModelOption[]): AIConfiguration | undefined {
  const target = "gpt-5.6-luna";
  // Explicit user-selected policy: never silently substitute an unavailable model.
  const model = models.find(m => m.model === target);
  const effort = agentId === "reporter" ? "low" : "medium";
  return model?.efforts.includes(effort) ? { id: agentId, model: model.model, effort } : undefined;
}
export function profileConfiguration(config: AIConfiguration, profile: Profile, models: ModelOption[]) {
  validateConfiguration(config, models);
  const model = models.find(m => m.model === config.model)!;
  // Profiles never guess model price/capability or silently replace a model.
  const candidates = profile === "economic" ? ["low", "medium"] : profile === "quality" ? ["xhigh", "high"] : [config.effort];
  const effort = candidates.find(e => model.efforts.includes(e)) ?? config.effort;
  return { ...config, effort };
}
