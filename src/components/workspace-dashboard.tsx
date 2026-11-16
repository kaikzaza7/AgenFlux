"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bot, CalendarClock, Check, Cpu, History, LayoutGrid, ListTodo, LoaderCircle, Maximize, Minimize, Plus, Settings2, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { Office } from "./office";
import { AgentPanel } from "./agent-panel";
import { MissionComposer, MissionsTab } from "./missions-tab";
import { CommunicationsPanel, MissionPanel } from "./command-center";
import { TeamPanel } from "./team-panel";
import { AgentsTab } from "./agents-tab";
import { ModelsTab } from "./models-tab";
import { SkillsTab } from "./skills-tab";
import { AutomationsTab } from "./automations-tab";
import { SettingsTab } from "./settings-tab";
import { approvalSummary } from "@/lib/approval-summary";
import { latestTask, STATUS_LABEL, type Agent, type Approval, type Catalog, type Snapshot, type Status, type Task } from "@/lib/types";

// Painel principal: navegação superior + as nove abas. O estado chega por
// WebSocket (com reconexão automática) e todas as ações passam por /api/hq/action.

export type Action = (data: Record<string, unknown>) => Promise<boolean>;
export type Request = <T = unknown>(data: Record<string, unknown>) => Promise<T | undefined>;
type Screen = "office" | "missions" | "teams" | "agents" | "models" | "skills" | "automations" | "history" | "settings";
const screens = [
  { id: "office", label: "Escritório", Icon: LayoutGrid },
  { id: "missions", label: "Missões", Icon: ListTodo },
  { id: "teams", label: "Equipes", Icon: Users },
  { id: "agents", label: "Agentes", Icon: Bot },
  { id: "models", label: "Modelos e Provedores", Icon: Cpu },
  { id: "skills", label: "Skills", Icon: Sparkles },
  { id: "automations", label: "Automações", Icon: CalendarClock },
  { id: "history", label: "Histórico", Icon: History },
  { id: "settings", label: "Configurações", Icon: Settings2 },
] as const;
const short = (value: string, size = 120) => value.length > size ? `${value.slice(0, size).trim()}…` : value;
export function StatusDot({ status }: { status: string }) { return <span className={`hq-status ${status}`}><i />{STATUS_LABEL[status as Status] ?? status}</span>; }

function ApprovalCard({ approval, owner, busy, action, compact }: { approval: Approval; owner?: Agent; busy: boolean; action: Action; compact?: boolean }) {
  const blocked = approval.canApprove === false;
  return <article className={compact ? "hq-approval-notice hq-glass" : "hq-approval-card"} role={compact ? "alert" : undefined}>
    <div className="hq-notice-copy">
      <div className="hq-approval-head"><strong>{owner?.name ?? "Agente"} pede aprovação</strong><span className="hq-pill">{approval.kind === "edit" ? "Edição" : approval.kind === "network" ? "Rede" : approval.kind === "command" ? "Comando" : "Ação"}</span></div>
      <p><b>Motivo:</b> {short(approval.reason, 200)}</p>
      <p className="hq-approval-action"><b>Ação pretendida:</b> <code>{short(approval.action, compact ? 160 : 600)}</code></p>
      {approval.risks && <p className="hq-warning"><b>Riscos:</b> {short(approval.risks, 260)}</p>}
      {!compact && <details><summary>Ver detalhes técnicos</summary><pre>{approval.details}</pre></details>}
      {blocked && <small>Aprovação bloqueada pela política da missão: só é possível recusar.</small>}
    </div>
    <div className="hq-actions">
      <button className="hq-button primary" disabled={busy || blocked} onClick={() => void action({ action: "approval.decide", id: approval.id, approve: true })}><Check size={14} />Aprovar</button>
      <button className="hq-button" disabled={busy} onClick={() => void action({ action: "approval.decide", id: approval.id, approve: false })}>Recusar</button>
    </div>
  </article>;
}

export function WorkspaceDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [catalog, setCatalog] = useState<Catalog>({ version: 0, providers: [], models: [] });
  const [screen, setScreen] = useState<Screen>("office");
  const [selected, setSelected] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [compose, setCompose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [demo, setDemo] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | undefined>(undefined);

  useEffect(() => {
    let stopped = false, attempt = 0; let timer: ReturnType<typeof setTimeout>;
    const load = () => fetch("/api/hq/state").then(r => r.ok ? r.json() : Promise.reject(new Error("Não foi possível carregar o estado do AgenFlux."))).then(data => { if (!stopped) setSnapshot(data); }).catch(e => { if (!stopped) setError(e.message); });
    void load();
    function connect() {
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`); socketRef.current = socket;
      socket.onopen = () => { attempt = 0; if (!stopped) setOnline(true); };
      socket.onmessage = event => { try { const message = JSON.parse(event.data); if (message.type === "snapshot" && !stopped) setSnapshot(message.data); } catch { /* quadro inválido é ignorado */ } };
      socket.onerror = () => socket.close();
      // Reconexão com espera crescente; o snapshot completo chega ao reconectar.
      socket.onclose = () => { if (stopped) return; setOnline(false); timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000)); };
    }
    connect();
    return () => { stopped = true; clearTimeout(timer); socketRef.current?.close(); };
  }, []);

  // O catálogo de modelos é grande e muda pouco: buscado à parte, só quando a versão muda.
  const catalogVersion = snapshot?.catalogVersion;
  useEffect(() => {
    if (catalogVersion === undefined) return;
    const controller = new AbortController();
    fetch("/api/hq/catalog", { signal: controller.signal }).then(r => r.json()).then(setCatalog).catch(() => undefined);
    return () => controller.abort();
  }, [catalogVersion]);

  const request: Request = useCallback(async data => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/hq/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível realizar esta ação.");
      if (socketRef.current?.readyState !== WebSocket.OPEN) void fetch("/api/hq/state").then(async next => { if (next.ok) setSnapshot(await next.json()); }).catch(() => undefined);
      return (result.result ?? true) as never;
    } catch (value) { setError((value as Error).message); return undefined; }
    finally { setBusy(false); }
  }, []);
  const action: Action = useCallback(async data => (await request(data)) !== undefined, [request]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.fullscreenElement) setExpanded(false); };
    const onFullscreen = () => { if (!document.fullscreenElement) setExpanded(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("fullscreenchange", onFullscreen);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFullscreen); };
  }, [expanded]);
  function toggleFullscreen() {
    if (expanded) { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); setExpanded(false); return; }
    setExpanded(true);
    if (stage.current?.requestFullscreen && document.fullscreenEnabled) void stage.current.requestFullscreen().catch(() => undefined);
  }

  const mode = demo ? "demo" : "real";
  const tasks = useMemo(() => (snapshot?.tasks ?? []).filter(task => task.mode === mode), [snapshot?.tasks, mode]);
  if (!snapshot) return <div className="hq-loading">{error || <><LoaderCircle className="hq-spin" size={20} />Carregando o escritório…</>}</div>;

  const agents = snapshot.agents;
  const owners = snapshot.agentCatalog ?? agents;
  const approvals = snapshot.approvals.filter(a => a.state === "pending").sort((a, b) => a.at.localeCompare(b.at));
  const agent = agents.find(item => item.id === selected);
  const running = agents.filter(item => ["running", "approval"].includes(latestTask(tasks, item.id)?.status ?? "")).length;
  const activeMission = snapshot.missions?.find(m => m.status === "running");
  const engines = snapshot.engines ?? [];
  const connected = engines.filter(e => e.status === "connected" && e.id !== "local");
  const freeModels = catalog.models.filter(m => m.chat && !m.blocked).length;
  const go = (next: Screen) => { setScreen(next); window.scrollTo({ top: 0 }); };
  const openTask = (task: Task) => { setSelected(task.agentId); setPanelOpen(true); setDemo(task.mode === "demo"); go("office"); };
  const common = { snapshot, catalog, busy, action, request };

  return <div className="hq-app" data-expanded={expanded || undefined}>
    <header className="hq-topbar" inert={expanded}>
      <div className="hq-top-inner">
        <a className="hq-brand" href="/"><span className="hq-brand-logo" aria-hidden="true" />AgenFlux</a>
        <nav className="hq-nav" aria-label="Navegação principal">
          {screens.map(({ id, label, Icon }) => <button key={id} className="hq-button" aria-current={screen === id ? "page" : undefined} onClick={() => go(id)} title={label}>
            <Icon size={15} aria-hidden="true" /><span>{label}</span>
          </button>)}
        </nav>
        <div className="hq-top-actions">
          <button className="hq-button hq-connect" onClick={() => go("models")} title="Abrir Modelos e Provedores">
            <i className={connected.length ? "connected" : ""} />{connected.length ? `${connected.map(e => e.name.split(" ")[0]).join(" + ")} • ${freeModels} modelo(s)` : "Conectar um motor"}
          </button>
          <button className="hq-button hq-icon" aria-label={`Aprovações${approvals.length ? `, ${approvals.length} pendentes` : ""}`} onClick={() => { go("office"); setTimeout(() => document.getElementById("hq-approvals")?.scrollIntoView({ behavior: "smooth" }), 50); }}>
            <Bell size={16} />{approvals.length > 0 && <b>{approvals.length}</b>}
          </button>
        </div>
      </div>
    </header>
    {error && <div className="hq-error" role="alert"><span>{error}</span><button className="hq-button hq-icon" aria-label="Fechar alerta" onClick={() => setError("")}><X size={15} /></button></div>}
    <main className="hq-layout" data-screen={screen}>
      {screen === "office" && <>
        <div className="hq-office-bar" inert={expanded}>
          <div className="hq-office-status">
            <span className="hq-live" role="status"><i className={online ? "connected" : ""} />{online ? "Tempo real" : "Reconectando…"}</span>
            <span className="hq-pill">{agents.length}/8 estações</span><span className="hq-pill">{running} em atividade</span>
            {snapshot.settings?.freeOnly && <span className="hq-pill free"><ShieldCheck size={12} />Somente modelos gratuitos</span>}
            {activeMission && <span className="hq-pill mission" title={activeMission.objective}>Missão: {short(activeMission.objective, 70)}</span>}
            {demo && <span className="hq-pill demo">DEMONSTRAÇÃO (simulada)</span>}
          </div>
          <div className="hq-actions">
            {demo && <button className="hq-button" onClick={() => setDemo(false)}>Voltar ao modo real</button>}
            <button className="hq-button" onClick={toggleFullscreen}><Maximize size={15} />Tela cheia</button>
            <button className="hq-button primary" onClick={() => setCompose(true)}><Plus size={16} />Nova missão</button>
          </div>
        </div>
        <div className="hq-office-layout" data-panel={panelOpen && agent ? "open" : undefined}>
          <section className="hq-office">
            <div ref={stage} className="hq-office-stage" tabIndex={-1}>
              <Office key={mode} agents={agents} tasks={tasks} selected={selected} onSelect={id => { setSelected(id); setPanelOpen(true); }} communications={demo ? [] : snapshot.communications} speed={snapshot.settings?.officeSpeed} dwell={snapshot.settings?.officeDwell} />
              {expanded && <div className="hq-fullscreen-hud">
                <span className="hq-pill">{running} em atividade</span>{activeMission && <span className="hq-pill mission">{short(activeMission.objective, 90)}</span>}
                <button className="hq-button" onClick={toggleFullscreen}><Minimize size={15} />Sair (Esc)</button>
              </div>}
              {expanded && approvals[0] && <ApprovalCard compact approval={approvals[0]} owner={owners.find(a => a.id === approvals[0].agentId)} busy={busy} action={action} />}
            </div>
            <div className="hq-agent-row" inert={expanded} role="list" aria-label="Agentes no escritório">
              {agents.map(item => { const task = latestTask(tasks, item.id); return <button key={item.id} role="listitem" aria-pressed={item.id === selected && panelOpen} onClick={() => { setSelected(item.id); setPanelOpen(true); }}>
                <i style={{ background: item.color }} /><span><strong>{item.name}</strong><small>{task && ["running", "approval", "queued", "waiting", "failed"].includes(task.status) ? STATUS_LABEL[task.status] : item.role}</small></span>
              </button>; })}
            </div>
          </section>
          {panelOpen && agent && <AgentPanel {...common} agent={agent} tasks={tasks} close={() => setPanelOpen(false)} approvals={approvals.filter(a => a.agentId === agent.id)} goAgents={() => go("agents")} />}
        </div>
        <section className="hq-approvals" id="hq-approvals" tabIndex={-1} inert={expanded}>
          <div className="hq-section-head"><h2>Aprovações</h2><span className="hq-pill">{approvals.length ? `${approvals.length} pendente${approvals.length > 1 ? "s" : ""}` : "Tudo em ordem"}</span></div>
          {approvals.length ? approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} owner={owners.find(a => a.id === approval.agentId)} busy={busy} action={action} />) :
            <div className="hq-approval-empty"><ShieldCheck size={18} /><p>Nenhuma solicitação pendente. Comandos, edições e acessos à rede dos agentes aparecem aqui antes de acontecer.</p></div>}
        </section>
      </>}
      {screen !== "office" && <div className="hq-view" key={screen}>
        <div className="hq-hero"><h1>{screens.find(s => s.id === screen)!.label}</h1>{["missions", "history"].includes(screen) && <button className="hq-button primary" onClick={() => setCompose(true)}><Plus size={16} />Nova missão</button>}</div>
        {screen === "missions" && <MissionsTab {...common} openTask={openTask} />}
        {screen === "teams" && <TeamPanel snapshot={snapshot} busy={busy} action={action} />}
        {screen === "agents" && <AgentsTab {...common} />}
        {screen === "models" && <ModelsTab {...common} />}
        {screen === "skills" && <SkillsTab {...common} />}
        {screen === "automations" && <AutomationsTab {...common} />}
        {screen === "history" && <div className="hq-stack"><MissionPanel snapshot={snapshot} action={action} busy={busy} openTask={openTask} /><CommunicationsPanel snapshot={snapshot} openTask={openTask} /></div>}
        {screen === "settings" && <SettingsTab {...common} startDemo={async () => { if (await action({ action: "demo.start" })) { setDemo(true); go("office"); } }} />}
      </div>}
    </main>
    {compose && <MissionComposer {...common} close={() => setCompose(false)} created={() => { setCompose(false); setDemo(false); go("office"); }} />}
    {!expanded && screen !== "office" && approvals[0] && <ApprovalCard compact approval={approvals[0]} owner={owners.find(a => a.id === approvals[0].agentId)} busy={busy} action={action} />}
  </div>;
}
export interface TabProps { snapshot: Snapshot; catalog: Catalog; busy: boolean; action: Action; request: Request }
export { approvalSummary };
