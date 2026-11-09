"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Bell, Check, FileCode2, FlaskConical, History, LayoutGrid, LoaderCircle, Maximize, Plus, Radio, Settings2, ShieldCheck, Square, Users, X } from "lucide-react";
import { Office } from "./office";
import { AISettings, CommunicationsPanel, MissionPanel } from "./command-center";
import { TeamPanel } from "./team-panel";
import { EccLibrary } from "./ecc-library";
import { agentInitials } from "@/lib/team";
import { approvalSummary } from "@/lib/approval-summary";
import { latestTask, STATUS_LABEL, type Agent, type Approval, type Mode, type Snapshot, type Task } from "@/lib/types";

type Screen = "office" | "history" | "team" | "settings";
type Action = (data: Record<string, unknown>) => Promise<boolean>;
const statusText: Record<string, string> = { running: "Trabalhando", approval: "Aguardando aprovação", queued: "Na fila", waiting: "Aguardando dependência", completed: "Concluído", failed: "Erro", interrupted: "Interrompido", idle: "Disponível" };
const short = (value: string, size = 120) => value.length > size ? `${value.slice(0, size).trim()}…` : value;
const time = (value: string) => new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
function Avatar({ agent, small = false }: { agent: Agent; small?: boolean }) { return <span className={`hq-avatar ${small ? "small" : ""}`}>{agentInitials(agent)}</span>; }
function Status({ status }: { status: string }) { return <span className={`hq-status ${status}`}><i />{statusText[status] ?? STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}</span>; }
function ApprovalNotice({ approval, owner, busy, demo, action, error }: {
  approval: Approval; owner?: Agent; busy: boolean; demo: boolean; action: Action; error: string;
}) {
  return <section className="hq-approval-notice hq-glass" aria-label="Pedido de aprovação">
    <div className="hq-notice-copy" role="alert" aria-atomic="true">
      <h2>{owner?.name ?? "Agente"}</h2>
      <p>{approvalSummary(approval)}</p>
      {demo && <small>Demonstração</small>}
      {approval.canApprove === false && <small>Aprovação bloqueada pela política da missão.</small>}
    </div>
    <div className="hq-actions">
      <button className="hq-button primary" disabled={busy || approval.canApprove === false} onClick={() => void action({ action: "approval.decide", id: approval.id, approve: true })}>Aprovar</button>
      <button className="hq-button" disabled={busy} onClick={() => void action({ action: "approval.decide", id: approval.id, approve: false })}>Recusar</button>
    </div>
    {error && <p className="hq-notice-error" role="alert">{error}</p>}
  </section>;
}

function ApprovalCard({ approval, owner, task, busy, action }: { approval: Approval; owner?: Agent; task?: Task; busy: boolean; action: Action }) {
  return <article className="hq-approval-card"><div className="hq-approval-head"><span className="hq-approval-agent">{owner && <Avatar agent={owner} small />}<span>{owner?.name ?? "Agente"}</span></span><span className="hq-risk">Revisar</span></div><strong>{approvalSummary(approval)}</strong><p>{short(approval.reason || task?.title || "O agente aguarda sua decisão.")}</p><details><summary>Ver contexto</summary><p>{short(approval.details, 320)}</p>{approval.risks && <p className="hq-warning">Risco: {short(approval.risks, 160)}</p>}</details><div className="hq-actions"><button className="hq-button approve" disabled={busy || approval.canApprove === false} onClick={() => void action({ action: "approval.decide", id: approval.id, approve: true })}><Check size={14} />Aprovar</button><button className="hq-button quiet" disabled={busy} onClick={() => void action({ action: "approval.decide", id: approval.id, approve: false })}>Recusar</button></div></article>;
}

function Composer({ snapshot, mode, busy, action, close }: { snapshot: Snapshot; mode: Mode; busy: boolean; action: Action; close: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const data = mode === "real" ? { action: "mission.create", objective: form.get("objective"), cwd: form.get("cwd"), profile: "balanced", maxAttempts: 1, allowWrite: false } : { action: "task.create", mode: "demo", agentId: form.get("agentId"), title: form.get("title"), prompt: form.get("objective"), cwd: snapshot.workspace }; if (await action(data)) close(); }
  return <form className="hq-composer" onSubmit={submit}><div className="hq-composer-title"><div><h2>{mode === "real" ? "O que sua equipe precisa investigar?" : "Cenário de demonstração"}</h2></div><button type="button" className="hq-icon" aria-label="Fechar" onClick={close}><X size={17} /></button></div><label>{mode === "real" ? "Objetivo" : "Tarefa"}<textarea name="objective" required rows={3} maxLength={12000} placeholder="Analise o projeto e produza um relatório curto em português, sem modificar arquivos." /></label>{mode === "demo" && <><label>Título<input name="title" required maxLength={120} placeholder="Cenário visual" /></label><label>Agente<select name="agentId" defaultValue={snapshot.agents[0]?.id}>{snapshot.agents.map(agent => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label></>}{mode === "real" && <label>Workspace autorizado<input name="cwd" defaultValue={snapshot.workspace} required maxLength={1000} /></label>}<p className="hq-form-note"><ShieldCheck size={15} />{mode === "real" ? "A missão inicia em leitura. Ações sensíveis ficam paradas nas aprovações." : "Os eventos são identificados como demonstração."}</p><div className="hq-actions"><button type="button" className="hq-button quiet" onClick={close}>Cancelar</button><button className="hq-button primary" disabled={busy || (mode === "real" && !snapshot.connection.authenticated)}><ArrowRight size={14} />Delegar</button></div></form>;
}

function Detail({ agent, task, events, mode, busy, interrupt }: { agent?: Agent; task?: Task; events: Snapshot["events"]; mode: Mode; busy: boolean; interrupt: () => void }) {
  if (!agent) return <div className="hq-empty"><Users size={20} /><p>Selecione um agente no escritório.</p></div>;
  const history = events.filter(event => event.agentId === agent.id && (!task || event.taskId === task.id)).slice(0, 8);
  return <div className="hq-detail"><div className="hq-detail-head"><div className="hq-agent-title"><Avatar agent={agent} /><div><h2>{agent.name}</h2><p>{agent.role}, {task?.effectiveModel ?? task?.configuration?.model ?? "gpt-5.6-luna"}, esforço {task?.effectiveEffort ?? task?.configuration?.effort ?? "baixo / médio"}</p></div></div><Status status={task?.status ?? "idle"} /></div><section className="hq-detail-task"><h3>{task?.title ?? "Pronto para a próxima missão"}</h3><p>{short(task?.prompt ?? "Este agente está disponível para receber uma etapa real.", 220)}</p>{task && ["running", "approval", "queued"].includes(task.status) && <button className="hq-text-button" disabled={busy} onClick={interrupt}><Square size={12} />Interromper</button>}</section><details className="hq-detail-section" open><summary>Histórico recente <span>{history.length}</span></summary>{history.length ? history.map(event => <div className="hq-event" key={event.id}><span>{time(event.at)}</span><p><strong>{event.kind === "started" ? "Execução iniciada" : event.kind === "completed" ? "Concluído" : event.kind === "approval" ? "Aprovação solicitada" : "Atualização"}</strong>{short(event.text, 160)}</p></div>) : <p className="hq-muted">Os eventos reais aparecerão aqui.</p>}</details><details className="hq-detail-section"><summary>Resultado e arquivos</summary>{task?.result && <p className="hq-result-summary">{short(task.result, 260)}</p>}{task?.files.length ? <ul>{task.files.slice(0, 8).map(file => <li key={file}><FileCode2 size={13} />{file}</li>)}</ul> : <p className="hq-muted">Nenhum arquivo informado.</p>}</details>{mode === "demo" && <p className="hq-demo-label"><FlaskConical size={13} />Agente simulado nesta visão</p>}</div>;
}

const screens = [
  { id: "office", label: "Escritório", Icon: LayoutGrid, description: "Acompanhe seus agentes e as missões em andamento." },
  { id: "history", label: "Histórico", Icon: History, description: "Encontre uma missão e leia o que a equipe entregou." },
  { id: "team", label: "Time", Icon: Users, description: "Monte equipes por especialidade e escolha quem ocupa o escritório." },
  { id: "settings", label: "Configurações", Icon: Settings2, description: "Organize a conexão, os modelos e os perfis da equipe." },
] as const;

export function WorkspaceDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [screen, setScreen] = useState<Screen>("office");
  const [mode, setMode] = useState<Mode>("real");
  const [selected, setSelected] = useState("analyst");
  const [compose, setCompose] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [resolved, setResolved] = useState<string[]>([]);
  const nav = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const composerDialog = useRef<HTMLDialogElement>(null);
  const nativeFullscreen = useRef(false);
  const activeSocket = useRef<WebSocket | undefined>(undefined);
  const actionLock = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    let receivedLiveState = false;
    fetch("/api/hq/state").then(response => {
      if (!response.ok) throw new Error("Não foi possível carregar o estado do AgenFlux.");
      return response.json();
    }).then(data => {
      if (!stopped && !receivedLiveState) setSnapshot(data);
    }).catch(value => { if (!stopped && !receivedLiveState) setError(value.message); });
    function connect() {
      const socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);
      activeSocket.current = socket;
      socket.onopen = () => { attempt = 0; if (!stopped) setOnline(true); };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "snapshot" && !stopped) {
            receivedLiveState = true;
            setSnapshot(message.data);
          }
        } catch { /* Quadro inválido é ignorado. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (stopped) return;
        setOnline(false);
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000));
      };
    }
    connect();
    return () => { stopped = true; clearTimeout(timer); activeSocket.current?.close(); };
  }, []);

  const ready = Boolean(snapshot);
  useEffect(() => {
    const bar = nav.current;
    if (!bar) return;
    function align() {
      const current = bar?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!bar || !current) return;
      bar.style.setProperty("--tab-x", current.offsetLeft + "px");
      bar.style.setProperty("--tab-y", current.offsetTop + "px");
      bar.style.setProperty("--tab-width", current.offsetWidth + "px");
      bar.style.setProperty("--tab-height", current.offsetHeight + "px");
      bar.dataset.ready = "true";
    }
    align();
    const observer = new ResizeObserver(align);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [screen, ready]);

  function resetExpanded() {
    nativeFullscreen.current = false;
    setExpanded(false);
    requestAnimationFrame(() => expandButton.current?.focus({ preventScroll: true }));
  }
  async function closeFullscreen() {
    if (document.fullscreenElement === stage.current) {
      try { await document.exitFullscreen(); }
      catch { return; }
    }
    resetExpanded();
  }
  function openFullscreen() {
    setExpanded(true);
    const target = stage.current;
    if (target?.requestFullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
      void target.requestFullscreen().catch(() => { /* Mantém a expansão dentro da janela. */ });
    }
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }
  useEffect(() => {
    if (!expanded) return;
    function onFullscreen() {
      if (document.fullscreenElement === stage.current) nativeFullscreen.current = true;
      else if (nativeFullscreen.current) resetExpanded();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.fullscreenElement) resetExpanded();
    }
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("keydown", onKey);
    onFullscreen();
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);
  useEffect(() => {
    const dialog = composerDialog.current;
    if (compose && dialog && !dialog.open) dialog.showModal();
  }, [compose]);

  const action: Action = async data => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hq/action", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) {
        const teamAction = ["agent.import", "office.set", "team.save", "team.use"].includes(String(data.action));
        if (teamAction && result.error === "Ação desconhecida.") {
          throw new Error("O servidor em execução é de uma versão anterior. Encerre-o com Ctrl+C, rode npm run dev na pasta atualizada e abra o endereço exibido no terminal.");
        }
        throw new Error(result.error ?? "Não foi possível realizar esta ação.");
      }
      if (activeSocket.current?.readyState !== WebSocket.OPEN) {
        void fetch("/api/hq/state").then(async next => {
          if (next.ok && activeSocket.current?.readyState !== WebSocket.OPEN) setSnapshot(await next.json());
        }).catch(() => { /* A reconexão também atualiza o estado. */ });
      }
      return true;
    } catch (value) {
      setError((value as Error).message);
      return false;
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const decisionAction: Action = async data => {
    const ok = await action(data);
    if (ok) setResolved(ids => [...ids, String(data.id)]);
    return ok;
  };

  const agents = snapshot?.agents ?? [];
  const tasks = useMemo(() => (snapshot?.tasks ?? []).filter(task => task.mode === mode), [snapshot?.tasks, mode]);
  const taskModes = new Map(snapshot?.tasks.map(task => [task.id, task.mode]));
  const approvals = (snapshot?.approvals ?? []).filter(a => {
    const taskMode = taskModes.get(a.taskId);
    return a.state === "pending" && !resolved.includes(a.id) &&
      (taskMode === "real" || (taskMode === "demo" && mode === "demo"));
  }).sort((a, b) => a.at.localeCompare(b.at));
  const notice = approvals.find(a => taskModes.get(a.taskId) === "real") ?? approvals[0];
  const owners = [...agents, ...(snapshot?.historicalAgents ?? [])];
  const agent = agents.find(item => item.id === selected) ?? agents[0];
  const task = agent ? latestTask(tasks, agent.id) : undefined;
  const modeTaskIds = new Set(tasks.map(item => item.id));
  const events = (snapshot?.events ?? []).filter(event => modeTaskIds.has(event.taskId));
  const running = agents.filter(item => latestTask(tasks, item.id)?.status === "running").length;
  const view = screens.find(item => item.id === screen)!;

  function go(next: Screen) {
    if (next !== screen) window.scrollTo({ top: 0, behavior: "instant" });
    setScreen(next);
    setCompose(false);
  }
  function selectAgent(id: string) {
    setSelected(id);
    setDetailOpen(true);
  }
  function openTask(item: Task) {
    setMode(item.mode);
    selectAgent(item.agentId);
    go("office");
  }
  function reviewApprovals() {
    const panel = document.getElementById("hq-approvals");
    panel?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    panel?.focus({ preventScroll: true });
  }

  if (!snapshot) return <div className="hq-loading">{error || <><LoaderCircle className="hq-spin" size={20} />Carregando o escritório…</>}</div>;
  const approvalNotice = notice && <ApprovalNotice key={notice.id} approval={notice}
    owner={owners.find(item => item.id === notice.agentId)} busy={busy}
    demo={taskModes.get(notice.taskId) === "demo"} action={decisionAction} error={error} />;

  return <div className="hq-app" data-expanded={expanded || undefined}>
    <header className="hq-topbar" inert={expanded}>
      <div className="hq-top-inner">
        <a className="hq-brand" href="/"><span className="hq-brand-logo" aria-hidden="true" />AgenFlux</a>
        <nav className="hq-nav" aria-label="Navegação principal" ref={nav}>
          <span className="hq-nav-indicator" aria-hidden="true" />
          {screens.map(({ id, label, Icon }) => <button key={id} className="hq-button" aria-current={screen === id ? "page" : undefined} onClick={() => go(id)}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>)}
        </nav>
        <div className="hq-top-actions">
          <button className="hq-button hq-connect" disabled={busy} onClick={() => void action({ action: "connect" })}>
            <i className={snapshot.connection.authenticated ? "connected" : ""} />
            {snapshot.connection.authenticated ? "Codex conectado" : snapshot.connection.status === "connecting" ? "Conectando…" : "Conectar Codex"}
          </button>
          <button className="hq-button hq-icon" aria-label={`Aprovações${approvals.length ? ", " + approvals.length + " pendentes" : ""}`} onClick={reviewApprovals}>
            <Bell size={16} />{approvals.length > 0 && <b>{approvals.length}</b>}
          </button>
        </div>
      </div>
    </header>
    {!expanded && error && !notice && <div className="hq-error" role="alert"><span>{error}</span><button className="hq-button hq-icon" aria-label="Fechar alerta" onClick={() => setError("")}><X size={15} /></button></div>}
    <main className="hq-layout">
      <div className="hq-hero" inert={expanded}>
        <div><h1>{view.label}</h1><p>{view.description}</p></div>
        {screen !== "settings" && <button className="hq-button primary" onClick={() => setCompose(true)}><Plus size={16} />{mode === "demo" ? "Nova demonstração" : "Nova missão"}</button>}
      </div>
      {screen === "office" && <div className="hq-toolbar" inert={expanded}>
        <div className="hq-mode" aria-label="Modo de execução">
          <button className="hq-button" aria-pressed={mode === "real"} onClick={() => setMode("real")}><Radio size={14} />Codex real</button>
          <button className="hq-button" aria-pressed={mode === "demo"} onClick={() => setMode("demo")}><FlaskConical size={14} />Demonstração</button>
        </div>
        <span className="hq-live" role="status"><i className={online ? "connected" : ""} />{online ? "Atualização em tempo real" : "Reconectando"}</span>
      </div>}
      {compose && <dialog className="hq-dialog" ref={composerDialog} onCancel={() => setCompose(false)}>
        {mode === "demo" ? <Composer snapshot={snapshot} mode={mode} busy={busy} action={action} close={() => setCompose(false)} /> :
          <><div className="hq-dialog-close"><button className="hq-button hq-icon" aria-label="Fechar" onClick={() => setCompose(false)}><X size={17} /></button></div>
          <MissionPanel snapshot={snapshot} action={action} busy={busy} openTask={openTask} view="create" onCreated={() => setCompose(false)} /></>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {approvalNotice}
      </dialog>}
      <div className="hq-view" key={screen}>
        {screen === "office" && <div className="hq-office-layout">
          <div className="hq-stack">
            <section className="hq-office hq-glass">
              <div className="hq-section-head" inert={expanded}>
                <h2>Mapa do escritório</h2>
                <div className="hq-map-actions"><span className="hq-pill">{agents.length}/8 estações ocupadas</span><span className="hq-pill">{running} em atividade</span>
                  <button ref={expandButton} className="hq-button" onClick={openFullscreen}><Maximize size={15} />Tela cheia</button>
                </div>
              </div>
              <div ref={stage} className="hq-office-stage" tabIndex={-1} aria-label={expanded ? "Escritório em tela cheia. Pressione Esc para sair." : undefined}>
                <Office key={mode} agents={agents} tasks={tasks} selected={agent?.id ?? ""} onSelect={selectAgent} communications={mode === "real" ? snapshot.communications : []} />
                {expanded && <button className="hq-button hq-fullscreen-exit" onClick={() => void closeFullscreen()}>Sair da tela cheia</button>}
                {expanded && approvalNotice}
              </div>
              <div className="hq-legend" inert={expanded}><Status status="idle" /><Status status="running" /><Status status="approval" /></div>
            </section>
            {detailOpen && <div className="hq-detail-wrap" inert={expanded}><Detail agent={agent} task={task} events={events} mode={mode} busy={busy} interrupt={() => task && void action({ action: "task.interrupt", id: task.id })} /></div>}
          </div>
          <aside className="hq-stack hq-office-side" inert={expanded}>
            <section className="hq-agents hq-glass">
              <div className="hq-section-head"><div><h2>Equipe do momento</h2><p>Selecione um agente para acompanhar a tarefa.</p></div><span className="hq-pill">{agents.length} agentes</span></div>
              <div className="hq-agent-strip">{agents.map(item => {
                const assignment = latestTask(tasks, item.id);
                return <button key={item.id} aria-pressed={item.id === agent?.id} onClick={() => selectAgent(item.id)}>
                  <Avatar agent={item} />
                  <span><strong>{item.name}</strong><small>{assignment ? short(assignment.title, 72) : item.role}</small></span>
                  <Status status={assignment?.status ?? "idle"} />
                </button>;
              })}</div>
              {agent && <div className="hq-team-foot"><span>{agent.name} · {statusText[task?.status ?? "idle"] ?? STATUS_LABEL[task?.status ?? "idle"]}</span>
                <button className="hq-text-button" onClick={() => setDetailOpen(open => !open)}>{detailOpen ? "Ocultar detalhes" : "Mostrar detalhes"}</button></div>}
            </section>
            {mode === "demo" && <section className="hq-demo-banner"><div><strong>Demonstração</strong><p>Teste movimentos e decisões com um cenário simulado.</p></div><button className="hq-button" disabled={busy || tasks.some(t => t.status === "running" || t.status === "approval")} onClick={() => void action({ action: "demo.start" })}>Simular aprovação</button></section>}
          </aside>
        </div>}
        {screen === "history" && <div className="hq-stack"><MissionPanel snapshot={snapshot} action={action} busy={busy} openTask={openTask} view="history" /><CommunicationsPanel snapshot={snapshot} openTask={openTask} /></div>}
        {screen === "team" && <TeamPanel snapshot={snapshot} busy={busy} action={action} />}
        {screen === "settings" && <div className="hq-settings"><div className="hq-stack"><section className="hq-settings-note"><div className="hq-section-head"><h2>Conexão</h2></div><div className="hq-panel-content"><p>{snapshot.connection.message}</p></div></section><AISettings snapshot={snapshot} action={action} busy={busy} /></div><EccLibrary snapshot={snapshot} action={action} busy={busy} /></div>}
      </div>
      <section className="hq-approvals" id="hq-approvals" tabIndex={-1} inert={expanded}>
        <div className="hq-section-head"><h2>Aprovações</h2><span className="hq-pill">{approvals.length ? `${approvals.length} pendente${approvals.length > 1 ? "s" : ""}` : "Tudo em ordem"}</span></div>
        {approvals.length ? approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} owner={owners.find(item => item.id === approval.agentId)}
          task={snapshot.tasks.find(item => item.id === approval.taskId)} busy={busy} action={decisionAction} />) :
          <div className="hq-approval-empty"><ShieldCheck size={18} /><p>Nenhuma solicitação pendente.</p></div>}
      </section>
    </main>
    {!expanded && !compose && approvalNotice}
  </div>;
}
