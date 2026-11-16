"use client";
import { useMemo, useState } from "react";
import { KeyRound, Plug, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import type { TabProps } from "./workspace-dashboard";
import { COST_LABEL, PROFILE_HELP, PROFILE_LABEL, TIER_LABEL, isFree } from "@/lib/cost";
import type { CatalogModel, CostClass, EngineId, Profile, ProviderInfo } from "@/lib/types";

// Provedores com camada gratuita conhecida. Os limites mudam com frequência: por
// isso a tela mostra o que o provedor informa agora e aponta para a página oficial.
const FREE_GUIDE: { id: string; name: string; note: string; url: string; key: boolean }[] = [
  { id: "opencode", name: "OpenCode Zen (modelos “Free”)", note: "Funciona sem chave dentro do OpenCode. Oferta por tempo limitado; os modelos NVIDIA Nemotron são de uso de avaliação — não envie dados pessoais ou confidenciais.", url: "https://opencode.ai/zen", key: false },
  { id: "openrouter", name: "OpenRouter (variantes “:free”)", note: "Cadastro gratuito e chave de API. Há limite diário de requisições para modelos :free.", url: "https://openrouter.ai/keys", key: true },
  { id: "nvidia", name: "NVIDIA build (NIM)", note: "Conta gratuita de desenvolvedor e chave de API; uso de avaliação com limite de requisições por minuto.", url: "https://build.nvidia.com", key: true },
  { id: "google", name: "Google AI Studio (Gemma/Gemini)", note: "Chave gratuita com cota diária; confira quais modelos estão na camada gratuita.", url: "https://aistudio.google.com/apikey", key: true },
  { id: "groq", name: "Groq", note: "Chave gratuita com limites por minuto e por dia.", url: "https://console.groq.com/keys", key: true },
  { id: "ollama", name: "Ollama (local)", note: "Roda no seu computador, sem internet e sem cota. Exige memória e, de preferência, placa de vídeo.", url: "https://ollama.com/download", key: false },
];
const STEPS: { title: string; body: string; code?: string }[] = [
  { title: "1. Instale o OpenCode", body: "Abra o PowerShell e instale pelo npm (você já tem o Node.js por causa do AgenFlux). Este é o caminho que foi testado com o AgenFlux. A documentação oficial também cita Scoop e Chocolatey.", code: "npm install -g opencode-ai" },
  { title: "2. Confirme a instalação", body: "O comando deve mostrar a versão. Se o PowerShell disser que não reconhece o comando, feche e abra o terminal de novo.", code: "opencode --version" },
  { title: "3. Conecte uma conta ou provedor (opcional)", body: "Os modelos gratuitos do OpenCode Zen funcionam sem login. Para outros provedores, rode o comando abaixo, escolha o provedor e cole a chave no próprio terminal — ela fica guardada pelo OpenCode, não pelo AgenFlux.", code: "opencode auth login" },
  { title: "4. Veja os modelos disponíveis", body: "Lista tudo o que a sua instalação enxerga. Os gratuitos do Zen aparecem como opencode/…-free.", code: "opencode models\nopencode models opencode" },
  { title: "5. Conecte o AgenFlux", body: "Clique em “Conectar” no cartão OpenCode acima. O AgenFlux inicia o servidor do OpenCode sozinho (somente em 127.0.0.1, com senha aleatória). Se preferir um servidor já aberto por você, defina as variáveis antes de iniciar o AgenFlux:", code: "$env:OPENCODE_SERVER_PASSWORD = \"uma-senha-forte\"\nopencode serve --hostname 127.0.0.1 --port 4096\n\n# em outro terminal, antes do npm run dev:\n$env:OPENCODE_URL = \"http://127.0.0.1:4096\"\n$env:OPENCODE_SERVER_PASSWORD = \"uma-senha-forte\"" },
  { title: "6. Escolha modelos gratuitos e teste", body: "Na tabela abaixo, deixe o filtro “Somente gratuitos” ligado, defina um modelo padrão e clique em “Testar”: uma requisição mínima e real confirma que ele responde." },
  { title: "Se algo der errado", body: "“OpenCode não encontrado”: defina o caminho do executável e reinicie o AgenFlux. Erro 401: a senha em OPENCODE_SERVER_PASSWORD não confere. Limite gratuito atingido (429): escolha outro modelo gratuito e use “Retomar missão”.", code: "$env:OPENCODE_BIN = \"$env:APPDATA\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe\"\nnpm run dev" },
];

function EngineCard({ engine, busy, action }: { engine: NonNullable<TabProps["snapshot"]["engines"]>[number]; busy: boolean; action: TabProps["action"] }) {
  const on = engine.status === "connected";
  return <article className="engine-card" data-status={engine.status}>
    <div className="row-between"><h3><i className={on ? "connected" : ""} />{engine.name}</h3><span className="hq-pill">{engine.status === "connected" ? "Conectado" : engine.status === "connecting" ? "Conectando…" : engine.status === "error" ? "Erro" : "Desconectado"}</span></div>
    <p>{engine.message}</p>
    {on && <p className="field-help">{engine.version ? `Versão ${engine.version} · ` : ""}{engine.models ?? 0} modelo(s) · {engine.freeModels ?? 0} sem custo{engine.managed ? " · servidor iniciado pelo AgenFlux (127.0.0.1, senha aleatória)" : ""}</p>}
    <div className="hq-actions">
      {!on ? <button className="hq-button primary" disabled={busy || engine.status === "connecting"} onClick={() => void action({ action: "engine.connect", engine: engine.id })}><Plug size={14} />Conectar</button>
        : <>{engine.id === "claude" && <button className="hq-button primary" disabled={busy} onClick={async () => {
            if (!confirm("Tornar o Claude o Orquestrador?\n\nEle abrirá cada missão com um briefing para a equipe e redigirá o relatório final (inclusive nas automações). Isso usa os limites da sua assinatura Claude — não é gratuito — e liga a opção “Permitir assinatura já contratada”. Os demais agentes continuam nos modelos gratuitos.")) return;
            if (await action({ action: "settings.save", allowSubscription: true })) await action({ action: "agent.settings", id: "orchestrator", modelKey: "claude:anthropic/sonnet", fallbackKey: "", maxAttempts: 2, skills: ["*"] });
          }}>Tornar o Claude o Orquestrador</button>}
          <button className="hq-button" disabled={busy} onClick={() => void action({ action: "engine.connect", engine: engine.id })}><RefreshCw size={14} />Reconectar</button><button className="hq-button" disabled={busy} onClick={() => void action({ action: "engine.disconnect", engine: engine.id })}>Desconectar</button></>}
    </div>
  </article>;
}

export function ModelsTab({ snapshot, catalog, busy, action, request }: TabProps) {
  const settings = snapshot.settings!;
  const [onlyFree, setOnlyFree] = useState(true);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [tests, setTests] = useState<Record<string, string>>({});
  const [authFor, setAuthFor] = useState<ProviderInfo>();
  const [keyValue, setKeyValue] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [wizard, setWizard] = useState(false);
  const engines = (snapshot.engines ?? []).filter(e => e.id !== "local");
  const opencodeOn = engines.find(e => e.id === "opencode")?.status === "connected";
  const models = useMemo(() => catalog.models.filter(m => m.chat && (!onlyFree || isFree(m.cost)) && (!provider || m.providerId === provider) && `${m.name} ${m.modelId} ${m.providerName}`.toLowerCase().includes(query.toLowerCase())), [catalog.models, onlyFree, provider, query]);
  const connectedProviders = catalog.providers.filter(p => p.connected);
  const otherProviders = catalog.providers.filter(p => !p.connected && `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase()));
  async function test(model: CatalogModel) {
    setTests(t => ({ ...t, [model.key]: "Testando…" }));
    const result = await request<{ ok: boolean; text: string; ms: number; cost?: number; tokens?: number }>({ action: "model.test", key: model.key });
    setTests(t => ({ ...t, [model.key]: result ? `${result.ok ? "✓ Respondeu" : "✗ Sem resposta"} em ${(result.ms / 1000).toFixed(1)}s · “${result.text.slice(0, 40)}” · custo US$ ${(result.cost ?? 0).toFixed(4)}` : "✗ Falhou (veja o aviso no topo)" }));
  }
  const save = (patch: Record<string, unknown>) => void action({ action: "settings.save", ...patch });
  return <div className="hq-stack">
    <section className="command-panel">
      <div className="panel-toolbar"><div className="panel-title"><ShieldCheck size={17} /><h2>Política de custo</h2></div></div>
      <div className="command-intro policy-grid">
        <label className="switch-row"><input type="checkbox" checked={settings.freeOnly} disabled={busy} onChange={e => save({ freeOnly: e.target.checked })} /><span><strong>Somente modelos gratuitos</strong><small>Ligado: nenhum modelo cobrado por token é usado, não existe fallback para API paga e a etapa para se não houver modelo gratuito compatível. O AgenFlux nunca ativa cobrança ou recarga automática.</small></span></label>
        <label className="switch-row"><input type="checkbox" checked={settings.allowSubscription} disabled={busy || !settings.freeOnly} onChange={e => save({ allowSubscription: e.target.checked })} /><span><strong>Permitir assinatura já contratada</strong><small>Libera modelos incluídos em um plano que você já paga (ex.: ChatGPT via Codex). Consome os limites da assinatura; ChatGPT Plus não dá créditos para APIs externas.</small></span></label>
        <label>Perfil geral<select value={settings.profile} disabled={busy} onChange={e => save({ profile: e.target.value })}>{(Object.keys(PROFILE_LABEL) as Profile[]).map(p => <option key={p} value={p}>{PROFILE_LABEL[p]}</option>)}</select><small className="field-help">{PROFILE_HELP[settings.profile]}</small></label>
        <label>Modelo padrão<select value={settings.defaultModelKey ?? ""} disabled={busy} onChange={e => save({ defaultModelKey: e.target.value })}><option value="">Automático (o Orquestrador decide por etapa)</option>{catalog.models.filter(m => m.chat && !m.blocked).map(m => <option key={m.key} value={m.key}>{m.name} — {m.providerName} · {COST_LABEL[m.cost]}</option>)}</select><small className="field-help">Preferido quando compatível com a etapa. Modelos por agente ficam na aba Agentes.</small></label>
      </div>
    </section>

    <section className="command-panel">
      <div className="panel-toolbar"><div className="panel-title"><Plug size={17} /><h2>Motores de execução</h2></div><button className="hq-button" onClick={() => setWizard(w => !w)}>{wizard ? "Fechar o guia" : "Guia: configurar o OpenCode no Windows"}</button></div>
      <div className="engine-grid">{engines.map(engine => <EngineCard key={engine.id} engine={engine} busy={busy} action={action} />)}</div>
      {wizard && <ol className="wizard">{STEPS.map(step => <li key={step.title}><h3>{step.title}</h3><p>{step.body}</p>{step.code && <pre className="code-block"><code>{step.code}</code></pre>}</li>)}
        <li><h3>Claude como Orquestrador (opcional, usa a sua assinatura)</h3><p>Instale o Claude Code, faça login uma vez e clique em “Conectar” no cartão Claude; depois em “Tornar o Claude o Orquestrador”. Dentro do AgenFlux o Claude trabalha somente em leitura: abre a missão com um briefing para a equipe e escreve o relatório final. Edições de arquivos continuam com os agentes do OpenCode, que pedem a sua aprovação.</p><pre className="code-block"><code>{"npm install -g @anthropic-ai/claude-code\nclaude"}</code></pre></li>
        <li><h3>Ollama (opcional, 100% local)</h3><p>Instale o Ollama, baixe um modelo e clique em “Conectar” no cartão Ollama. Neste modo direto o modelo não usa ferramentas (serve para análise, plano e documentação). Para ele editar arquivos, adicione o Ollama como provedor no arquivo de configuração do OpenCode.</p><pre className="code-block"><code>{"winget install Ollama.Ollama\nollama pull qwen2.5-coder:7b\nollama list"}</code></pre></li></ol>}
    </section>

    <section className="command-panel">
      <div className="panel-toolbar"><div className="panel-title"><KeyRound size={17} /><h2>Provedores</h2></div><span className="tiny">{connectedProviders.length} conectado(s) de {catalog.providers.length}</span></div>
      <div className="command-intro"><p>Chaves de API ficam guardadas pelo próprio OpenCode. O AgenFlux só repassa a chave ao servidor local: não a grava, não a mostra de novo e não a registra em logs.</p></div>
      <div className="provider-list">{connectedProviders.map(p => <div className="provider-row" key={`${p.engine}:${p.id}`}><span><strong>{p.name}</strong><small>{p.models} modelo(s) · {p.freeModels} sem custo{p.note ? ` · ${p.note}` : ""}</small></span><span className="hq-pill cost-free">Conectado</span>
        {p.engine === "opencode" && p.id !== "opencode" && <button className="text-button" disabled={busy} onClick={() => void action({ action: "provider.logout", providerId: p.id })}>Remover credencial</button>}</div>)}
        {!connectedProviders.length && <p className="field-help">Nenhum provedor conectado. Conecte o OpenCode acima.</p>}</div>
      <h3 className="sub-head">Opções gratuitas para começar</h3>
      <div className="provider-list">{FREE_GUIDE.map(g => { const info = catalog.providers.find(p => p.id === g.id); return <div className="provider-row" key={g.id}><span><strong>{g.name}</strong><small>{g.note} <a href={g.url} target="_blank" rel="noreferrer">Página oficial</a></small></span>
        {info?.connected ? <span className="hq-pill cost-free">Conectado</span> : g.key ? <button className="hq-button" disabled={busy || !opencodeOn || !info} title={opencodeOn ? "" : "Conecte o OpenCode primeiro"} onClick={() => { setAuthFor(info); setKeyValue(""); }}>Conectar com chave</button> : <span className="hq-pill">{g.id === "ollama" ? "Use o cartão Ollama" : "Conecte o OpenCode"}</span>}</div>; })}</div>
      {opencodeOn && <details className="hq-detail-section"><summary>Conectar outro provedor ({otherProviders.length} disponíveis no OpenCode)</summary><div className="provider-list">{otherProviders.slice(0, showAll ? 400 : 12).map(p => <div className="provider-row" key={p.id}><span><strong>{p.name}</strong><small>{p.models} modelo(s) · {p.freeModels} com preço zero · {p.authMethods.map(m => m.label).join(" / ")}</small></span><button className="text-button" disabled={busy} onClick={() => { setAuthFor(p); setKeyValue(""); }}>Conectar com chave</button></div>)}</div>{otherProviders.length > 12 && !showAll && <button className="text-button" onClick={() => setShowAll(true)}>Mostrar todos</button>}<p className="field-help">Login por navegador (OAuth) é feito no terminal: <code>opencode auth login</code>. Depois clique em Reconectar.</p></details>}
      {authFor && <form className="mission-form key-form" onSubmit={async e => { e.preventDefault(); if (await action({ action: "provider.auth", providerId: authFor.id, key: keyValue })) { setAuthFor(undefined); setKeyValue(""); } }}>
        <h3>Conectar {authFor.name}</h3>
        <p className="field-help">Cole a chave de API. Ela é enviada somente ao OpenCode neste computador (127.0.0.1){authFor.env.length ? `; equivale a definir ${authFor.env[0]}` : ""}. Prefere não digitar aqui? Use <code>opencode auth login</code> no PowerShell.</p>
        <label>Chave de API<input type="password" autoComplete="off" value={keyValue} onChange={e => setKeyValue(e.target.value)} required minLength={8} maxLength={400} /></label>
        <div className="hq-actions"><button type="button" className="hq-button" onClick={() => { setAuthFor(undefined); setKeyValue(""); }}>Cancelar</button><button className="hq-button primary" disabled={busy}>Salvar no OpenCode</button></div>
      </form>}
    </section>

    <section className="command-panel">
      <div className="panel-toolbar"><div className="panel-title"><Zap size={17} /><h2>Modelos</h2></div><button className="hq-button" disabled={busy} onClick={() => void action({ action: "catalog.refresh" })}><RefreshCw size={14} />Atualizar catálogo</button></div>
      <div className="model-filters">
        <label className="mission-write"><input type="checkbox" checked={onlyFree} onChange={e => setOnlyFree(e.target.checked)} /> Somente gratuitos e locais</label>
        <select value={provider} onChange={e => setProvider(e.target.value)} aria-label="Provedor"><option value="">Todos os provedores</option>{connectedProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar modelo…" aria-label="Buscar modelo" />
      </div>
      <p className="field-help models-count">{models.length} modelo(s). O custo vem do preço informado pelo provedor agora — nada é presumido pelo nome.</p>
      <div className="model-table" role="table">
        {models.slice(0, 80).map(m => <div className="model-row" role="row" key={m.key} data-blocked={m.blocked ? "" : undefined}>
          <span role="cell"><strong>{m.name}</strong><small>{m.providerName} · {m.modelId}</small></span>
          <span role="cell"><b className={`hq-pill cost-${m.cost}`}>{COST_LABEL[m.cost as CostClass]}</b><small>{m.blocked ?? m.costNote}</small></span>
          <span role="cell"><small>{m.toolCall ? "Usa ferramentas" : "Sem ferramentas"} · porte {TIER_LABEL[m.tier]}{m.context ? ` · contexto ${(m.context / 1000).toFixed(0)}k` : ""}{m.efforts.length ? ` · raciocínio: ${m.efforts.join("/")}` : ""}</small>{tests[m.key] && <small className="test-result">{tests[m.key]}</small>}</span>
          <span role="cell" className="hq-actions"><button className="text-button" disabled={busy || Boolean(m.blocked)} onClick={() => void test(m)}>Testar</button><button className="text-button" disabled={busy || Boolean(m.blocked) || settings.defaultModelKey === m.key} onClick={() => save({ defaultModelKey: m.key })}>{settings.defaultModelKey === m.key ? "Padrão ✓" : "Tornar padrão"}</button></span>
        </div>)}
        {!models.length && <p className="field-help models-count">{catalog.models.length ? "Nenhum modelo com esses filtros." : "Conecte um motor para listar os modelos reais."}</p>}
      </div>
    </section>
  </div>;
}
export type { EngineId };
