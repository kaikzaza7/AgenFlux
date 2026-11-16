import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { Headquarters } from "../server/hq.ts";
import { readSummary } from "../server/missions.ts";
import { createHq, until, NullCodex, ScriptedEngine } from "./helpers.ts";

const finished = (hq: Headquarters, id: string) => ["completed", "blocked", "cancelled"].includes(hq.store.one<any>("mission", id)!.status);

test("Missão 1 (documentação): Orquestrador delega, agentes trocam entregas e o relatório final é consolidado", async () => {
  const { hq, engine } = await createHq();
  const mission = hq.createMission({ objective: "Analise este projeto, deixe os comentários em português e explique como o código funciona para outro desenvolvedor.", allowWrite: false });
  assert.deepEqual(mission.plan!.intents.map(i => i.id).sort(), ["analysis", "docs"]);
  await until(() => finished(hq, mission.id), "missão concluir");
  const final = hq.store.one<any>("mission", mission.id);
  assert.equal(final.status, "completed");
  const tasks = hq.store.tasks.filter(t => t.missionId === mission.id);
  assert.ok(tasks.every(t => t.status === "completed"));
  // Etapas reais: inventário local → Analista → Documentador → relatório local.
  assert.deepEqual(tasks.map(t => t.stage).reverse().slice(0, 2), ["scan", "analyst"]);
  assert.ok(tasks.some(t => t.agentId === "documenter"));
  assert.equal(tasks.find(t => t.stage === "scan")!.engine, "local");
  assert.equal(tasks.find(t => t.stage === "report")!.engine, "local", "perfil Econômico monta o relatório sem LLM");
  assert.match(final.report, /Relatório da missão/);
  assert.match(final.report, /Entrega de Analista/);
  // Comunicação estruturada e verificável entre agentes.
  const messages = hq.missions.communications.filter(c => c.missionId === mission.id);
  assert.ok(messages.length >= 3);
  for (const message of messages) {
    assert.equal(message.state, "delivered");
    assert.ok(message.from && message.to && message.at && message.stage && message.content);
    assert.ok(hq.store.events.some(e => e.id === message.sourceEventId && e.kind === "completed"), "mensagem aponta para um evento real de conclusão");
  }
  // O Analista recebeu o inventário local em vez de refazê-lo.
  const analyst = engine.started.find(c => c.agent.id === "analyst")!;
  assert.match(analyst.prompt, /Inventário local \(sem LLM\)/);
  assert.equal(analyst.readOnly, true);
  // Modelo registrado e gratuito em todas as etapas com LLM.
  for (const task of tasks.filter(t => t.engine !== "local")) { assert.ok(task.routing); assert.notEqual(task.routing!.cost, "paid"); }
  hq.close();
});

test("Missão 2 (segurança): varredura local sem revelar segredos e análise especializada", async () => {
  const { hq, dir } = await createHq();
  const { writeFileSync } = await import("node:fs");
  const secret = "sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2";
  writeFileSync(join(dir, "src", "config.ts"), `export const apiKey = "${secret}";\n`);
  const mission = hq.createMission({ objective: "Verifique se existe alguma chave de API, senha ou informação sensível exposta." });
  await until(() => finished(hq, mission.id));
  const tasks = hq.store.tasks.filter(t => t.missionId === mission.id);
  const audit = tasks.find(t => t.stage === "audit")!;
  assert.equal(audit.engine, "local");
  const summary = readSummary(audit.result);
  assert.ok(summary.findings.some(f => /src\/config\.ts:1/.test(f)), "aponta arquivo e linha");
  // O valor do segredo não aparece em nenhum lugar do estado enviado ao navegador.
  assert.ok(!JSON.stringify(hq.snapshot()).includes(secret));
  assert.ok(tasks.some(t => t.agentId === "security" && t.stage === "security" && t.status === "completed"));
  hq.close();
});

test("Missão 3 (interface): skills relevantes são selecionadas e registradas", async () => {
  const { hq, engine } = await createHq();
  const mission = hq.createMission({ objective: "Melhore a interface do sistema e deixe mais moderna, sem alterar as funcionalidades.", allowWrite: true });
  const names = new Set(mission.plan!.stages.flatMap(s => s.skills.map(k => k.name)));
  assert.ok(names.has("design-de-interface") && names.has("react"), `skills: ${[...names]}`);
  assert.ok(!names.has("banco-de-dados") && !names.has("consultas-sql"), "skills irrelevantes ficam de fora");
  assert.ok(mission.plan!.stages.every(s => s.skills.length <= 3), "no máximo 3 skills por etapa");
  await until(() => finished(hq, mission.id));
  const developer = engine.started.find(c => c.agent.id === "developer")!;
  assert.equal(developer.readOnly, false);
  assert.match(developer.system, /SKILL: design-de-interface/);
  assert.ok(!/SKILL: banco-de-dados/.test(developer.system));
  const usage = hq.snapshot().skillUsage!;
  assert.ok(usage.some(u => u.skillName === "react" && u.missionId === mission.id && u.matched?.length));
  hq.close();
});

test("Execução paralela limitada e sem escrita concorrente no mesmo workspace", async () => {
  const { hq, engine } = await createHq();
  hq.saveSettings({ concurrency: 3 });
  engine.script = () => ({ delay: 40 });
  const mission = hq.createMission({ objective: "Corrija os erros de segurança do projeto e adicione testes.", allowWrite: true });
  await until(() => finished(hq, mission.id), "missão paralela", 15000);
  assert.equal(hq.store.one<any>("mission", mission.id).status, "completed");
  assert.ok(engine.maxParallel >= 2, "revisão, segurança e testes rodam em paralelo");
  assert.ok(engine.maxParallel <= 3, "respeita o limite configurado");
  hq.close();
});

test("Aprovação: recusar bloqueia a etapa; aprovar deixa prosseguir; ação bloqueada não pode ser aprovada", async () => {
  const { hq, engine } = await createHq();
  engine.script = context => context.agent.id === "analyst" ? { approval: { action: "ls -la", kind: "command" } } : {};
  const mission = hq.createMission({ objective: "Analise o projeto." });
  await until(() => hq.store.approvals.some(a => a.state === "pending"), "pedido de aprovação");
  const approval = hq.store.approvals.find(a => a.state === "pending")!;
  assert.equal(hq.store.one<any>("task", approval.taskId).status, "approval");
  assert.ok(approval.action && approval.reason && approval.agentId === "analyst");
  await hq.decide(approval.id, true);
  await until(() => finished(hq, mission.id));
  assert.equal(hq.store.one<any>("mission", mission.id).status, "completed");
  assert.deepEqual(engine.decisions.at(-1), { id: approval.rpcId, approve: true });

  engine.script = context => context.agent.id === "analyst" ? { approval: { action: "rm -rf dist", kind: "command", canApprove: false } } : {};
  const second = hq.createMission({ objective: "Analise o projeto novamente." });
  await until(() => hq.store.approvals.some(a => a.state === "pending"));
  const blocked = hq.store.approvals.find(a => a.state === "pending")!;
  await assert.rejects(hq.decide(blocked.id, true), /política da missão/);
  await hq.decide(blocked.id, false);
  await until(() => finished(hq, second.id));
  assert.equal(hq.store.one<any>("mission", second.id).status, "blocked");
  hq.close();
});

test("Limite gratuito: troca para outro modelo gratuito, nunca para um pago", async () => {
  const { hq, engine } = await createHq();
  engine.script = (context, attempt) => context.agent.id === "analyst" && attempt === 1 ? { fail: "429 rate limit exceeded", limit: true } : {};
  const mission = hq.createMission({ objective: "Execute uma análise simples utilizando apenas modelos gratuitos." });
  await until(() => finished(hq, mission.id));
  assert.equal(hq.store.one<any>("mission", mission.id).status, "completed");
  const analyst = hq.store.tasks.find(t => t.missionId === mission.id && t.stage === "analyst")!;
  assert.deepEqual(analyst.excludedModels, ["opencode:opencode/leve-free"]);
  assert.equal(analyst.routing!.modelKey, "opencode:opencode/forte-free");
  assert.ok(hq.store.events.some(e => e.taskId === analyst.id && e.kind === "limit"));
  assert.ok(engine.started.every(c => c.model!.cost !== "paid"), "nenhuma chamada a modelo pago");
  hq.close();
});

test("Custo zero: sem modelo gratuito a missão é recusada; custo inesperado interrompe a etapa", async () => {
  const { hq, engine } = await createHq();
  const free = engine.list; engine.list = free.filter(m => m.cost === "paid");
  assert.throws(() => hq.createMission({ objective: "Analise o projeto." }), /Nenhum modelo gratuito compatível/);
  assert.equal(engine.started.length, 0);
  engine.list = free;
  engine.script = context => context.agent.id === "analyst" ? { cost: 0.02, delay: 30 } : {};
  const mission = hq.createMission({ objective: "Analise o projeto com cuidado." });
  await until(() => finished(hq, mission.id));
  assert.equal(hq.store.one<any>("mission", mission.id).status, "blocked");
  assert.ok(hq.store.events.some(e => e.kind === "policy" && /custo/.test(e.text)));
  hq.close();
});

test("Substituição manual: agentes, modelo e skills escolhidos por você prevalecem", async () => {
  const { hq } = await createHq();
  const plan = hq.plan({ objective: "Analise o projeto.", overrides: { agents: ["analyst", "security"], models: { analyst: "opencode:opencode/forte-free" }, skills: { analyst: ["agenflux:banco-de-dados"] } } });
  assert.ok(plan.stages.some(s => s.agentId === "security" && s.engine === "llm"));
  assert.ok(!plan.stages.some(s => s.agentId === "planner"));
  const analyst = plan.stages.find(s => s.key === "analyst")!;
  assert.equal(analyst.routing!.modelKey, "opencode:opencode/forte-free");
  assert.deepEqual(analyst.skills.map(s => s.name), ["banco-de-dados"]);
  // Um modelo pago escolhido manualmente continua bloqueado pela política.
  const paid = hq.plan({ objective: "Analise o projeto.", overrides: { models: { analyst: "opencode:pago/gpt-pago" } } });
  assert.equal(paid.stages.find(s => s.key === "analyst")!.routing!.modelKey, "opencode:opencode/leve-free");
  assert.match(paid.stages.find(s => s.key === "analyst")!.routing!.reason, /cobrado por token/);
  hq.close();
});

test("Persistência e recuperação: após reinício a missão fica bloqueada e pode ser retomada sem refazer etapas", async () => {
  const db = join(mkdtempSync(join(tmpdir(), "agenflux-db-")), "hq.sqlite");
  const first = await createHq({ db });
  first.engine.script = context => context.agent.id === "analyst" ? { delay: 60000 } : {};
  const mission = first.hq.createMission({ objective: "Documente o projeto." });
  await until(() => first.hq.store.tasks.some(t => t.stage === "analyst" && t.status === "running"));
  first.hq.close(); first.store.close(); // simula queda do servidor

  const store = new Store(db);
  let engine!: ScriptedEngine;
  const hq = new Headquarters(store, new NullCodex(), first.dir, { dataDir: first.data, eccRoot: join(first.data, "x"), engines: { opencode: host => (engine = new ScriptedEngine(host)) } });
  const recovered = store.one<any>("mission", mission.id);
  assert.equal(recovered.status, "blocked");
  assert.match(recovered.blockers.join(" "), /reiniciado/);
  assert.equal(store.tasks.find(t => t.stage === "scan" && t.missionId === mission.id)!.status, "completed", "etapa concluída foi preservada");
  hq.retryMission(mission.id);
  await until(() => finished(hq, mission.id));
  assert.equal(store.one<any>("mission", mission.id).status, "completed");
  assert.ok(!engine.started.some(c => c.task.stage === "scan"), "o inventário não foi refeito");
  hq.close(); store.close();
});
