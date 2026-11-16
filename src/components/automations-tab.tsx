"use client";
import { useState, type FormEvent } from "react";
import { CalendarClock, Play } from "lucide-react";
import type { TabProps } from "./workspace-dashboard";
import { PROFILE_LABEL } from "@/lib/cost";
import type { Automation, Profile } from "@/lib/types";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
function describe(schedule: Automation["schedule"]) {
  if (schedule.type === "once") return `Uma vez, em ${new Date(schedule.at).toLocaleString("pt-BR")}`;
  if (schedule.type === "interval") return schedule.minutes % 60 === 0 ? `A cada ${schedule.minutes / 60} hora(s)` : `A cada ${schedule.minutes} minutos`;
  return `${schedule.days.length === 7 ? "Todos os dias" : schedule.days.map(d => DAYS[d]).join(", ")} às ${schedule.time}`;
}

// Automações: missões agendadas. No horário, o AgenFlux cria uma missão normal
// (mesmo Orquestrador, mesma política de custo, mesmas aprovações).
export function AutomationsTab({ snapshot, busy, action }: TabProps) {
  const [editing, setEditing] = useState<Automation>();
  const [type, setType] = useState<"daily" | "once" | "interval">("daily");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [formKey, setFormKey] = useState(0);
  const automations = snapshot.automations ?? [];
  function edit(automation?: Automation) { setEditing(automation); setType(automation?.schedule.type ?? "daily"); setDays(automation?.schedule.type === "daily" ? automation.schedule.days : [1, 2, 3, 4, 5]); setFormKey(k => k + 1); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const schedule = type === "daily" ? { type, time: data.get("time"), days } : type === "once" ? { type, at: new Date(String(data.get("at"))).toISOString() } : { type, minutes: Number(data.get("amount")) * (data.get("unit") === "hours" ? 60 : 1) };
    if (await action({ action: "automation.save", id: editing?.id, name: data.get("name"), objective: data.get("objective"), cwd: data.get("cwd"), profile: data.get("profile"), allowWrite: data.get("allowWrite") === "on", catchUp: data.get("catchUp") === "on", teamId: data.get("teamId") || undefined, schedule })) edit(undefined);
  }
  const s = editing?.schedule;
  return <div className="hq-stack">
    <section className="command-panel">
      <div className="panel-toolbar"><div className="panel-title"><CalendarClock size={17} /><h2>Automações agendadas</h2></div><span className="tiny">{automations.filter(a => a.enabled).length} ativa(s)</span></div>
      <div className="command-intro"><p>Defina uma tarefa e um horário: o AgenFlux cria a missão sozinho, com o Orquestrador escolhendo agentes, modelos e skills. O AgenFlux precisa estar aberto no horário (ele roda no seu computador). Ações sensíveis continuam esperando a sua aprovação.</p></div>
      {automations.length ? <div className="automation-list">{automations.map(a => { const mission = snapshot.missions?.find(m => m.id === a.lastMissionId); return <article className="automation-card" key={a.id} data-off={a.enabled ? undefined : ""}>
        <div className="row-between"><h3>{a.name}</h3><label className="mission-write"><input type="checkbox" checked={a.enabled} disabled={busy} onChange={e => void action({ action: "automation.toggle", id: a.id, enabled: e.target.checked })} /> Ativa</label></div>
        <p>{a.objective.slice(0, 220)}</p>
        <small><b>{describe(a.schedule)}</b> · {PROFILE_LABEL[a.profile]} · {a.allowWrite ? "edição autorizada" : "somente leitura"} · pasta: {a.cwd}</small>
        <small>Próxima execução: <b>{a.enabled && a.nextRunAt ? new Date(a.nextRunAt).toLocaleString("pt-BR") : "—"}</b> · execuções: {a.runs}{a.lastRunAt ? ` · última: ${new Date(a.lastRunAt).toLocaleString("pt-BR")}${mission ? ` (${{ running: "em execução", completed: "concluída", blocked: "bloqueada", cancelled: "cancelada" }[mission.status]})` : ""}` : ""}</small>
        {a.lastError && <small className="hq-warning">{a.lastError}</small>}
        <div className="hq-actions"><button className="text-button" disabled={busy} onClick={() => void action({ action: "automation.run", id: a.id })}><Play size={12} /> Executar agora</button><button className="text-button" onClick={() => edit(a)}>Editar</button><button className="text-button" disabled={busy} onClick={() => { if (confirm(`Excluir a automação “${a.name}”?`)) void action({ action: "automation.delete", id: a.id }); }}>Excluir</button></div>
      </article>; })}</div> : <div className="large-empty"><h3>Nenhuma automação</h3><p>Crie a primeira abaixo — por exemplo, uma auditoria de segurança todo dia útil às 9h.</p></div>}
    </section>
    <form className="command-panel mission-form" key={formKey} onSubmit={submit}>
      <h2>{editing ? `Editar “${editing.name}”` : "Nova automação"}</h2>
      <label>Nome<input name="name" required maxLength={80} defaultValue={editing?.name} placeholder="Auditoria diária de segurança" /></label>
      <label>Tarefa (a missão que será criada)<textarea name="objective" required rows={3} maxLength={12000} defaultValue={editing?.objective} placeholder="Verifique se existe alguma chave de API, senha ou informação sensível exposta." /></label>
      <label>Pasta do projeto<input name="cwd" required maxLength={1000} defaultValue={editing?.cwd ?? snapshot.workspace} /></label>
      <div className="mission-options">
        <label>Quando<select value={type} onChange={e => setType(e.target.value as typeof type)}><option value="daily">Em dias e horário fixos</option><option value="once">Uma única vez</option><option value="interval">Repetir a cada intervalo</option></select></label>
        {type === "daily" && <label>Horário<input name="time" type="time" required defaultValue={s?.type === "daily" ? s.time : "09:00"} /></label>}
        {type === "once" && <label>Data e hora<input name="at" type="datetime-local" required defaultValue={localInput(s?.type === "once" ? new Date(s.at) : new Date(Date.now() + 3600000))} /></label>}
        {type === "interval" && <label>A cada<span className="inline-fields"><input name="amount" type="number" min={1} max={999} required defaultValue={s?.type === "interval" ? (s.minutes % 60 === 0 ? s.minutes / 60 : s.minutes) : 2} /><select name="unit" defaultValue={s?.type === "interval" && s.minutes % 60 !== 0 ? "minutes" : "hours"}><option value="hours">hora(s)</option><option value="minutes">minuto(s) — mínimo 5</option></select></span></label>}
      </div>
      {type === "daily" && <div className="hq-chips" role="group" aria-label="Dias da semana">{DAYS.map((day, i) => <label key={day} className={`hq-chip ${days.includes(i) ? "on" : ""}`}><input type="checkbox" checked={days.includes(i)} onChange={e => setDays(e.target.checked ? [...days, i].sort() : days.filter(d => d !== i))} />{day}</label>)}</div>}
      <div className="mission-options">
        <label>Perfil<select name="profile" defaultValue={editing?.profile ?? "economic"}>{(Object.keys(PROFILE_LABEL) as Profile[]).map(p => <option key={p} value={p}>{PROFILE_LABEL[p]}</option>)}</select></label>
        <label>Quem executa<select name="teamId" defaultValue={editing?.teamId ?? ""}><option value="">Orquestrador escolhe os agentes</option>{snapshot.teams?.map(team => <option key={team.id} value={team.id}>Time: {team.name}</option>)}</select></label>
      </div>
      <label className="mission-write"><input name="allowWrite" type="checkbox" defaultChecked={editing?.allowWrite} /> Permitir edição de arquivos (as alterações ficam aguardando a sua aprovação)</label>
      <label className="mission-write"><input name="catchUp" type="checkbox" defaultChecked={editing?.catchUp} /> Se o AgenFlux estiver fechado no horário, executar assim que ele abrir</label>
      <div className="hq-actions">{editing && <button type="button" className="hq-button" onClick={() => edit(undefined)}>Cancelar edição</button>}<button className="button primary" disabled={busy || (type === "daily" && !days.length)}>{editing ? "Salvar alterações" : "Criar automação"}</button></div>
    </form>
  </div>;
}
