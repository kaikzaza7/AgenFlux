import type { AgentSettings, CatalogModel, CostClass, ModelTier, Profile, Routing, Settings } from "../src/lib/types.ts";

// ---------------------------------------------------------------------------
// Catálogo de modelos e política de custo.
//
// Nada aqui "presume" que um modelo é gratuito por causa do nome: a classificação
// parte do preço informado pelo próprio provedor (OpenCode expõe `cost.input` e
// `cost.output` de cada modelo). Os sufixos ("-free", ":free") só refinam a
// categoria de algo que JÁ tem preço zero.
// ---------------------------------------------------------------------------

export const COST_LABEL: Record<CostClass, string> = {
  free: "Gratuito", "free-limited": "Gratuito com limite", "free-temporary": "Gratuito temporariamente",
  local: "Local", paid: "Pago", subscription: "Pago (assinatura)", unavailable: "Indisponível",
};

// Provedores cujo preço zero no catálogo significa "incluído em um plano pago".
const SUBSCRIPTION_PROVIDERS = /^(github-copilot|opencode-go|.*-coding-plan.*|.*-token-plan.*|.*-step-plan|kimi-code-plan.*|cline-pass)$/;
const LOCAL_PROVIDERS = /^(ollama|lmstudio|llama\.cpp|llamacpp|atomic-chat)$/;

export function classifyCost(input: { providerId: string; modelId: string; name: string; costIn: number; costOut: number; baseUrl?: string; connected: boolean; status?: string }): { cost: CostClass; note?: string } {
  if (input.status === "deprecated") return { cost: "unavailable", note: "Modelo marcado como descontinuado pelo provedor." };
  if (!input.connected) return { cost: "unavailable", note: "Provedor não conectado." };
  const local = LOCAL_PROVIDERS.test(input.providerId) || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(input.baseUrl ?? "");
  if (local) return { cost: "local", note: "Executa no seu computador; sem cobrança por token." };
  if (input.costIn > 0 || input.costOut > 0) return { cost: "paid", note: `US$ ${input.costIn}/${input.costOut} por milhão de tokens (entrada/saída).` };
  if (SUBSCRIPTION_PROVIDERS.test(input.providerId)) return { cost: "subscription", note: "Preço zero por token porque faz parte de um plano pago." };
  if (input.providerId === "opencode") return { cost: "free-temporary", note: "Modelo gratuito do OpenCode Zen: oferta por tempo limitado, só funciona dentro do OpenCode e os dados podem ser usados pelo fornecedor. Não envie informações confidenciais." };
  if (input.providerId === "openrouter") return /:free$/.test(input.modelId) || input.modelId === "openrouter/free"
    ? { cost: "free-limited", note: "Variante gratuita do OpenRouter: limite diário de requisições por conta." }
    : { cost: "paid", note: "Roteador do OpenRouter: o preço depende do modelo escolhido." };
  if (input.providerId === "nvidia") return { cost: "free-limited", note: "NVIDIA build (NIM): uso de avaliação com limite de requisições; exige chave gratuita." };
  if (["google", "groq", "cerebras", "github-models", "mistral", "huggingface", "cloudflare-workers-ai"].includes(input.providerId)) return { cost: "free-limited", note: "Camada gratuita do provedor com cota diária; exige chave gratuita." };
  return { cost: "free-limited", note: "Preço zero informado pelo provedor; confirme limites na página dele." };
}

// Heurística de porte do modelo. Serve só para ordenar candidatos; o usuário pode
// fixar qualquer modelo por agente e ignorar esta estimativa.
export function modelTier(id: string, name = ""): ModelTier {
  const text = `${id} ${name}`.toLowerCase();
  if (/(ultra|opus|\bpro\b|\bmax\b|large|super|\b[2-9]\d\db\b|\b1[2-9]\db\b|heavy|sonnet|gpt-5(?!.*(mini|nano))|codex(?!.*mini))/.test(text) && !/(mini|nano|flash|lite|small|lightning)/.test(text)) return "heavy";
  if (/(nano|mini|flash|lightning|small|lite|haiku|tiny|\bxs\b|\b[1-9]b\b|\b1\db\b|\b2[0-4]b\b|:1b|:3b|:7b|:8b|instant)/.test(text)) return "light";
  return "medium";
}

export const freeLike = (cost: CostClass) => cost === "free" || cost === "free-limited" || cost === "free-temporary" || cost === "local";

// A política "Somente modelos gratuitos": devolve o motivo do bloqueio ou undefined.
export function policyBlock(model: CatalogModel, settings: Settings): string | undefined {
  if (model.cost === "unavailable" || !model.connected) return `${model.name} está indisponível (${model.costNote ?? "provedor desconectado"}).`;
  if (!settings.freeOnly || freeLike(model.cost)) return;
  if (model.cost === "subscription" && settings.allowSubscription) return;
  return model.cost === "subscription"
    ? `${model.name} consome uma assinatura paga. A política "Somente modelos gratuitos" está ativa; habilite "Permitir assinatura já contratada" para usá-lo.`
    : `${model.name} é cobrado por token. A política "Somente modelos gratuitos" está ativa; nenhuma chamada paga será feita.`;
}

const COST_RANK: Record<CostClass, number> = { free: 0, "free-temporary": 1, "free-limited": 2, local: 3, subscription: 4, paid: 5, unavailable: 9 };
const TIER_VALUE: Record<ModelTier, number> = { light: 0, medium: 1, heavy: 2 };

export interface RoutingRequest { agentId: string; weight: ModelTier; needsTools: boolean; profile: Profile; forcedKey?: string; exclude?: string[] }

// Escolhe o modelo de uma etapa. Ordem: modelo forçado → modelo do agente →
// alternativo do agente → seleção automática conforme perfil e política.
// Lança erro descritivo quando nada compatível existe — nunca cai para um pago.
export function routeModel(request: RoutingRequest, models: CatalogModel[], settings: Settings, agent?: AgentSettings): Routing {
  const usable = (model: CatalogModel) => model.chat && model.connected && !policyBlock(model, settings) && (!request.needsTools || model.toolCall) && !(request.exclude ?? []).includes(model.key);
  const result = (model: CatalogModel, reason: string): Routing => {
    const wanted = agent?.effort;
    const effort = wanted && model.efforts.includes(wanted) ? wanted : pickEffort(model, request.profile, request.weight);
    const fallback = agent?.fallbackKey && agent.fallbackKey !== model.key && models.some(m => m.key === agent.fallbackKey && usable(m)) ? agent.fallbackKey : undefined;
    return { modelKey: model.key, modelName: model.name, providerName: model.providerName, engine: model.engine, cost: model.cost, tier: model.tier, reason, ...(effort ? { effort } : {}), ...(fallback ? { fallbackKey: fallback } : {}) };
  };
  const explain = (key: string, label: string) => {
    const model = models.find(m => m.key === key);
    if (!model) return `${label} (${key}) não está no catálogo atual`;
    return policyBlock(model, settings) ?? (!model.toolCall && request.needsTools ? `${model.name} não usa ferramentas, exigidas por esta etapa` : `${model.name} foi excluído desta tentativa`);
  };
  const notes: string[] = [];
  for (const [key, label] of [[request.forcedKey, "Modelo escolhido manualmente"], [agent?.modelKey, "Modelo do agente"], [agent?.fallbackKey, "Modelo alternativo do agente"]] as const) {
    if (!key) continue;
    const model = models.find(m => m.key === key);
    if (model && usable(model)) return result(model, `${label}${notes.length ? ` (após: ${notes.join("; ")})` : ""}.`);
    notes.push(explain(key, label));
  }
  const candidates = models.filter(usable);
  if (!candidates.length) {
    const why = settings.freeOnly ? "Nenhum modelo gratuito compatível está conectado" : "Nenhum modelo compatível está conectado";
    throw new Error(`${why}${request.needsTools ? " (a etapa exige uso de ferramentas)" : ""}. ${notes.join("; ")}${notes.length ? ". " : ""}Abra "Modelos e Provedores" para conectar um provedor gratuito ou escolher outro modelo. Nenhuma chamada paga foi feita.`);
  }
  // Econômico: o mais leve. Equilibrado: o porte pedido pela etapa. Qualidade: o mais capaz.
  const target = request.profile === "economic" ? 0 : request.profile === "quality" ? 2 : TIER_VALUE[request.weight];
  const score = (model: CatalogModel) =>
    (model.key === settings.defaultModelKey ? -50 : 0) + Math.abs(TIER_VALUE[model.tier] - target) * 10 +
    (request.profile !== "economic" && TIER_VALUE[model.tier] < target ? 5 : 0) + COST_RANK[model.cost] + (model.status === "active" || !model.status ? 0 : 3);
  const best = [...candidates].sort((a, b) => score(a) - score(b) || (b.context ?? 0) - (a.context ?? 0) || a.key.localeCompare(b.key))[0];
  const profileLabel = { economic: "Econômico", balanced: "Equilibrado", quality: "Máxima qualidade" }[request.profile];
  const pin = best.key === settings.defaultModelKey ? "modelo padrão; " : "";
  return result(best, `Seleção automática (${pin}perfil ${profileLabel}, etapa de porte ${request.weight}, ${candidates.length} candidato(s) permitido(s))${notes.length ? `; ${notes.join("; ")}` : ""}.`);
}

// Nível de raciocínio: só entre os que o modelo declara suportar.
export function pickEffort(model: CatalogModel, profile: Profile, weight: ModelTier): string | undefined {
  if (!model.efforts.length) return;
  const wanted = profile === "economic" ? ["low", "minimal", "medium"] : profile === "quality" ? ["high", "xhigh", "max", "medium"]
    : weight === "heavy" ? ["high", "medium"] : weight === "light" ? ["low", "medium"] : ["medium", "low", "high"];
  return wanted.find(effort => model.efforts.includes(effort));
}
