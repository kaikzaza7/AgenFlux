import { randomUUID } from "node:crypto";
import type { Automation, Mission } from "../src/lib/types.ts";
import type { Payload } from "./codex.ts";
import type { Store } from "./store.ts";
import { redact } from "./redact.ts";

// ---------------------------------------------------------------------------
// Automações: missões agendadas. Você descreve a tarefa uma vez e escolhe quando
// ela roda (uma vez, todo dia em certos dias da semana, ou a cada N minutos).
// No horário, o AgenFlux cria uma missão normal — com o mesmo Orquestrador, a
// mesma política de custo zero e as mesmas aprovações. O AgenFlux precisa estar
// aberto para o agendamento disparar (ele roda no seu computador, não na nuvem).
// Os horários usam o relógio local da máquina.
// ---------------------------------------------------------------------------

export function validSchedule(schedule: unknown): Automation["schedule"] {
  const s = schedule as Payload;
  if (s?.type === "once") {
    const at = new Date(String(s.at));
    if (Number.isNaN(at.getTime())) throw new Error("Data e hora inválidas.");
    return { type: "once", at: at.toISOString() };
  }
  if (s?.type === "daily") {
    if (typeof s.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new Error("Horário inválido (use HH:MM).");
    const days = Array.isArray(s.days) && s.days.length ? [...new Set(s.days.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [0, 1, 2, 3, 4, 5, 6];
    if (!days.length) throw new Error("Escolha ao menos um dia da semana.");
    return { type: "daily", time: s.time, days };
  }
  if (s?.type === "interval") {
    const minutes = Number(s.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) throw new Error("Intervalo inválido (mínimo 5 minutos, máximo 7 dias).");
    return { type: "interval", minutes };
  }
  throw new Error("Tipo de agendamento inválido.");
}

// Próxima execução estritamente depois de `from`. undefined = não há próxima.
export function nextRun(schedule: Automation["schedule"], from: Date, lastRun?: Date): Date | undefined {
  if (schedule.type === "once") { const at = new Date(schedule.at); return at > from && !lastRun ? at : undefined; }
  if (schedule.type === "interval") return new Date((lastRun && lastRun > from ? lastRun : from).getTime() + schedule.minutes * 60000);
  const [hour, minute] = schedule.time.split(":").map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, hour, minute, 0, 0);
    if (candidate > from && schedule.days.includes(candidate.getDay())) return candidate;
  }
  return undefined;
}

export interface AutomationHost { store: Store; workspace: string; createMission(input: Payload): Mission; missionStatus(id: string): Mission["status"] | undefined; notify(): void }

export class Automations {
  private host: AutomationHost; private timer?: NodeJS.Timeout; private now: () => Date;
  constructor(host: AutomationHost, now: () => Date = () => new Date()) { this.host = host; this.now = now; }
  get all() { return this.host.store.all<Automation>("automation"); }

  start(intervalMs = 20000) {
    // Ao iniciar: execuções perdidas enquanto o AgenFlux estava fechado só rodam se
    // a automação pedir ("recuperar execução perdida"); caso contrário são reagendadas.
    const now = this.now();
    for (const automation of this.all.filter(a => a.enabled)) {
      const due = automation.nextRunAt ? new Date(automation.nextRunAt) : undefined;
      if (due && due <= now && !automation.catchUp) {
        const next = nextRun(automation.schedule, now, automation.lastRunAt ? new Date(automation.lastRunAt) : undefined);
        this.host.store.put("automation", { ...automation, nextRunAt: next?.toISOString(), enabled: Boolean(next), lastError: `Execução de ${due.toLocaleString("pt-BR")} não ocorreu: o AgenFlux estava fechado.` });
      }
    }
    this.timer = setInterval(() => this.tick(), intervalMs); this.timer.unref?.();
    this.tick();
  }
  stop() { clearInterval(this.timer); }

  save(input: Payload): Automation {
    const existing = input.id ? this.all.find(a => a.id === input.id) : undefined;
    if (input.id && !existing) throw new Error("Automação inexistente.");
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) throw new Error("Dê um nome de até 80 caracteres à automação.");
    if (typeof input.objective !== "string" || !input.objective.trim() || input.objective.length > 12000) throw new Error("Descreva a tarefa (até 12000 caracteres).");
    if (!["economic", "balanced", "quality"].includes(input.profile ?? "economic")) throw new Error("Perfil inválido.");
    const schedule = validSchedule(input.schedule);
    const now = this.now();
    const next = nextRun(schedule, now);
    if (!next) throw new Error("Esse horário já passou. Escolha uma data futura.");
    const automation: Automation = {
      id: existing?.id ?? randomUUID(), name: input.name.trim(), objective: redact(input.objective.trim()), cwd: String(input.cwd || this.host.workspace).slice(0, 1000),
      profile: input.profile ?? "economic", allowWrite: input.allowWrite === true, ...(input.teamId ? { teamId: String(input.teamId) } : {}), enabled: input.enabled !== false, schedule,
      createdAt: existing?.createdAt ?? now.toISOString(), nextRunAt: next.toISOString(), lastRunAt: existing?.lastRunAt, lastMissionId: existing?.lastMissionId, runs: existing?.runs ?? 0, catchUp: input.catchUp === true,
    };
    this.host.store.put("automation", automation); this.host.notify(); return automation;
  }
  toggle(id: string, enabled: boolean) {
    const automation = this.all.find(a => a.id === id); if (!automation) throw new Error("Automação inexistente.");
    const next = enabled ? nextRun(automation.schedule.type === "once" ? automation.schedule : automation.schedule, this.now()) : undefined;
    if (enabled && !next) throw new Error("O horário desta automação já passou. Edite-a para definir uma nova data.");
    this.host.store.put("automation", { ...automation, enabled, nextRunAt: next?.toISOString(), lastError: undefined }); this.host.notify();
  }
  remove(id: string) { this.host.store.remove("automation", id); this.host.notify(); }

  // Dispara agora (botão "Executar agora") ou pelo relógio.
  run(id: string, manual = false): Mission | undefined {
    const automation = this.all.find(a => a.id === id); if (!automation) throw new Error("Automação inexistente.");
    const now = this.now();
    const reschedule = (patch: Partial<Automation>) => {
      const next = manual ? (automation.nextRunAt ? new Date(automation.nextRunAt) : undefined) : nextRun(automation.schedule, now, now);
      const keep = automation.schedule.type === "once" && !manual ? false : automation.enabled && Boolean(next);
      this.host.store.put("automation", { ...automation, ...patch, nextRunAt: keep ? next?.toISOString() : manual ? automation.nextRunAt : undefined, enabled: manual ? automation.enabled : keep });
      this.host.notify();
    };
    // Não empilha: se a execução anterior ainda está rodando, esta é pulada.
    if (automation.lastMissionId && this.host.missionStatus(automation.lastMissionId) === "running") {
      if (manual) throw new Error("A execução anterior desta automação ainda está em andamento.");
      reschedule({ lastError: `Execução de ${now.toLocaleString("pt-BR")} pulada: a anterior ainda estava em andamento.` }); return;
    }
    try {
      const mission = this.host.createMission({ objective: automation.objective, cwd: automation.cwd, profile: automation.profile, allowWrite: automation.allowWrite, teamId: automation.teamId, maxAttempts: 1, automationId: automation.id });
      reschedule({ lastRunAt: now.toISOString(), lastMissionId: mission.id, runs: automation.runs + 1, lastError: undefined });
      return mission;
    } catch (error) {
      if (manual) throw error;
      reschedule({ lastRunAt: now.toISOString(), lastError: redact((error as Error).message) });
    }
  }
  tick() {
    const now = this.now();
    for (const automation of this.all) if (automation.enabled && automation.nextRunAt && new Date(automation.nextRunAt) <= now) this.run(automation.id);
  }
}
