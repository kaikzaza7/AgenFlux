"use client";
import { useState } from "react";
import { ArrowRight, FileCode2, ListTodo, RotateCw, ShieldCheck, Users } from "lucide-react";
import type { Snapshot, Task } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";
import { COST_LABEL, PROFILE_LABEL } from "@/lib/cost";
import { uniqueCommunications } from "@/lib/communications";

type Action = (data: Record<string, unknown>) => Promise<boolean>;
const missionStatus = { running: "Em execução", completed: "Concluída", blocked: "Bloqueada", cancelled: "Cancelada" };

// Histórico: todas as missões, com etapas, modelos usados, relatório e a linha do
// tempo de eventos originais.
export function MissionPanel({ snapshot, action, busy, openTask }: { snapshot: Snapshot; action: Action; busy: boolean; openTask: (task: Task) => void }) {
  const [selected, setSelected] = useState("");
  const mission = snapshot.missions?.find(m => m.id === selected) ?? snapshot.missions?.[0];
  const tasks = snapshot.tasks.filter(t => t.missionId === mission?.id);
  const agents = snapshot.agentCatalog ?? snapshot.agents;
  const name = (id: string) => agents.find(a => a.id === id)?.name ?? id;
  return <section className="tasks-panel command-panel"><div className="panel-toolbar"><div className="panel-title"><ListTodo size={17} /><h2>Missões</h2></div><span className="tiny">{snapshot.missions?.length ?? 0} registradas</span></div>
    <div className="mission-history"><div className="mission-list" aria-label="Histórico de missões">{snapshot.missions?.length ? snapshot.missions.map(m => <button type="button" className="mission-list-item" key={m.id} aria-pressed={m.id === mission?.id} onClick={() => setSelected(m.id)}><strong>{m.objective.length > 88 ? m.objective.slice(0, 88) + "…" : m.objective}</strong><small>{missionStatus[m.status]} · {new Date(m.createdAt).toLocaleString("pt-BR")}</small></button>) : <p className="field-help">Nenhuma missão criada.</p>}</div>
    {mission && <div className="mission-detail"><div className="row-between"><h3>{mission.objective.split("\n")[0].slice(0, 100)}</h3>
      {mission.status === "running" && <button disabled={busy} className="button" onClick={() => void action({ action: "mission.cancel", id: mission.id })}>Cancelar missão</button>}
      {["blocked", "cancelled"].includes(mission.status) && tasks.some(t => ["failed", "interrupted", "cancelled"].includes(t.status)) && <button disabled={busy} className="button primary" onClick={() => void action({ action: "mission.retry", id: mission.id })}><RotateCw size={14} /> Retomar</button>}</div>
      <details className="mission-objective"><summary>Ver objetivo completo</summary><p>{mission.objective}</p></details>
      <p className="field-help">{missionStatus[mission.status]} · {PROFILE_LABEL[mission.profile]} · correções {mission.cycle}/{mission.maxAttempts} · {mission.allowWrite ? "edição autorizada" : "somente leitura"}{mission.team ? ` · time ${mission.team.name}` : ""}</p>
      <p className="field-help">Tokens informados: {tasks.reduce((sum, t) => sum + (t.tokenUsage?.totalTokens ?? 0), 0).toLocaleString("pt-BR")} · custo reportado: US$ {tasks.reduce((sum, t) => sum + (t.cost ?? 0), 0).toFixed(4)}</p>
      {mission.plan && <p className="field-help">{mission.plan.summary}</p>}
      {mission.blockers.map((blocker, i) => <p className="inline-error" key={i}>{blocker}</p>)}
      <div className="mission-steps">{[...tasks].reverse().map(t => <button className="mission-step" key={t.id} onClick={() => openTask(t)}><span><strong>{name(t.agentId)}</strong><small>{STATUS_LABEL[t.status]} · {t.engine === "local" ? "ferramenta local (sem LLM)" : t.routing ? `${t.routing.modelName} (${COST_LABEL[t.routing.cost]})` : t.configuration?.model ?? "modelo não registrado"}</small><small>Depende de: {t.dependencies?.map(id => name(snapshot.tasks.find(other => other.id === id)?.agentId ?? "?")).join(", ") || "nada"}</small>{t.skills?.length ? <small>Skills: {t.skills.map(s => s.name).join(", ")}</small> : null}</span><ArrowRight size={15} /></button>)}</div>
      {mission.report && <article className="mission-report"><h3>Relatório final</h3><pre>{mission.report}</pre></article>}
      <details className="mission-timeline"><summary>Linha do tempo e eventos originais</summary>{[...snapshot.events].reverse().filter(e => tasks.some(t => t.id === e.taskId)).map(e => <div key={e.id}><time>{new Date(e.at).toLocaleString("pt-BR")}</time><strong> {e.kind} · {name(e.agentId)}</strong><p>{e.text.slice(0, 1200)}</p></div>)}</details></div>}</div></section>;
}
// Comunicação estruturada entre agentes: origem, destino, missão, etapa, conteúdo,
// horário e estado da entrega — sempre apontando para o evento real de origem.
export function CommunicationsPanel({ snapshot, openTask }: { snapshot: Snapshot; openTask: (task: Task) => void }) {
  const [missionId, setMissionId] = useState("");
  const messages = uniqueCommunications(snapshot.communications ?? []).filter(c => !missionId || c.missionId === missionId).slice(0, 60);
  const agents = snapshot.agentCatalog ?? snapshot.agents;
  const name = (id: string) => agents.find(a => a.id === id)?.name ?? id;
  return <section className="tasks-panel command-panel"><div className="panel-toolbar"><div className="panel-title"><Users size={17} /><h2>Comunicação da equipe</h2></div><span className="tiny">ENTREGAS RASTREÁVEIS</span></div>
    <div className="command-intro"><p>Entregas de resultados reais entre etapas, encaminhadas pelo Orquestrador. Não são conversas inventadas.</p><label>Missão<select value={missionId} onChange={e => setMissionId(e.target.value)}><option value="">Todas as missões</option>{snapshot.missions?.map(m => <option value={m.id} key={m.id}>{m.objective.slice(0, 75)}</option>)}</select></label></div>
    {!messages.length && <div className="large-empty"><ShieldCheck size={30} /><h3>Aguardando entregas reais</h3><p>As mensagens aparecem quando uma etapa conclui e o resultado é encaminhado.</p></div>}
    {messages.map(c => <article className="communication-card" key={c.id}><div className="row-between"><strong>{name(c.from)} → {name(c.to)}</strong><time>{new Date(c.at).toLocaleString("pt-BR")}</time></div>
      <p className="field-help">Etapa de destino: {c.stage ?? "—"} · {c.state === "delivered" ? "Entregue" : "Aguardando o destinatário iniciar"} · Missão: {snapshot.missions?.find(m => m.id === c.missionId)?.objective.slice(0, 80)}</p>
      <details><summary>Conteúdo</summary><pre>{c.content}</pre></details>
      <button className="text-button" onClick={() => { const t = snapshot.tasks.find(t => t.id === c.sourceTaskId); if (t) openTask(t); }}><FileCode2 size={13} /> Abrir tarefa de origem</button> <span className="field-help">evento {c.sourceEventId.slice(0, 8)}</span></article>)}</section>;
}
