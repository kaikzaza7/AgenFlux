"use client";
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, ArrowRight, Search } from 'lucide-react';
import type { Snapshot, Task } from '@/lib/types';

interface Entry { id: string; kind: 'agent' | 'skill'; slug: string; name: string; description: string; originalModel?: string; agentId: string; sourcePath: string }
interface Catalog { repository: string; commit: string; license: string; entries: Entry[] }
export function EccExecution({ task }: { task?: Task }) {
  if (!task?.library) return null;
  return <div className="execution-configuration"><strong>Seleção ECC desta execução</strong>{task.library.refs.map(ref => <span key={ref.id}>{ref.name} <code>{ref.id.startsWith('ecc:agent:') ? 'perfil' : 'skill'}</code></span>)}<span>Revisão: <code>{task.library.commit.slice(0, 12)}</code></span></div>;
}
export function EccLibrary({ snapshot, action, busy }: { snapshot: Snapshot; action: (data: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'agent' | 'skill'>('agent');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(24);
  const [profile, setProfile] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [responsible, setResponsible] = useState('developer');
  const [cwd, setCwd] = useState(snapshot.workspace);
  const [preview, setPreview] = useState<{ name: string; content: string }>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/ecc', { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setCatalog(data);
    }).catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    return () => controller.abort();
  }, []);
  const filtered = useMemo(() => (catalog?.entries ?? []).filter(entry => entry.kind === kind && `${entry.name} ${entry.slug} ${entry.description}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [catalog, kind, search]);
  const selected = catalog?.entries.find(e => e.id === profile);
  async function inspect(entry: Entry) {
    setLoadingPreview(true); setError('');
    try { const response = await fetch('/api/ecc?id=' + encodeURIComponent(entry.id)); const data = await response.json(); if (!response.ok) throw new Error(data.error); setPreview({ name: entry.name, content: data.content }); }
    catch (error) { setError((error as Error).message); }
    finally { setLoadingPreview(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice('');
    const form = new FormData(event.currentTarget);
    if (await action({ action: 'task.create', mode: 'real', agentId: responsible, title: form.get('title'), prompt: form.get('prompt'), cwd, ...(profile ? { libraryProfileId: profile } : {}), skillIds: skills })) setNotice('Tarefa real adicionada à fila. O progresso aparecerá no escritório e no painel de atividades.');
  }
  const canRun = snapshot.capabilities?.libraryProfiles === true;
  const active = snapshot.tasks.some(task => task.mode === 'real' && ['running', 'approval'].includes(task.status));
  return <section className="settings-panel command-panel ecc-library">
    <div className="panel-toolbar"><div className="panel-title"><BookOpen size={18} /><h2>Biblioteca ECC</h2></div><span className="tiny muted">PACOTE LOCAL · MIT</span></div>
    <div className="command-intro"><p>Especializações disponíveis para as sessões reais do Codex. Selecione um perfil e até quatro skills para cada tarefa; apenas as instruções selecionadas serão carregadas.</p><p>A equipe e o escritório permanecem iguais. O agente responsável usa o perfil escolhido nesta execução, com o modelo salvo em Configurações de IA. Criar ou selecionar perfis não inicia trabalho.</p>{catalog && <p className="field-help"><a href={`https://github.com/${catalog.repository}/tree/${catalog.commit}`} target="_blank" rel="noreferrer">Origem: {catalog.repository}</a> · revisão {catalog.commit.slice(0, 12)} · {catalog.entries.filter(e => e.kind === 'agent').length} agentes · {catalog.entries.filter(e => e.kind === 'skill').length} skills</p>}{!canRun && <p className="amber" role="status">{active ? 'Aguarde a execução atual terminar antes de reiniciar o servidor. A biblioteca já pode ser consultada.' : 'Reinicie o servidor com Ctrl+C → npm run dev e reconecte o Codex para habilitar os perfis nas novas execuções. O histórico será preservado.'}</p>}</div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="ecc-controls"><label>Tipo<select value={kind} onChange={e => { setKind(e.target.value as 'agent' | 'skill'); setLimit(24); }}><option value="agent">Agentes</option><option value="skill">Skills</option></select></label><label>Buscar<div className="ecc-search"><Search size={15} /><input value={search} onChange={e => { setSearch(e.target.value); setLimit(24); }} placeholder="Flutter, SQL, revisão…" /></div></label></div>
    <p className="field-help">{filtered.length} resultados · {skills.length}/4 skills selecionadas</p>
    <div className="ecc-grid">{filtered.slice(0, limit).map(entry => <article className={`ecc-card ${(profile === entry.id || skills.includes(entry.id)) ? 'selected' : ''}`} key={entry.id}><div className="row-between"><h3>{entry.name}</h3></div><code>{entry.slug}</code><p>{entry.description}</p><div className="approval-actions">{entry.kind === "agent" && (() => { const saved = snapshot.agentCatalog?.find(agent => agent.libraryProfileId === entry.id); const seated = saved && snapshot.agents.some(agent => agent.id === saved.id); return <><button type="button" className="button" disabled={busy || !!saved} onClick={() => void action({ action: "agent.import", profileId: entry.id })}>{saved ? "No catálogo" : "Adicionar ao catálogo"}</button><button type="button" className="button" disabled={busy || (!seated && snapshot.agents.length >= 8)} onClick={() => void (seated ? action({ action: "office.set", agentIds: snapshot.agents.filter(agent => agent.id !== saved.id).map(agent => agent.id) }) : action({ action: "agent.import", profileId: entry.id, office: true }))}>{seated ? "Retirar do escritório" : "Colocar no escritório"}</button></>; })()}<button type="button" className="button secondary" onClick={() => { setNotice(''); if (entry.kind === 'agent') { setProfile(profile === entry.id ? '' : entry.id); setResponsible(entry.agentId); } else setSkills(current => current.includes(entry.id) ? current.filter(id => id !== entry.id) : [...current, entry.id]); }} disabled={entry.kind === 'skill' && skills.length >= 4 && !skills.includes(entry.id)}>{(profile === entry.id || skills.includes(entry.id)) ? 'Remover seleção' : 'Selecionar'}</button><button type="button" className="text-button" disabled={loadingPreview} onClick={() => void inspect(entry)}>Ler instruções</button></div></article>)}</div>
    {filtered.length > limit && <button className="button secondary" type="button" onClick={() => setLimit(current => current + 24)}>Mostrar mais {Math.min(24, filtered.length - limit)}</button>}
    {preview && <article className="mission-report ecc-preview"><div className="row-between"><h3>{preview.name} — instruções originais</h3><button className="text-button" onClick={() => setPreview(undefined)}>Fechar</button></div><p className="field-help">Conteúdo do pacote. Exemplos de modelos, ferramentas e comandos não habilitam serviços nem alteram permissões.</p><pre>{preview.content}</pre></article>}
    <form className="mission-form ecc-launch" onSubmit={submit}><h3>Delegar usando a seleção</h3><p>Perfil: <strong>{selected?.name ?? 'instruções do agente responsável'}</strong>. Skills: {skills.map(id => catalog?.entries.find(e => e.id === id)?.name).join(', ') || 'nenhuma'}.</p>{selected?.originalModel && <p className="field-help">Modelo no pacote original: {selected.originalModel}. Esse identificador não é aplicado. A execução usa o modelo Codex configurado para o responsável.</p>}<label>Responsável no escritório<select value={responsible} onChange={e => setResponsible(e.target.value)}>{snapshot.agents.map(a => <option value={a.id} key={a.id}>{a.name} — {a.role}</option>)}</select></label><label>Título<input name="title" required maxLength={120} placeholder="Revisar tratamento de erros do projeto" /></label><label>Objetivo<textarea name="prompt" rows={4} required maxLength={12000} placeholder="Descreva o trabalho e se ele deve ser somente leitura. Não inclua senhas ou chaves." /></label><label>Workspace autorizado<input value={cwd} onChange={e => setCwd(e.target.value)} maxLength={1000} required /></label>{catalog && <div className="approval-actions"><button type="button" className="text-button" onClick={() => setCwd(snapshot.workspace)}>Usar workspace padrão</button></div>}<p className="field-help">Fila real de uma execução por vez. Aprovações e limites do Codex continuam valendo. Scripts e hooks do ECC não são executados automaticamente.</p><button className="button primary" disabled={busy || !canRun || !catalog || !snapshot.connection.authenticated || (!profile && !skills.length)}><ArrowRight size={15} /> Delegar tarefa real</button>{notice && <p role="status" className="green">{notice}</p>}</form>
  </section>;
}
