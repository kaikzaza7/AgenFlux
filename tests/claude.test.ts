import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../server/store.ts";
import { Headquarters } from "../server/hq.ts";
import { ClaudeEngine } from "../server/engines/claude.ts";
import { readSummary } from "../server/missions.ts";
import { NullCodex, ScriptedEngine, until, workspace } from "./helpers.ts";

// Usa o substituto tests/fixtures/fake-claude.mjs (mesmo formato de eventos do CLI
// real). Para rodar contra o Claude Code verdadeiro — consome a sua assinatura —
// defina AGENFLUX_TEST_CLAUDE=1.
const real = process.env.AGENFLUX_TEST_CLAUDE === "1";
if (!real) process.env.CLAUDE_BIN = resolve("tests/fixtures/fake-claude.mjs");
process.env.ANTHROPIC_API_KEY = "chave-que-nao-deve-chegar-ao-filho";

async function setup() {
  const data = mkdtempSync(join(tmpdir(), "agenflux-claude-")); const dir = workspace();
  const store = new Store(":memory:"); await store.migrateTeam(); await store.migrateV3();
  let scripted!: ScriptedEngine;
  const hq = new Headquarters(store, new NullCodex(), dir, { dataDir: data, eccRoot: join(data, "x"), engines: { opencode: host => (scripted = new ScriptedEngine(host)) } });
  await hq.connect("claude");
  return { hq, store, scripted };
}
const done = (hq: Headquarters, id: string) => ["completed", "blocked", "cancelled"].includes(hq.store.one<any>("mission", id)!.status);

test("Claude: motor conecta, lista modelos como assinatura e fica bloqueado pela política de custo zero", async () => {
  const { hq } = await setup();
  const status = hq.engines.claude.status(); assert.equal(status.status, "connected"); assert.match(status.version!, /Claude Code/);
  const models = hq.catalog().models.filter(m => m.engine === "claude");
  assert.ok(models.length >= 3 && models.every(m => m.cost === "subscription" && m.toolCall === false && m.readTools === true));
  assert.ok(models.every(m => /assinatura paga/.test(m.blocked!)), "bloqueado enquanto 'Somente modelos gratuitos' não permitir assinatura");
  await assert.rejects(hq.testModel("claude:anthropic/sonnet"), /assinatura paga/);
  hq.saveSettings({ allowSubscription: true });
  const result = await hq.testModel("claude:anthropic/haiku");
  assert.equal(result.ok, true); assert.match(result.text, /OK/);
  hq.close();
});

test("Claude como Orquestrador: abre a missão com briefing, orienta a equipe e redige o relatório — somente leitura", { skip: real && "fluxo completo usa o substituto" }, async () => {
  const { hq, store, scripted } = await setup();
  // Sem permitir assinatura: o Orquestrador cai para um modelo gratuito (nada pago às escondidas).
  hq.saveAgentSettings({ id: "orchestrator", modelKey: "claude:anthropic/sonnet" });
  const blocked = hq.plan({ objective: "Analise o projeto." });
  assert.equal(blocked.stages.find(s => s.key === "briefing")!.routing!.engine, "opencode");
  assert.match(blocked.stages.find(s => s.key === "briefing")!.routing!.reason, /assinatura paga/);

  hq.saveSettings({ allowSubscription: true });
  const mission = hq.createMission({ objective: "Analise o projeto e explique como funciona." });
  assert.deepEqual(mission.plan!.stages.slice(0, 2).map(s => s.key), ["scan", "briefing"]);
  assert.equal(mission.plan!.stages.find(s => s.key === "report")!.engine, "llm", "o relatório passa a ser escrito pelo Orquestrador");
  await until(() => done(hq, mission.id), "missão com Claude", 20000);
  assert.equal(store.one<any>("mission", mission.id).status, "completed", JSON.stringify(store.one<any>("mission", mission.id).blockers));
  const tasks = store.tasks.filter(t => t.missionId === mission.id);
  const briefing = tasks.find(t => t.stage === "briefing")!, report = tasks.find(t => t.stage === "report")!;
  for (const task of [briefing, report]) { assert.equal(task.engine, "claude"); assert.equal(task.routing!.cost, "subscription"); assert.equal(task.effectiveModel, "claude-sonnet-teste"); }
  const summary = readSummary(briefing.result);
  assert.match(summary.findings[0], /ferramentas: Read\+Glob\+Grep/, "o Claude recebe apenas ferramentas de leitura");
  assert.match(summary.findings[1], /--no-session-persistence/); assert.match(summary.findings[1], /--strict-mcp-config/);
  assert.match(summary.summary, /Credencial de API no processo: ausente/, "ANTHROPIC_API_KEY não chega ao processo: sem cobrança de API por engano");
  assert.ok(store.events.some(e => e.taskId === briefing.id && e.kind === "tool" && /Read: README\.md/.test(e.text)), "eventos reais de ferramenta");
  assert.ok(briefing.tokenUsage!.totalTokens === 60 && briefing.steps === 2);
  // O briefing chega a todos os especialistas, não só ao próximo.
  for (const context of scripted.started) assert.match(context.prompt, /Briefing do Claude/, `${context.agent.name} recebeu o briefing`);
  assert.ok(scripted.started.length >= 2);
  // Os demais agentes continuam em modelos gratuitos.
  assert.ok(tasks.filter(t => !["briefing", "report"].includes(t.stage!) && t.routing).every(t => t.routing!.cost !== "subscription" && t.routing!.cost !== "paid"));
  // Etapas com edição nunca vão para o Claude, mesmo se escolhido manualmente.
  const write = hq.plan({ objective: "Corrija os erros do projeto.", allowWrite: true, overrides: { models: { developer: "claude:anthropic/opus" } } });
  assert.equal(write.stages.find(s => s.key === "developer")!.routing!.engine, "opencode");
  hq.close();
});

test("Claude: limite da assinatura troca para modelo gratuito; interrupção encerra o processo", { skip: real && "usa o substituto" }, async () => {
  const { hq, store } = await setup();
  hq.saveSettings({ allowSubscription: true }); hq.saveAgentSettings({ id: "orchestrator", modelKey: "claude:anthropic/sonnet" });
  const limited = hq.createMission({ objective: "Analise o projeto. FALHE:LIMITE" });
  await until(() => store.events.some(e => e.kind === "limit"), "limite detectado", 15000);
  await until(() => store.tasks.find(t => t.missionId === limited.id && t.stage === "briefing")!.status === "completed", "briefing refeito em modelo gratuito", 15000);
  const briefing = store.tasks.find(t => t.missionId === limited.id && t.stage === "briefing")!;
  assert.equal(briefing.routing!.engine, "opencode"); assert.deepEqual(briefing.excludedModels, ["claude:anthropic/sonnet"]);
  hq.missions.cancel(limited.id);

  const slow = hq.createMission({ objective: "Analise com calma o projeto. DEMORE" });
  await until(() => store.tasks.some(t => t.missionId === slow.id && t.stage === "briefing" && t.steps === 1), "claude em execução", 15000);
  const task = store.tasks.find(t => t.missionId === slow.id && t.stage === "briefing")!;
  await hq.interrupt(task.id);
  await until(() => store.one<any>("task", task.id).status === "interrupted", "interrupção", 10000);
  hq.close();
});
