"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Cpu, RotateCw, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import type { TabProps } from "./workspace-dashboard";
import { StatusDot } from "./workspace-dashboard";
import { COST_LABEL, PROFILE_HELP, PROFILE_LABEL, TIER_LABEL } from "@/lib/cost";
import type { MissionPlan, Profile, SkillInfo, Task } from "@/lib/types";

const EXAMPLES = [
  "Analise este projeto, deixe os comentários em português e explique como o código funciona para outro desenvolvedor.",
  "Verifique se existe alguma chave de API, senha ou informação sensível exposta.",
  "Melhore a interface do sistema e deixe mais moderna, sem alterar as funcionalidades.",
  "Execute uma análise simples utilizando apenas modelos gratuitos.",
];
const COMPLEXITY = { low: "baixa", medium: "média", high: "alta" };

// Nova missão em dois passos: (1) você escreve; (2) o Orquestrador mostra o plano
// real — agentes, modelos e skills, com o motivo de cada escolha — e você pode
// substituir qualquer decisão antes de iniciar.
export function MissionComposer({ snapshot, catalog, busy, request, close, created }: TabProps & { close: () => void; created: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [objective, setObjective] = useState("");
  const [cwd, setCwd] = useState(snapshot.workspace);
  const [profile, setProfile] = useState<Profile>(snapshot.settings?.profile ?? "economic");
  const [allowWrite, setAllowWrite] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [plan, setPlan] = useState<MissionPlan>();
  const [agents, setAgents] = useState<string[]>();
  const [models, setModels] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<Record<string, string[]>>({});
  const [skillList, setSkillList] = useState<SkillInfo[]>([]);
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  useEffect(() => { fetch("/api/hq/skills").then(r => r.json()).then(d => setSkillList(d.skills ?? [])).catch(() => undefined); }, []);
  const overrides = () => ({ ...(agents ? { agents } : {}), ...(Object.keys(models).length ? { models } : {}), ...(Object.keys(skills).length ? { skills } : {}) });
  async function analyze(next?: { agents?: string[]; models?: Record<string, string>; skills?: Record<string, string[]> }) {
    const merged = { ...overrides(), ...next };
    const result = await request<MissionPlan>({ action: "mission.plan", objective, cwd, profile, allowWrite, overrides: merged });
    if (result) setPlan(result);
  }
  async function start() {
    if (await request({ action: "mission.create", objective, cwd, profile, allowWrite, maxAttempts: 1, ...(teamId ? { teamId } : { overrides: overrides() }) })) created();
  }
  const catalogAgents = (snapshot.agentCatalog ?? snapshot.agents).filter(a => !a.archived);
  const name = (id: string) => catalogAgents.find(a => a.id === id)?.name ?? id;
  const usable = catalog.models.filter(m => m.chat && !m.blocked);
  const llmStages = plan?.stages.filter(s => s.engine === "llm") ?? [];
  const selectedAgents = [...new Set(plan?.stages.map(s => s.agentId) ?? [])];
  const blocked = llmStages.some(s => s.routingError);
  function toggleAgent(id: string) {
    const next = selectedAgents.includes(id) ? selectedAgents.filter(a => a !== id) : [...selectedAgents, id];
    setAgents(next); void analyze({ agents: next });
  }
  return <dialog className="hq-dialog hq-composer-dialog" ref={dialog} onCancel={close} onClose={close}>
    <div className="hq-composer-title"><h2>{plan ? "Plano do Orquestrador" : "Nova missão"}</h2><button className="hq-button hq-icon" aria-label="Fechar" onClick={close}><X size={17} /></button></div>
    {!plan && <form className="hq-composer" onSubmit={event => { event.preventDefault(); if (teamId) void start(); else void analyze(); }}>
      <label>O que a equipe deve fazer?<textarea value={objective} onChange={e => setObjective(e.target.value)} required rows={4} maxLength={12000} autoFocus placeholder="Descreva a missão em linguagem natural…" /></label>
      <div className="hq-chips">{EXAMPLES.map(example => <button type="button" key={example} className="hq-chip" onClick={() => setObjective(example)}>{example.slice(0, 46)}…</button>)}</div>
      <label>Pasta do projeto (workspace autorizado)<input value={cwd} onChange={e => setCwd(e.target.value)} required maxLength={1000} /></label>
      <div className="mission-options">
        <label>Perfil<select value={profile} onChange={e => setProfile(e.target.value as Profile)}>{(Object.keys(PROFILE_LABEL) as Profile[]).map(p => <option key={p} value={p}>{PROFILE_LABEL[p]}</option>)}</select></label>
        <label>Quem executa<select value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">Orquestrador escolhe os agentes</option>{snapshot.teams?.map(team => <option key={team.id} value={team.id}>Time: {team.name} ({team.agentIds.length})</option>)}</select></label>
      </div>
      <p className="field-help">{PROFILE_HELP[profile]}</p>
      <label className="mission-write"><input type="checkbox" checked={allowWrite} onChange={e => setAllowWrite(e.target.checked)} /> Permitir edição de arquivos neste workspace (cada alteração ainda pede a sua aprovação)</label>
      <p className="hq-form-note"><ShieldCheck size={15} /> {snapshot.settings?.freeOnly ? "Somente modelos gratuitos: nenhuma chamada paga será feita." : "A política de custo zero está desligada nas Configurações."} Deploys e ações destrutivas nunca rodam sem a sua autorização.</p>
      <div className="hq-actions"><button type="button" className="hq-button" onClick={close}>Cancelar</button><button className="hq-button primary" disabled={busy || !objective.trim()}><ArrowRight size={14} />{teamId ? "Delegar ao time" : "Analisar missão"}</button></div>
    </form>}
    {plan && <div className="hq-plan">
      <p className="hq-plan-objective">“{objective.slice(0, 300)}”</p>
      <div className="hq-plan-facts">
        <span className="hq-pill">Intenção: {plan.intents.map(i => i.label).join(", ")}</span><span className="hq-pill">Complexidade {COMPLEXITY[plan.complexity]}</span>
        <span className="hq-pill">{plan.llmCalls} etapa(s) com IA</span><span className="hq-pill">{plan.localSteps} etapa(s) locais sem LLM</span><span className="hq-pill">{PROFILE_LABEL[profile]}</span>
      </div>
      <p className="hq-plan-summary">{plan.summary}</p>
      {plan.warnings.map((warning, i) => <p className="inline-error" key={i} role="alert">{warning}</p>)}
      <h3>Agentes selecionados <small>(marque ou desmarque para substituir a escolha)</small></h3>
      <div className="hq-chips">{catalogAgents.filter(a => a.id !== "reporter").map(a => <label key={a.id} className={`hq-chip ${selectedAgents.includes(a.id) ? "on" : ""}`}><input type="checkbox" checked={selectedAgents.includes(a.id)} disabled={busy || a.id === "orchestrator"} onChange={() => toggleAgent(a.id)} />{a.name}</label>)}</div>
      <h3>Etapas, modelos e skills</h3>
      <ol className="hq-plan-stages">{plan.stages.map(stage => <li key={stage.key} className={stage.routingError ? "error" : ""}>
        <div className="hq-plan-stage-head"><strong>{name(stage.agentId)}</strong>
          {stage.engine === "local" ? <span className="hq-pill"><Wrench size={11} />Ferramenta local · 0 tokens</span> : stage.routing ? <span className={`hq-pill cost-${stage.routing.cost}`}><Cpu size={11} />{stage.routing.modelName} · {COST_LABEL[stage.routing.cost]}</span> : <span className="hq-pill cost-unavailable">Sem modelo</span>}
          {stage.write && <span className="hq-pill">pode editar</span>}{stage.dependsOn.length === 0 ? <span className="hq-pill">início</span> : <span className="hq-pill">após: {stage.dependsOn.join(", ")}</span>}</div>
        <p>{stage.goal}</p>
        <small>Por quê: {stage.reason}{stage.routing ? ` ${stage.routing.reason}` : ""}{stage.engine === "llm" ? ` Porte da etapa: ${TIER_LABEL[stage.weight]}.` : ""}</small>
        {stage.routingError && <small className="hq-warning">{stage.routingError}</small>}
        {stage.engine === "llm" && <div className="hq-plan-controls">
          <label>Modelo<select value={models[stage.agentId] ?? ""} disabled={busy} onChange={e => { const next = { ...models }; if (e.target.value) next[stage.agentId] = e.target.value; else delete next[stage.agentId]; setModels(next); void analyze({ models: next }); }}>
            <option value="">Automático ({stage.routing?.modelName ?? "indisponível"})</option>{usable.map(m => <option key={m.key} value={m.key}>{m.name} — {m.providerName} · {COST_LABEL[m.cost]}</option>)}</select></label>
          <div className="hq-plan-skills"><Sparkles size={12} />{stage.skills.length ? stage.skills.map(s => <span key={s.id} className="hq-chip on" title={`Motivo: ${s.matched?.join(", ")}`}>{s.name}<button type="button" aria-label={`Remover ${s.name}`} disabled={busy} onClick={() => { const next = { ...skills, [stage.agentId]: stage.skills.filter(k => k.id !== s.id).map(k => k.id) }; setSkills(next); void analyze({ skills: next }); }}>×</button></span>) : <span className="hq-muted">nenhuma skill</span>}
            <select value="" disabled={busy || stage.skills.length >= 4} aria-label="Adicionar skill" onChange={e => { if (!e.target.value) return; const next = { ...skills, [stage.agentId]: [...stage.skills.map(k => k.id), e.target.value] }; setSkills(next); void analyze({ skills: next }); }}>
              <option value="">+ skill</option>{skillList.filter(s => s.enabled && !stage.skills.some(k => k.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        </div>}
      </li>)}</ol>
      <div className="hq-actions"><button className="hq-button" onClick={() => setPlan(undefined)}>Voltar e editar</button><button className="hq-button primary" disabled={busy || blocked} onClick={() => void start()}><ArrowRight size={14} />Iniciar missão</button></div>
      {blocked && <p className="field-help">Conecte um provedor gratuito em “Modelos e Provedores” (ou escolha outro modelo acima) para iniciar. Nada pago será usado automaticamente.</p>}
    </div>}
  </dialog>;
}

const MISSION_STATUS = { running: "Em execução", completed: "Concluída", blocked: "Bloqueada", cancelled: "Cancelada" };
// Aba Missões: o que está acontecendo agora, etapa por etapa.
export function MissionsTab({ snapshot, busy, action, openTask }: TabProps & { openTask: (task: Task) => void }) {
  const missions = (snapshot.missions ?? []).slice(0, 12);
  const name = (id: string) => (snapshot.agentCatalog ?? snapshot.agents).find(a => a.id === id)?.name ?? id;
  if (!missions.length) return <div className="command-panel large-empty"><h3>Nenhuma missão ainda</h3><p>Clique em “Nova missão”, descreva o que precisa e o Orquestrador monta a equipe.</p></div>;
  return <div className="hq-stack">{missions.map(mission => {
    const tasks = snapshot.tasks.filter(t => t.missionId === mission.id).reverse();
    const cost = tasks.reduce((sum, t) => sum + (t.cost ?? 0), 0), tokens = tasks.reduce((sum, t) => sum + (t.tokenUsage?.totalTokens ?? 0), 0);
    return <section className="command-panel" key={mission.id}>
      <div className="panel-toolbar"><div><h2>{mission.objective.slice(0, 110)}</h2><p className="field-help">{MISSION_STATUS[mission.status]} · {PROFILE_LABEL[mission.profile]} · {mission.allowWrite ? "edição autorizada" : "somente leitura"} · {tokens.toLocaleString("pt-BR")} tokens · custo US$ {cost.toFixed(4)}{mission.automationId ? " · criada por automação" : ""}</p></div>
        <div className="hq-actions">
          {mission.status === "running" && <button className="hq-button" disabled={busy} onClick={() => void action({ action: "mission.cancel", id: mission.id })}>Cancelar</button>}
          {["blocked", "cancelled"].includes(mission.status) && tasks.some(t => ["failed", "interrupted", "cancelled"].includes(t.status)) && <button className="hq-button primary" disabled={busy} onClick={() => void action({ action: "mission.retry", id: mission.id })}><RotateCw size={14} />Retomar missão</button>}
        </div></div>
      {mission.plan && <p className="hq-plan-summary">{mission.plan.summary}</p>}
      {mission.blockers.map((blocker, i) => <p className="inline-error" key={i}>{blocker}</p>)}
      <div className="mission-steps">{tasks.map(task => <button className="mission-step" key={task.id} onClick={() => openTask(task)}>
        <span><strong>{name(task.agentId)} <small>· {task.stage ?? "etapa"}{(task.attempt ?? 0) > 0 ? ` · correção ${task.attempt}` : ""}</small></strong>
          <small>{task.engine === "local" ? "Ferramenta local (sem LLM)" : task.routing ? `${task.routing.modelName} · ${COST_LABEL[task.routing.cost]}` : "modelo definido ao iniciar"}{task.skills?.length ? ` · skills: ${task.skills.map(s => s.name).join(", ")}` : ""}</small>
          {task.error && <small className="hq-warning">{task.error.slice(0, 200)}</small>}</span><StatusDot status={task.status} /></button>)}</div>
      {mission.report && <details className="mission-report"><summary>Relatório final</summary><pre>{mission.report}</pre></details>}
    </section>;
  })}</div>;
}
