import type { CostClass, ModelTier } from "./types.ts";
// Rótulos exibidos na interface para cada categoria de custo.
export const COST_LABEL: Record<CostClass, string> = { free: "Gratuito", "free-limited": "Gratuito com limite", "free-temporary": "Gratuito temporariamente", local: "Local", paid: "Pago", subscription: "Pago (assinatura)", unavailable: "Indisponível" };
export const TIER_LABEL: Record<ModelTier, string> = { light: "leve", medium: "médio", heavy: "capaz" };
export const isFree = (cost: CostClass) => cost === "free" || cost === "free-limited" || cost === "free-temporary" || cost === "local";
export const PROFILE_LABEL = { economic: "Econômico", balanced: "Equilibrado", quality: "Máxima qualidade" } as const;
export const PROFILE_HELP = { economic: "Prioriza modelos gratuitos leves e poucas chamadas; o relatório final é montado sem LLM.", balanced: "Usa modelos gratuitos mais capazes nas etapas que exigem raciocínio.", quality: "Usa os melhores modelos disponíveis dentro das restrições de custo." } as const;
