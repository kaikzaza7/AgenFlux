"use client";
import { FlaskConical, Settings2 } from "lucide-react";
import type { TabProps } from "./workspace-dashboard";

export function SettingsTab({ snapshot, busy, action, startDemo }: TabProps & { startDemo: () => void }) {
  const settings = snapshot.settings!;
  const save = (patch: Record<string, unknown>) => void action({ action: "settings.save", ...patch });
  return <div className="hq-stack">
    <section className="command-panel"><div className="panel-toolbar"><div className="panel-title"><Settings2 size={17} /><h2>Execução</h2></div><span className="tiny">AgenFlux {snapshot.version}</span></div>
      <div className="command-intro policy-grid">
        <label>Execuções simultâneas: <b>{settings.concurrency}</b><input type="range" min={1} max={4} value={settings.concurrency} disabled={busy} onChange={e => save({ concurrency: Number(e.target.value) })} /><small className="field-help">Quantos agentes trabalham ao mesmo tempo. Em computadores modestos, use 1 ou 2. Duas etapas com edição nunca rodam juntas no mesmo projeto.</small></label>
        <label className="switch-row"><input type="checkbox" checked={snapshot.queuePaused} disabled={busy} onChange={e => void action({ action: "queue.pause", paused: e.target.checked })} /><span><strong>Pausar a fila</strong><small>Etapas em andamento terminam; nenhuma nova começa até você retomar.</small></span></label>
        <label className="switch-row"><input type="checkbox" checked={settings.lowRiskApprovals} disabled={busy} onChange={e => save({ lowRiskApprovals: e.target.checked })} /><span><strong>Aprovar automaticamente leituras de baixo risco</strong><small>Comandos que só leem dentro do projeto (ls, cat, grep, git status…) passam sem perguntar. Edições, rede, instalação e exclusão sempre pedem aprovação.</small></span></label>
      </div></section>
    <section className="command-panel"><div className="panel-toolbar"><h2>Escritório</h2></div>
      <div className="command-intro policy-grid">
        <label>Velocidade dos personagens: <b>{settings.officeSpeed} tiles/s</b><input type="range" min={1} max={12} value={settings.officeSpeed} disabled={busy} onChange={e => save({ officeSpeed: Number(e.target.value) })} /></label>
        <label>Permanência de ociosos em cada ponto: <b>{settings.officeDwell}s</b><input type="range" min={1} max={30} value={settings.officeDwell} disabled={busy} onChange={e => save({ officeDwell: Number(e.target.value) })} /><small className="field-help">Só afeta o passeio decorativo de quem está sem tarefa. Com “reduzir movimento” ativo no sistema, os personagens não caminham.</small></label>
      </div></section>
    <section className="command-panel"><div className="panel-toolbar"><h2>Workspace e dados</h2></div>
      <div className="command-intro"><p>Workspace padrão: <code>{snapshot.workspace}</code></p><p className="field-help">Missões, agentes, times, aprovações, automações e histórico ficam em um arquivo SQLite local na pasta <code>data/</code>. Nenhum serviço de nuvem é necessário. Credenciais de provedores não são guardadas aqui.</p></div></section>
    <section className="hq-demo-banner"><div><strong><FlaskConical size={14} /> Demonstração</strong><p>Cenário SIMULADO para conhecer os movimentos e o fluxo de aprovação sem conectar nenhum motor. Sempre aparece rotulado como demonstração e não executa nada.</p></div><button className="hq-button" disabled={busy} onClick={startDemo}>Iniciar demonstração</button></section>
  </div>;
}
