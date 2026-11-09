"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Snapshot, Team } from "@/lib/types";

type EccProfile = { id: string; kind: string; name: string; description: string };

export function TeamPanel({ snapshot, busy, action }: {
  snapshot: Snapshot; busy: boolean; action: (data: Record<string, unknown>) => Promise<boolean>;
}) {
  const saved = snapshot.agentCatalog ?? snapshot.agents;
  const [profiles, setProfiles] = useState<EccProfile[]>([]);
  const [libraryError, setLibraryError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ecc", { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Biblioteca indisponível.");
      setProfiles((data.entries as EccProfile[]).filter(entry => entry.kind === "agent"));
    }).catch(error => { if (!controller.signal.aborted) setLibraryError(error.message); });
    return () => controller.abort();
  }, []);
  const selectionKey = (id: string) => saved.find(agent => agent.id === id)?.libraryProfileId ?? id;
  const catalog = [
    ...saved.map(agent => ({ id: selectionKey(agent.id), name: agent.name, role: agent.role })),
    ...profiles.filter(profile => !saved.some(agent => agent.libraryProfileId === profile.id))
      .map(profile => ({ id: profile.id, name: profile.name, role: "Biblioteca ECC · " + profile.description })),
  ];
  const [name, setName] = useState("");
  const [editing, setEditing] = useState("");
  const [ids, setIds] = useState<string[]>(() => snapshot.agents.map(agent => selectionKey(agent.id)));
  const [query, setQuery] = useState("");
  function edit(team?: Team) {
    setEditing(team?.id ?? ""); setName(team?.name ?? "");
    setIds((team?.agentIds ?? snapshot.agents.map(agent => agent.id)).map(selectionKey));
  }
  return <div className="hq-stack">
    <section className="command-panel">
      <div className="panel-toolbar"><h2>Times salvos</h2><button className="button" onClick={() => edit()}>Novo time</button></div>
      <div className="command-intro">{snapshot.teams?.length ? snapshot.teams.map(team =>
        <div className="row-between" key={team.id}><div><strong>{team.name}</strong><p>{team.agentIds.length} agentes{snapshot.activeTeamId === team.id ? " · No escritório" : ""}</p></div>
          <div className="approval-actions"><button className="button" onClick={() => edit(team)}>Editar</button>
          <button className="button" disabled={busy} onClick={() => void action({ action: "team.use", id: team.id })}>Usar no escritório</button></div></div>) :
        <p>Nenhum time salvo. Escolha os integrantes abaixo para montar o primeiro.</p>}</div>
    </section>
    <form className="command-panel mission-form" onSubmit={async e => {
      e.preventDefault();
      if (await action({ action: "team.save", id: editing || undefined, name, agentIds: ids })) {
        setName(""); setEditing("");
      }
    }}>
      <h2>{editing ? "Editar time" : "Montar equipe"}</h2>
      <p className="field-help">Escolha até 8 agentes próprios ou da Biblioteca ECC. A ordem de seleção define as etapas da missão. Os perfis ECC escolhidos entram no catálogo ao aplicar.</p>
      {libraryError && <p className="field-help" role="status">Biblioteca ECC: {libraryError}</p>}
      <label>Nome do time<input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Ex.: Front-end ou Marketing" /></label>
      <label>Buscar agente<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome ou função" /></label>
      <strong>{ids.length}/8 selecionados</strong>
      <div className="ai-grid" style={{ padding: 0, maxHeight: "28rem", overflowY: "auto" }}>
        {catalog.filter(a => (a.name + " " + a.role).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(agent => {
          const order = ids.indexOf(agent.id);
          return <label className="ai-agent-card" key={agent.id}>
            <span><input type="checkbox" checked={order >= 0} disabled={order < 0 && ids.length >= 8} onChange={e => {
              setIds(current => e.target.checked ? [...current, agent.id] : current.filter(id => id !== agent.id));
            }} /> {agent.name}{order >= 0 ? ` · Etapa ${order + 1}` : ""}</span><small>{agent.role}</small>
          </label>;
        })}
      </div>
      <div className="approval-actions">
        <button className="button primary" disabled={busy || !name.trim() || !ids.length}>Salvar time e aplicar</button>
        <button type="button" className="button" disabled={busy} onClick={() => void action({ action: "office.set", agentIds: ids })}>Aplicar só no escritório</button>
      </div>
    </form>
    <form className="command-panel mission-form" onSubmit={async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
      if (await action({ action: "agent.create", name: data.get("name"), role: data.get("role"), instructions: data.get("instructions"), color: "#8ba7d4" })) form.reset();
    }}>
      <h2>Criar agente próprio</h2>
      <label>Nome<input name="name" required maxLength={32} /></label>
      <label>Função<input name="role" required maxLength={100} /></label>
      <label>Instruções<textarea name="instructions" required rows={3} maxLength={8000} /></label>
      <button className="button" disabled={busy}>Adicionar ao catálogo</button>
    </form>
  </div>;
}
