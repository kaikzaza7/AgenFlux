"use client";
import { useEffect, useMemo, useState } from "react";
import { FolderSearch, ShieldAlert, Sparkles } from "lucide-react";
import type { TabProps } from "./workspace-dashboard";
import { EccLibrary } from "./ecc-library";
import type { SkillInfo } from "@/lib/types";

interface Inspection { id: string; path: string; name: string; description: string; origin: string; valid: boolean; problems: string[]; risk: string; permissions: string[]; files: { path: string; bytes: number; kind: string }[]; findings: { file: string; line: number; severity: string; category: string }[] }

// Aba Skills: catálogo descoberto (formato SKILL.md do OpenCode), quem pode usar
// cada uma, histórico real de uso e instalação de skills externas com inspeção.
export function SkillsTab({ snapshot, busy, action, request }: TabProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{ name: string; content: string }>();
  const [path, setPath] = useState("");
  const [inspection, setInspection] = useState<Inspection>();
  const [editing, setEditing] = useState("");
  const version = snapshot.skillsVersion;
  useEffect(() => { fetch("/api/hq/skills").then(r => r.json()).then(d => setSkills(d.skills ?? [])).catch(() => undefined); }, [version]);
  const agents = (snapshot.agentCatalog ?? snapshot.agents).filter(a => !a.archived && a.id !== "reporter");
  const name = (id: string) => agents.find(a => a.id === id)?.name ?? id;
  const filtered = useMemo(() => skills.filter(s => `${s.name} ${s.description} ${s.origin}`.toLowerCase().includes(query.toLowerCase())), [skills, query]);
  const usage = snapshot.skillUsage ?? [];
  async function read(skill: SkillInfo) { const data = await (await fetch(`/api/hq/skills?id=${encodeURIComponent(skill.id)}`)).json(); if (data.content) setPreview({ name: skill.name, content: data.content }); }
  return <div className="hq-stack">
    <section className="command-panel">
      <div className="panel-toolbar"><div className="panel-title"><Sparkles size={17} /><h2>Skills instaladas</h2></div><span className="tiny">{skills.filter(s => s.enabled).length} ativas de {skills.length}</span></div>
      <div className="command-intro"><p>O Orquestrador escolhe automaticamente até 3 skills por etapa, comparando a missão com as palavras-chave e a descrição de cada skill. Só as escolhidas entram no contexto do agente — carregar todas desperdiçaria tokens. Formato: pasta com <code>SKILL.md</code>, o mesmo do OpenCode.</p>
        <label>Buscar<input value={query} onChange={e => setQuery(e.target.value)} placeholder="React, segurança, SQL…" /></label></div>
      <div className="skill-grid">{filtered.slice(0, 90).map(skill => { const used = usage.filter(u => u.skillId === skill.id).length; return <article className="ecc-card" key={skill.id} data-off={skill.enabled ? undefined : ""}>
        <div className="row-between"><h3>{skill.name}</h3><label className="mission-write"><input type="checkbox" checked={skill.enabled} disabled={busy} onChange={e => void action({ action: "skill.set", id: skill.id, enabled: e.target.checked })} /> Ativa</label></div>
        <p>{skill.description}</p>
        <small><b>Origem:</b> {skill.origin}{skill.license ? ` · ${skill.license}` : ""} · <b>Compatibilidade:</b> {skill.compatibility ?? "OpenCode / qualquer motor"}</small>
        <small><b>Agentes autorizados:</b> {skill.agents.length ? skill.agents.map(name).join(", ") : "todos"} · <b>Usos registrados:</b> {used}</small>
        {editing === skill.id && <div className="hq-chips">{agents.map(a => <label key={a.id} className={`hq-chip ${skill.agents.includes(a.id) ? "on" : ""}`}><input type="checkbox" checked={skill.agents.includes(a.id)} disabled={busy} onChange={e => void action({ action: "skill.set", id: skill.id, agents: e.target.checked ? [...skill.agents, a.id] : skill.agents.filter(id => id !== a.id) })} />{a.name}</label>)}<small className="field-help">Nenhum marcado = todos podem usar.</small></div>}
        <div className="hq-actions"><button className="text-button" onClick={() => void read(skill)}>Ler instruções</button><button className="text-button" onClick={() => setEditing(editing === skill.id ? "" : skill.id)}>{editing === skill.id ? "Concluir" : "Definir agentes"}</button>
          {skill.source === "instalada" && <button className="text-button" disabled={busy} onClick={() => void action({ action: "skill.remove", id: skill.id })}>Remover</button>}</div>
      </article>; })}</div>
      {preview && <article className="mission-report ecc-preview"><div className="row-between"><h3>{preview.name}</h3><button className="text-button" onClick={() => setPreview(undefined)}>Fechar</button></div><pre>{preview.content}</pre></article>}
    </section>

    <section className="command-panel">
      <div className="panel-toolbar"><div className="panel-title"><FolderSearch size={17} /><h2>Instalar skill externa</h2></div></div>
      <form className="mission-form" onSubmit={async e => { e.preventDefault(); const report = await request<Inspection>({ action: "skill.inspect", path }); if (report) setInspection(report); }}>
        <p className="field-help">Baixe ou clone a skill você mesmo (ex.: <code>git clone …</code>) e informe a pasta que contém o <code>SKILL.md</code>. O AgenFlux lê os arquivos, aponta scripts e comandos perigosos e só copia depois da sua aprovação. Nenhum script é executado, nem na inspeção nem depois.</p>
        <label>Pasta da skill<input value={path} onChange={e => setPath(e.target.value)} required maxLength={1000} placeholder="C:\Users\voce\Downloads\minha-skill" /></label>
        <button className="button" disabled={busy}>Inspecionar (não instala)</button>
      </form>
      {inspection && <div className="inspection" data-risk={inspection.risk}>
        <div className="row-between"><h3><ShieldAlert size={16} /> {inspection.name} — risco {inspection.risk}</h3><span className="hq-pill">{inspection.files.length} arquivo(s)</span></div>
        <p>{inspection.description}</p><p className="field-help"><b>Origem:</b> {inspection.origin}</p>
        {inspection.problems.map(p => <p className="inline-error" key={p}>{p}</p>)}
        <p><b>Permissões que a skill aparenta precisar:</b> {inspection.permissions.join("; ") || "nenhuma além de leitura de instruções"}</p>
        <details open={inspection.findings.length > 0}><summary>Pontos de atenção ({inspection.findings.length})</summary>{inspection.findings.length ? <ul>{inspection.findings.slice(0, 60).map((f, i) => <li key={i}><b>[{f.severity}]</b> {f.category} — <code>{f.file}{f.line ? `:${f.line}` : ""}</code></li>)}</ul> : <p className="field-help">Nenhum padrão perigoso encontrado. Isso não substitui a sua leitura.</p>}</details>
        <details><summary>Arquivos</summary><ul>{inspection.files.map(f => <li key={f.path}><code>{f.path}</code> · {f.kind} · {f.bytes} bytes</li>)}</ul></details>
        <div className="hq-actions"><button className="hq-button" onClick={() => setInspection(undefined)}>Recusar</button><button className="hq-button primary" disabled={busy || !inspection.valid} onClick={async () => { if (await action({ action: "skill.install", id: inspection.id })) { setInspection(undefined); setPath(""); } }}>Aprovar e instalar</button></div>
      </div>}
    </section>

    <section className="command-panel">
      <div className="panel-toolbar"><h2>Histórico de utilização</h2><span className="tiny">{usage.length} registro(s)</span></div>
      <div className="command-intro">{usage.length ? <div className="usage-list">{usage.slice(0, 40).map(u => <div key={u.id}><time>{new Date(u.at).toLocaleString("pt-BR")}</time><strong>{u.skillName}</strong><span>{name(u.agentId)}</span><small>selecionada por: {u.matched?.join(", ") || "—"}{u.missionId ? ` · missão “${snapshot.missions?.find(m => m.id === u.missionId)?.objective.slice(0, 50) ?? u.missionId.slice(0, 8)}”` : ""}</small></div>)}</div> : <p className="field-help">As skills usadas em missões reais aparecem aqui, com o motivo da seleção.</p>}</div>
    </section>
    <EccLibrary snapshot={snapshot} action={action} busy={busy} />
  </div>;
}
