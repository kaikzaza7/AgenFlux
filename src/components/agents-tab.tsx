"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot } from "lucide-react";
import type { TabProps } from "./workspace-dashboard";
import { COST_LABEL } from "@/lib/cost";
import { LOOKS, drawSprite } from "@/lib/pixel/sprites";
import { latestTask, type Agent, type AgentSettings, type SkillInfo } from "@/lib/types";

export function SpritePreview({ sprite, size = 3 }: { sprite: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const ctx = ref.current?.getContext("2d"); if (!ctx) return; ctx.clearRect(0, 0, 16, 20); drawSprite(ctx, sprite, "down", 0, 0, 0); }, [sprite]);
  return <canvas ref={ref} width={16} height={20} className="sprite-preview" style={{ width: 16 * size, height: 20 * size }} aria-hidden="true" />;
}

function AgentCard({ agent, settings, skills, seat, snapshot, catalog, busy, action }: TabProps & { agent: Agent; settings?: AgentSettings; skills: SkillInfo[]; seat: number }) {
  const [open, setOpen] = useState(false);
  const [modelKey, setModelKey] = useState(settings?.modelKey ?? "");
  const [fallbackKey, setFallbackKey] = useState(settings?.fallbackKey ?? "");
  const [effort, setEffort] = useState(settings?.effort ?? "");
  const [maxSteps, setMaxSteps] = useState(String(settings?.maxSteps ?? ""));
  const [maxAttempts, setMaxAttempts] = useState(String(settings?.maxAttempts ?? 2));
  const [allowed, setAllowed] = useState<string[]>(settings?.skills ?? ["*"]);
  const usable = catalog.models.filter(m => m.chat && !m.blocked);
  const model = catalog.models.find(m => m.key === modelKey);
  const task = latestTask(snapshot.tasks.filter(t => t.mode === "real"), agent.id);
  const history = snapshot.tasks.filter(t => t.agentId === agent.id && t.mode === "real").length;
  const stale = settings?.modelKey && !catalog.models.some(m => m.key === settings.modelKey);
  return <article className="agent-card" data-archived={agent.archived ? "" : undefined}>
    <div className="agent-card-head"><SpritePreview sprite={agent.sprite ?? 0} /><div><h3><i style={{ background: agent.color }} />{agent.name}</h3><p>{agent.role}</p>
      <small>{seat >= 0 ? `Estação ${seat + 1}` : agent.archived ? "Arquivado" : "Fora do escritório"} · {history} tarefa(s) no histórico · {model ? `${model.name} (${COST_LABEL[model.cost]})` : "modelo automático"}{task ? ` · última: ${task.status}` : ""}</small></div>
      <button className="hq-button" onClick={() => setOpen(o => !o)}>{open ? "Fechar" : "Configurar"}</button></div>
    {stale && <p className="hq-warning">O modelo salvo ({settings!.modelKey}) não está no catálogo atual; o Orquestrador escolherá automaticamente até o provedor voltar.</p>}
    {open && <>
      <form className="mission-form" onSubmit={async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const data = new FormData(e.currentTarget); await action({ action: "agent.update", id: agent.id, name: data.get("name"), role: data.get("role"), instructions: data.get("instructions"), color: data.get("color"), sprite: Number(data.get("sprite")) }); }}>
        <div className="mission-options"><label>Nome<input name="name" defaultValue={agent.name} required maxLength={32} /></label><label>Função<input name="role" defaultValue={agent.role} required maxLength={100} /></label></div>
        <label>Instruções próprias<textarea name="instructions" defaultValue={agent.instructions} required rows={4} maxLength={8000} /></label>
        <div className="mission-options"><label>Cor<input name="color" type="color" defaultValue={agent.color} /></label><label>Personagem<select name="sprite" defaultValue={agent.sprite ?? 0}>{LOOKS.map((_, i) => <option key={i} value={i}>Personagem {i + 1}</option>)}</select></label></div>
        <div className="hq-actions"><button className="button" disabled={busy}>Salvar perfil</button>
          {!["orchestrator"].includes(agent.id) && <button type="button" className="text-button" disabled={busy} onClick={() => void action({ action: "agent.update", id: agent.id, archived: !agent.archived })}>{agent.archived ? "Reativar agente" : "Arquivar agente"}</button>}</div>
      </form>
      <form className="mission-form" onSubmit={async e => { e.preventDefault(); await action({ action: "agent.settings", id: agent.id, modelKey, fallbackKey, effort, maxSteps, maxAttempts, skills: allowed }); }}>
        <h4>Modelo e limites</h4>
        <div className="mission-options">
          <label>Modelo de IA<select value={modelKey} onChange={e => { setModelKey(e.target.value); setEffort(""); }}><option value="">Automático (Orquestrador decide)</option>{usable.map(m => <option key={m.key} value={m.key}>{m.name} — {m.providerName} · {COST_LABEL[m.cost]}{m.toolCall ? "" : " · sem ferramentas"}</option>)}</select></label>
          <label>Modelo alternativo<select value={fallbackKey} onChange={e => setFallbackKey(e.target.value)}><option value="">Nenhum (seleção automática)</option>{usable.filter(m => m.key !== modelKey).map(m => <option key={m.key} value={m.key}>{m.name} — {COST_LABEL[m.cost]}</option>)}</select></label>
        </div>
        <div className="mission-options">
          {model && model.efforts.length > 0 ? <label>Nível de raciocínio<select value={effort} onChange={e => setEffort(e.target.value)}><option value="">Conforme o perfil</option>{model.efforts.map(e => <option key={e} value={e}>{e}</option>)}</select></label>
            : <p className="field-help">{model ? "Este modelo não oferece níveis de raciocínio." : "Escolha um modelo para ver os níveis de raciocínio que ele suporta."}</p>}
          <label>Máximo de etapas por tarefa<input type="number" min={1} max={300} value={maxSteps} onChange={e => setMaxSteps(e.target.value)} placeholder="sem limite" /></label>
          <label>Tentativas (troca de modelo em limite de uso)<input type="number" min={1} max={4} value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} /></label>
        </div>
        <p className="field-help">Concorrência: cada agente executa uma tarefa por vez (uma estação por agente). O total simultâneo fica em Configurações. Ferramentas e permissões são definidas por missão: leitura por padrão; edição só quando você autoriza.</p>
        <h4>Skills permitidas</h4>
        <label className="mission-write"><input type="checkbox" checked={allowed.includes("*")} onChange={e => setAllowed(e.target.checked ? ["*"] : [])} /> Todas as skills ativas (o Orquestrador escolhe as relevantes)</label>
        {!allowed.includes("*") && <div className="hq-chips">{skills.filter(s => s.enabled).map(s => <label key={s.id} className={`hq-chip ${allowed.includes(s.id) ? "on" : ""}`}><input type="checkbox" checked={allowed.includes(s.id)} onChange={e => setAllowed(e.target.checked ? [...allowed, s.id] : allowed.filter(id => id !== s.id))} />{s.name}</label>)}</div>}
        <button className="button primary" disabled={busy}>Salvar modelo e skills</button>
      </form>
    </>}
  </article>;
}

export function AgentsTab(props: TabProps) {
  const { snapshot, busy, action } = props;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  useEffect(() => { fetch("/api/hq/skills").then(r => r.json()).then(d => setSkills(d.skills ?? [])).catch(() => undefined); }, [snapshot.skillsVersion]);
  const all = snapshot.agentCatalog ?? snapshot.agents;
  const seat = (id: string) => snapshot.agents.findIndex(a => a.id === id);
  const sorted = [...all].sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)) || (seat(a.id) < 0 ? 99 : seat(a.id)) - (seat(b.id) < 0 ? 99 : seat(b.id)));
  return <div className="hq-stack">
    <section className="command-panel"><div className="panel-toolbar"><div className="panel-title"><Bot size={17} /><h2>Agentes</h2></div><span className="tiny">{snapshot.agents.length}/8 no escritório</span></div>
      <div className="command-intro"><p>Cada agente tem nome, função, instruções, modelo, nível de raciocínio, skills permitidas, personagem e estação. Deixe o modelo em “Automático” para o Orquestrador escolher por etapa conforme o perfil e a política de custo.</p></div>
      <div className="agent-list">{sorted.map(agent => <AgentCard key={`${agent.id}:${props.catalog.version}`} {...props} agent={agent} settings={snapshot.agentSettings?.find(s => s.id === agent.id)} skills={skills} seat={seat(agent.id)} />)}</div>
    </section>
    <form className="command-panel mission-form" onSubmit={async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); if (await action({ action: "agent.create", name: data.get("name"), role: data.get("role"), instructions: data.get("instructions"), color: data.get("color"), sprite: Number(data.get("sprite")) })) form.reset(); }}>
      <h2>Criar novo agente</h2>
      <div className="mission-options"><label>Nome<input name="name" required maxLength={32} placeholder="Ex.: Especialista em SEO" /></label><label>Função<input name="role" required maxLength={100} placeholder="O que ele faz na equipe" /></label></div>
      <label>Instruções<textarea name="instructions" required rows={3} maxLength={8000} placeholder="Como este agente deve trabalhar, o que priorizar e o que evitar." /></label>
      <div className="mission-options"><label>Cor<input name="color" type="color" defaultValue="#8ba7d4" /></label><label>Personagem<select name="sprite" defaultValue={8}>{LOOKS.map((_, i) => <option key={i} value={i}>Personagem {i + 1}</option>)}</select></label></div>
      <p className="field-help">Depois de criar, coloque-o no escritório pela aba Equipes ou inclua-o manualmente no plano de uma missão.</p>
      <button className="button primary" disabled={busy}>Adicionar ao catálogo</button>
    </form>
  </div>;
}
