"use client";
import { FileCode2, Square, X } from "lucide-react";
import type { TabProps } from "./workspace-dashboard";
import { StatusDot } from "./workspace-dashboard";
import { COST_LABEL } from "@/lib/cost";
import { latestTask, type Agent, type Approval, type Task } from "@/lib/types";

const time = (value: string) => new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const EVENT_LABEL: Record<string, string> = { queued: "Na fila", started: "Início", model: "Modelo", skills: "Skills", session: "Sessão", tool: "Ferramenta", local: "Ferramenta local", approval: "Aprovação pedida", decision: "Decisão", completed: "Concluído", failed: "Erro", interrupted: "Interrompido", limit: "Limite de uso", policy: "Política de custo", retry: "Nova tentativa", error: "Erro", commandExecution: "Comando", fileChange: "Arquivos", message: "Mensagem", localAudit: "Varredura local", library: "Biblioteca ECC", progress: "Progresso" };
function summaryText(result: string) { try { const data = JSON.parse(result); if (typeof data.summary === "string") return data.summary as string; } catch { /* texto livre */ } return result; }

// Painel aberto ao clicar em um personagem: tudo o que aparece aqui vem do estado
// real da tarefa do agente (modelo usado, skills carregadas, eventos, arquivos).
export function AgentPanel({ snapshot, catalog, agent, tasks, approvals, busy, action, close, goAgents }: TabProps & { agent: Agent; tasks: Task[]; approvals: Approval[]; close: () => void; goAgents: () => void }) {
  const task = latestTask(tasks, agent.id);
  const settings = snapshot.agentSettings?.find(s => s.id === agent.id);
  const configured = catalog.models.find(m => m.key === settings?.modelKey);
  const mission = snapshot.missions?.find(m => m.id === task?.missionId);
  const events = snapshot.events.filter(e => e.agentId === agent.id && (!task || e.taskId === task.id)).slice(0, 14);
  const history = tasks.filter(t => t.agentId === agent.id).slice(0, 8);
  const received = (snapshot.communications ?? []).filter(c => c.to === agent.id && (!task || c.targetTaskId === task.id)).slice(0, 5);
  const name = (id: string) => (snapshot.agentCatalog ?? snapshot.agents).find(a => a.id === id)?.name ?? id;
  const live = task && ["running", "approval", "queued", "waiting"].includes(task.status);
  return <aside className="hq-agent-panel hq-glass" aria-label={`Detalhes de ${agent.name}`}>
    <div className="hq-detail-head">
      <div className="hq-agent-title"><i className="agent-color" style={{ background: agent.color }} /><div><h2>{agent.name}</h2><p>{agent.role}</p></div></div>
      <button className="hq-button hq-icon" aria-label="Fechar painel" onClick={close}><X size={16} /></button>
    </div>
    <dl className="hq-facts">
      <div><dt>Status</dt><dd><StatusDot status={task?.status ?? "idle"} /></dd></div>
      <div><dt>Modelo</dt><dd>{task?.routing ? task.routing.modelName : task?.engine === "local" ? "Ferramenta local (sem LLM)" : configured?.name ?? "Automático (decidido pelo Orquestrador)"}</dd></div>
      <div><dt>Provedor</dt><dd>{task?.routing ? `${task.routing.providerName} · ${COST_LABEL[task.routing.cost]}` : configured ? `${configured.providerName} · ${COST_LABEL[configured.cost]}` : "—"}</dd></div>
      {task?.routing?.effort && <div><dt>Raciocínio</dt><dd>{task.routing.effort}</dd></div>}
      <div><dt>Skills carregadas</dt><dd>{task?.skills?.length ? task.skills.map(s => s.name).join(", ") : "nenhuma nesta etapa"}</dd></div>
      <div><dt>Missão atual</dt><dd>{mission ? mission.objective.slice(0, 140) : task ? task.title : "sem missão"}</dd></div>
      <div><dt>Etapa atual</dt><dd>{task ? `${task.stage ?? "tarefa"}${task.tool ? ` · usando ${task.tool}` : ""}${task.steps ? ` · ${task.steps} passo(s)` : ""}` : "—"}</dd></div>
      {task?.tokenUsage && <div><dt>Tokens / custo</dt><dd>{task.tokenUsage.totalTokens.toLocaleString("pt-BR")} · US$ {(task.cost ?? 0).toFixed(4)}</dd></div>}
    </dl>
    {task?.routing && <p className="hq-routing">{task.routing.reason}</p>}
    {task?.error && <p className="inline-error" role="alert">{task.error}</p>}
    {live && <div className="hq-panel-content"><button className="hq-text-button" disabled={busy} onClick={() => void action({ action: "task.interrupt", id: task.id })}><Square size={12} />Interromper esta etapa</button></div>}
    {approvals.length > 0 && <details className="hq-detail-section" open><summary>Aprovações pendentes <span>{approvals.length}</span></summary>{approvals.map(a => <p key={a.id} className="hq-warning"><code>{a.action.slice(0, 200)}</code> — decida no cartão de aprovações.</p>)}</details>}
    <details className="hq-detail-section" open><summary>Atividades <span>{events.length}</span></summary>
      {events.length ? events.map(event => <div className="hq-event" key={event.id}><span>{time(event.at)}</span><p><strong>{EVENT_LABEL[event.kind] ?? event.kind}</strong>{event.kind === "localAudit" ? "Resultado da varredura registrado (somente locais e categorias)." : event.text.slice(0, 260)}</p></div>) : <p className="hq-muted">Os eventos reais deste agente aparecerão aqui.</p>}
    </details>
    <details className="hq-detail-section"><summary>Resultado</summary>{task?.result ? <pre className="hq-result">{summaryText(task.result).slice(0, 6000)}</pre> : <p className="hq-muted">Ainda sem resultado.</p>}</details>
    <details className="hq-detail-section"><summary>Arquivos modificados <span>{task?.files.length ?? 0}</span></summary>{task?.files.length ? <ul>{task.files.slice(0, 30).map(file => <li key={file}><FileCode2 size={13} /> {file}</li>)}</ul> : <p className="hq-muted">Nenhum arquivo alterado.</p>}</details>
    <details className="hq-detail-section"><summary>Resultados recebidos <span>{received.length}</span></summary>{received.length ? received.map(c => <div className="hq-event" key={c.id}><span>{time(c.at)}</span><p><strong>{name(c.from)} → {agent.name}</strong>{c.state === "delivered" ? "Entregue" : "Aguardando início"} · {summaryText(c.content).slice(0, 220)}</p></div>) : <p className="hq-muted">Nenhuma entrega de outros agentes.</p>}</details>
    <details className="hq-detail-section"><summary>Histórico de tarefas <span>{history.length}</span></summary>{history.map(t => <div className="hq-event" key={t.id}><span>{new Date(t.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span><p><strong>{t.title.slice(0, 70)}</strong><StatusDot status={t.status} />{t.routing ? ` · ${t.routing.modelName}` : ""}</p></div>)}</details>
    <div className="hq-panel-content"><button className="hq-text-button" onClick={goAgents}>Configurar modelo, skills e instruções deste agente →</button></div>
  </aside>;
}
