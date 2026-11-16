import test from "node:test";
import assert from "node:assert/strict";
import { Automations, nextRun, validSchedule } from "../server/automations.ts";
import { createHq, until } from "./helpers.ts";

test("cálculo da próxima execução", () => {
  const monday = new Date(2026, 10, 16, 10, 0, 0); // segunda-feira, 16/11/2026 10:00
  assert.equal(nextRun({ type: "daily", time: "09:00", days: [0, 1, 2, 3, 4, 5, 6] }, monday)!.toISOString(), new Date(2026, 10, 17, 9, 0).toISOString());
  assert.equal(nextRun({ type: "daily", time: "18:30", days: [1] }, monday)!.toISOString(), new Date(2026, 10, 16, 18, 30).toISOString());
  assert.equal(nextRun({ type: "daily", time: "08:00", days: [5] }, monday)!.getDay(), 5, "só na sexta-feira");
  assert.equal(nextRun({ type: "interval", minutes: 30 }, monday)!.getTime(), monday.getTime() + 30 * 60000);
  assert.equal(nextRun({ type: "once", at: new Date(2026, 10, 16, 12, 0).toISOString() }, monday)!.getHours(), 12);
  assert.equal(nextRun({ type: "once", at: new Date(2026, 10, 15, 12, 0).toISOString() }, monday), undefined, "data passada não agenda");
  assert.throws(() => validSchedule({ type: "daily", time: "25:00" }), /Horário inválido/);
  assert.throws(() => validSchedule({ type: "interval", minutes: 1 }), /mínimo 5 minutos/);
  assert.deepEqual(validSchedule({ type: "daily", time: "07:05", days: [3, 1, 1] }), { type: "daily", time: "07:05", days: [1, 3] });
});

test("automação dispara uma missão real no horário, reagenda e não empilha execuções", async () => {
  const { hq, engine } = await createHq();
  let clock = new Date(2026, 10, 16, 8, 0, 0);
  const automations = new Automations({ store: hq.store, workspace: hq.workspace, createMission: input => hq.createMission(input), missionStatus: id => hq.store.one<any>("mission", id)?.status, notify: () => {} }, () => clock);
  const saved = automations.save({ name: "Auditoria diária", objective: "Verifique se existe alguma senha exposta.", schedule: { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5] } });
  assert.equal(new Date(saved.nextRunAt!).getHours(), 9);
  automations.tick();
  assert.equal(hq.missions.missions.length, 0, "antes do horário nada roda");
  engine.script = () => ({ delay: 200 });
  clock = new Date(2026, 10, 16, 9, 0, 30);
  automations.tick();
  const mission = hq.missions.missions[0];
  assert.ok(mission, "missão criada no horário"); assert.equal(mission.automationId, saved.id); assert.equal(mission.allowWrite, false);
  let current = automations.all[0];
  assert.equal(current.runs, 1); assert.equal(current.lastMissionId, mission.id);
  assert.equal(new Date(current.nextRunAt!).getDate(), 17, "reagendada para o próximo dia útil");
  // Próximo horário com a anterior ainda rodando: pula e registra o motivo.
  clock = new Date(2026, 10, 17, 9, 0, 5);
  automations.tick();
  assert.equal(hq.missions.missions.length, 1); assert.match(automations.all[0].lastError!, /ainda estava em andamento/);
  await until(() => hq.store.one<any>("mission", mission.id).status === "completed", "missão agendada concluir");
  // Uma vez: executa e se desativa. Pausada: não executa.
  const once = automations.save({ name: "Uma vez", objective: "Analise o projeto.", schedule: { type: "once", at: new Date(2026, 10, 18, 7, 0).toISOString() } });
  automations.toggle(saved.id, false);
  clock = new Date(2026, 10, 18, 9, 30, 0);
  automations.tick();
  assert.equal(hq.missions.missions.length, 2, "só a automação ativa rodou");
  current = automations.all.find(a => a.id === once.id)!;
  assert.equal(current.enabled, false); assert.equal(current.runs, 1);
  assert.throws(() => automations.save({ name: "x", objective: "y", schedule: { type: "once", at: new Date(2026, 10, 1).toISOString() } }), /já passou/);
  // Falha ao criar (sem modelo gratuito) fica registrada, sem derrubar o agendador.
  engine.list = engine.list.filter(m => m.cost === "paid");
  const failing = automations.save({ name: "Sem modelo", objective: "Analise algo diferente.", schedule: { type: "interval", minutes: 10 } });
  clock = new Date(clock.getTime() + 11 * 60000); automations.tick();
  assert.match(automations.all.find(a => a.id === failing.id)!.lastError!, /Nenhum modelo gratuito/);
  await until(() => hq.missions.missions.every(m => m.status !== "running"));
  hq.close();
});
