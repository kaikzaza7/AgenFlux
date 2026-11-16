import test from "node:test";
import assert from "node:assert/strict";
import { classifyCost, modelTier, policyBlock, routeModel, pickEffort } from "../server/catalog.ts";
import { DEFAULT_SETTINGS } from "../src/lib/types.ts";
import { model } from "./helpers.ts";

const base = { modelId: "m", name: "M", connected: true };
test("classificação de custo parte do preço informado, não do nome", () => {
  assert.equal(classifyCost({ ...base, providerId: "opencode", modelId: "nemotron-3-ultra-free", costIn: 0, costOut: 0 }).cost, "free-temporary");
  assert.equal(classifyCost({ ...base, providerId: "opencode", modelId: "falso-free", costIn: 1, costOut: 3 }).cost, "paid", "nome com 'free' e preço > 0 é pago");
  assert.equal(classifyCost({ ...base, providerId: "openrouter", modelId: "nvidia/nemotron-3.5-lightning:free", costIn: 0, costOut: 0 }).cost, "free-limited");
  assert.equal(classifyCost({ ...base, providerId: "openrouter", modelId: "openrouter/auto", costIn: 0, costOut: 0 }).cost, "paid", "roteador sem preço fixo não é tratado como gratuito");
  assert.equal(classifyCost({ ...base, providerId: "ollama", costIn: 0, costOut: 0 }).cost, "local");
  assert.equal(classifyCost({ ...base, providerId: "custom", costIn: 0, costOut: 0, baseUrl: "http://127.0.0.1:1234/v1" }).cost, "local");
  assert.equal(classifyCost({ ...base, providerId: "github-copilot", costIn: 0, costOut: 0 }).cost, "subscription");
  assert.equal(classifyCost({ ...base, providerId: "anthropic", costIn: 3, costOut: 15 }).cost, "paid");
  assert.equal(classifyCost({ ...base, providerId: "nvidia", costIn: 0, costOut: 0, connected: false }).cost, "unavailable");
  assert.equal(classifyCost({ ...base, providerId: "nvidia", costIn: 0, costOut: 0, status: "deprecated" }).cost, "unavailable");
});

test("porte estimado dos modelos", () => {
  assert.equal(modelTier("nemotron-3.5-lightning-free"), "light");
  assert.equal(modelTier("nemotron-3-ultra-free"), "heavy");
  assert.equal(modelTier("glm-5.3-flash-free"), "light");
  assert.equal(modelTier("qwen2.5-coder:7b"), "light");
  assert.equal(modelTier("big-pickle"), "medium");
});

const models = [model({ key: "a:leve", tier: "light" }), model({ key: "a:medio", tier: "medium", cost: "free-limited" }), model({ key: "a:forte", tier: "heavy" }), model({ key: "a:local", tier: "light", cost: "local", toolCall: false }), model({ key: "a:pago", tier: "heavy", cost: "paid" }), model({ key: "a:assinatura", tier: "heavy", cost: "subscription" })];
test("política Somente modelos gratuitos (ativa por padrão)", () => {
  assert.equal(DEFAULT_SETTINGS.freeOnly, true); assert.equal(DEFAULT_SETTINGS.profile, "economic");
  assert.match(policyBlock(models[4], DEFAULT_SETTINGS)!, /cobrado por token/);
  assert.match(policyBlock(models[5], DEFAULT_SETTINGS)!, /assinatura paga/);
  assert.equal(policyBlock(models[5], { ...DEFAULT_SETTINGS, allowSubscription: true }), undefined);
  assert.equal(policyBlock(models[0], DEFAULT_SETTINGS), undefined);
  assert.equal(policyBlock(models[4], { ...DEFAULT_SETTINGS, freeOnly: false }), undefined);
});

test("inteligência econômica: perfis escolhem portes diferentes, sempre dentro da política", () => {
  const request = { agentId: "developer", weight: "heavy" as const, needsTools: true };
  assert.equal(routeModel({ ...request, profile: "economic" }, models, DEFAULT_SETTINGS).modelKey, "a:leve");
  assert.equal(routeModel({ ...request, profile: "balanced" }, models, DEFAULT_SETTINGS).modelKey, "a:forte");
  assert.equal(routeModel({ ...request, weight: "light", profile: "balanced" }, models, DEFAULT_SETTINGS).modelKey, "a:leve", "tarefa leve não usa modelo forte");
  assert.equal(routeModel({ ...request, weight: "light", profile: "quality" }, models, DEFAULT_SETTINGS).modelKey, "a:forte");
  assert.equal(routeModel({ ...request, profile: "quality" }, models, { ...DEFAULT_SETTINGS, freeOnly: false }).cost !== undefined, true);
  // Etapa que exige ferramentas nunca recebe modelo sem ferramentas.
  assert.notEqual(routeModel({ ...request, profile: "economic" }, models, DEFAULT_SETTINGS).modelKey, "a:local");
  // Modelo do agente e alternativo.
  assert.equal(routeModel({ ...request, profile: "economic" }, models, DEFAULT_SETTINGS, { id: "developer", modelKey: "a:medio" }).modelKey, "a:medio");
  const fallback = routeModel({ ...request, profile: "economic" }, models, DEFAULT_SETTINGS, { id: "developer", modelKey: "a:pago", fallbackKey: "a:forte" });
  assert.equal(fallback.modelKey, "a:forte"); assert.match(fallback.reason, /cobrado por token/);
  // Sem alternativa gratuita: erro claro, nunca um pago.
  assert.throws(() => routeModel({ ...request, profile: "economic" }, models.filter(m => !["free", "free-limited", "free-temporary"].includes(m.cost) ), DEFAULT_SETTINGS), /Nenhum modelo gratuito compatível.*Nenhuma chamada paga/s);
});

test("nível de raciocínio só é escolhido entre os suportados pelo modelo", () => {
  assert.equal(pickEffort(model({ key: "x", efforts: [] }), "quality", "heavy"), undefined);
  assert.equal(pickEffort(model({ key: "x", efforts: ["low", "high"] }), "economic", "heavy"), "low");
  assert.equal(pickEffort(model({ key: "x", efforts: ["low", "high"] }), "quality", "light"), "high");
  const routed = routeModel({ agentId: "a", weight: "light", needsTools: false, profile: "economic" }, [model({ key: "x", efforts: ["medium"] })], DEFAULT_SETTINGS, { id: "a", effort: "xhigh" });
  assert.equal(routed.effort, "medium", "nível não suportado é ignorado");
});
