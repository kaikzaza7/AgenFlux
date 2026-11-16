import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { Headquarters } from "../server/hq.ts";
import { OpenCodeEngine, opencodeCommand } from "../server/engines/opencode.ts";
import { startFakeLlm } from "./fixtures/fake-llm.mjs";
import { NullCodex, until, workspace } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Integração REAL com o OpenCode: estes testes iniciam o binário verdadeiro
// (`opencode serve`) e conversam com ele pela API HTTP oficial. A única parte
// substituída é o MODELO: um servidor local roteirizado (tests/fixtures/fake-llm.mjs)
// registrado no OpenCode como provedor "agenflux-teste". Assim sessões, ferramentas,
// permissões e eventos são todos reais, sem rede e sem custo.
// Se o OpenCode não estiver instalado, os testes são pulados com aviso.
// ---------------------------------------------------------------------------

let binary: string | undefined;
try { binary = opencodeCommand(); } catch { /* não instalado */ }
const skip = binary ? false : "OpenCode não instalado (defina OPENCODE_BIN ou instale opencode-ai)";
const MODEL = "opencode:agenflux-teste/roteiro-1";

async function setup() {
  const llm = await startFakeLlm(0);
  const home = mkdtempSync(join(tmpdir(), "agenflux-oc-"));
  Object.assign(process.env, {
    XDG_DATA_HOME: join(home, "data"), XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { "agenflux-teste": { npm: "@ai-sdk/openai-compatible", name: "Roteiro de teste", options: { baseURL: llm.url, apiKey: "teste" }, models: { "roteiro-1": { name: "Roteiro 1", tool_call: true, limit: { context: 32000, output: 4000 } } } } } }),
  });
  const dir = workspace();
  const store = new Store(":memory:"); await store.migrateTeam(); await store.migrateV3();
  const hq = new Headquarters(store, new NullCodex(), dir, { dataDir: join(home, "agenflux"), eccRoot: join(home, "sem-ecc") });
  await hq.connect("opencode");
  hq.saveSettings({ defaultModelKey: MODEL });
  return { hq, store, dir, llm, home, engine: hq.engines.opencode as OpenCodeEngine, async close() { hq.close(); llm.server.close(); await new Promise(r => setTimeout(r, 300)); } };
}
const done = (hq: Headquarters, id: string) => ["completed", "blocked", "cancelled"].includes(hq.store.one<any>("mission", id)!.status);

test("OpenCode real: conexão protegida, descoberta de provedores/modelos e classificação de custo", { skip }, async () => {
  const ctx = await setup();
  try {
    const status = ctx.engine.status();
    assert.equal(status.status, "connected");
    assert.match(status.version!, /^\d+\.\d+/);
    assert.equal(status.managed, true);
    assert.match(status.url!, /^http:\/\/127\.0\.0\.1:\d+$/, "escuta somente em 127.0.0.1");
    // Sem a senha (gerada em memória), o servidor recusa.
    assert.equal((await fetch(status.url + "/global/health")).status, 401);
    const catalog = ctx.hq.catalog();
    const scripted = catalog.models.find(m => m.key === MODEL)!;
    assert.ok(scripted, "modelo do provedor configurado foi descoberto");
    assert.equal(scripted.cost, "local"); assert.equal(scripted.toolCall, true);
    assert.ok(catalog.providers.length > 50, "catálogo de provedores do OpenCode carregado");
    const zen = catalog.providers.find(p => p.id === "opencode")!;
    assert.ok(zen.connected && zen.freeModels > 0, "OpenCode Zen disponível com modelos gratuitos");
    const zenModels = catalog.models.filter(m => m.providerId === "opencode");
    assert.ok(zenModels.length > 0 && zenModels.every(m => m.cost === "free-temporary" || m.cost === "paid"));
    console.log(`   Zen gratuitos reportados pelo OpenCode ${status.version}: ${zenModels.filter(m => m.cost !== "paid").map(m => m.name).join(", ")}`);
    // Nenhuma credencial no que vai ao navegador.
    const exposed = JSON.stringify([ctx.hq.snapshot(), catalog]);
    assert.ok(!/Basic [A-Za-z0-9+/=]{20,}/.test(exposed) && !exposed.includes("OPENCODE_SERVER_PASSWORD"));
  } finally { await ctx.close(); }
});

test("OpenCode real: missão executa ferramentas reais, transmite eventos e registra modelo, tokens e custo zero", { skip }, async () => {
  const ctx = await setup();
  try {
    const mission = ctx.hq.createMission({ objective: "Analise o projeto. LEIA:README.md" });
    await until(() => done(ctx.hq, mission.id), "missão real", 60000);
    assert.equal(ctx.store.one<any>("mission", mission.id).status, "completed", JSON.stringify(ctx.store.one<any>("mission", mission.id).blockers));
    const analyst = ctx.store.tasks.find(t => t.missionId === mission.id && t.stage === "analyst")!;
    assert.equal(analyst.engine, "opencode"); assert.match(analyst.sessionId!, /^ses_/);
    assert.equal(analyst.routing!.modelKey, MODEL); assert.equal(analyst.effectiveModel, "agenflux-teste/roteiro-1");
    assert.equal(analyst.cost, 0); assert.ok(analyst.tokenUsage!.totalTokens > 0);
    const events = ctx.store.events.filter(e => e.taskId === analyst.id).map(e => `${e.kind}:${e.text}`);
    assert.ok(events.some(e => /^tool:Usando ferramenta read/.test(e)), "evento de ferramenta em execução");
    assert.ok(events.some(e => /^tool:Ferramenta concluída read/.test(e)), "evento de ferramenta concluída");
    assert.ok(events.some(e => /^model:Modelo: Roteiro 1/.test(e)), "modelo registrado");
    assert.match(analyst.result, /Roteiro concluído \(1 resultado/);
    assert.ok(ctx.llm.calls.some((call: any) => call.toolResults === 1), "o resultado da ferramenta voltou ao modelo");
  } finally { await ctx.close(); }
});

test("OpenCode real: pedido de permissão vira aprovação; aprovar executa, recusar impede", { skip }, async () => {
  const ctx = await setup();
  try {
    const marker = join(ctx.dir, "marcador.txt");
    const mission = ctx.hq.createMission({ objective: `Analise o projeto. EXECUTE:node -e "require('fs').writeFileSync('marcador.txt','ok')"` });
    await until(() => ctx.store.approvals.some(a => a.state === "pending"), "aprovação real", 60000);
    const approval = ctx.store.approvals.find(a => a.state === "pending")!;
    assert.equal(approval.engine, "opencode"); assert.equal(approval.kind, "command");
    assert.match(approval.action, /writeFileSync/);
    assert.equal(approval.canApprove, false, "missão somente leitura: comando que escreve não pode ser aprovado");
    await assert.rejects(ctx.hq.decide(approval.id, true), /política da missão/);
    await ctx.hq.decide(approval.id, false);
    await until(() => done(ctx.hq, mission.id), "missão após recusa", 60000);
    assert.equal(existsSync(marker), false, "o comando recusado não foi executado");

    // Comando de leitura em missão somente leitura: pode ser aprovado e executa de verdade.
    const second = ctx.hq.createMission({ objective: "Analise novamente o projeto. EXECUTE:ls" });
    await until(() => ctx.store.approvals.some(a => a.state === "pending"), "segunda aprovação", 60000);
    const read = ctx.store.approvals.find(a => a.state === "pending")!;
    assert.equal(read.canApprove, true); assert.match(read.risks!, /leitura/);
    await ctx.hq.decide(read.id, true);
    await until(() => done(ctx.hq, second.id), "missão após aprovar", 60000);
    assert.equal(ctx.store.one<any>("mission", second.id).status, "completed");
    const task = ctx.store.tasks.find(t => t.missionId === second.id && t.stage === "analyst")!;
    assert.deepEqual(task.commands, ["ls"]);
  } finally { await ctx.close(); }
});

test("OpenCode real: edição é negada em leitura e pede aprovação quando autorizada", { skip }, async () => {
  const ctx = await setup();
  try {
    const target = join(ctx.dir, "nota.txt");
    const readOnly = ctx.hq.createMission({ objective: "Analise o projeto. ESCREVA:nota.txt" });
    await until(() => done(ctx.hq, readOnly.id), "missão leitura", 60000);
    assert.equal(existsSync(target), false, "sessão somente leitura não cria arquivos");
    assert.equal(ctx.store.approvals.filter(a => a.missionId === readOnly.id).length, 0);

    const write = ctx.hq.createMission({ objective: "Corrija o projeto e implemente a nota. ESCREVA:nota.txt", allowWrite: true });
    await until(() => ctx.store.approvals.some(a => a.state === "pending" && a.kind === "edit"), "aprovação de edição", 60000);
    const approval = ctx.store.approvals.find(a => a.state === "pending" && a.kind === "edit")!;
    assert.equal(approval.agentId, "developer"); assert.equal(approval.canApprove, true);
    assert.equal(existsSync(target), false, "nada é escrito antes da aprovação");
    await ctx.hq.decide(approval.id, true);
    await until(() => existsSync(target), "arquivo criado após aprovar", 30000);
    assert.match(readFileSync(target, "utf8"), /conteudo escrito pelo roteiro/);
    await until(() => ctx.store.tasks.some(t => t.missionId === write.id && t.stage === "developer" && t.status === "completed"), "desenvolvedor concluir", 60000);
    assert.ok(ctx.store.tasks.find(t => t.missionId === write.id && t.stage === "developer")!.files.includes("nota.txt"), "arquivo modificado registrado");
    ctx.hq.missions.cancel(write.id);
  } finally { await ctx.close(); }
});

test("OpenCode real: interromper encerra a sessão; limite de uso (429) aciona troca de modelo", { skip }, async () => {
  const ctx = await setup();
  try {
    const mission = ctx.hq.createMission({ objective: "Analise o projeto. EXECUTE:ls -la" });
    await until(() => ctx.store.approvals.some(a => a.state === "pending"), "aprovação", 60000);
    const task = ctx.store.tasks.find(t => t.missionId === mission.id && t.stage === "analyst")!;
    await ctx.hq.interrupt(task.id);
    await until(() => ctx.store.one<any>("task", task.id).status === "interrupted", "interrupção", 20000);
    assert.equal(ctx.store.one<any>("mission", mission.id).status, "blocked");
    assert.equal(ctx.store.approvals.filter(a => a.state === "pending").length, 0, "aprovação pendente expirada");

    // 429 no único modelo permitido → sem alternativa gratuita → falha explicada.
    ctx.hq.saveSettings({ freeOnly: true });
    const limited = ctx.hq.createMission({ objective: "Faça uma análise simples. FALHE:429", overrides: { models: { analyst: MODEL } } });
    await until(() => ctx.store.events.some(e => e.kind === "limit" || (e.kind === "failed" && /Limite/.test(e.text))), "limite detectado", 90000);
    const analyst = ctx.store.tasks.find(t => t.missionId === limited.id && t.stage === "analyst")!;
    assert.ok(analyst.excludedModels?.includes(MODEL), "modelo esgotado foi excluído das próximas tentativas");
    ctx.hq.missions.cancel(limited.id);
  } finally { await ctx.close(); }
});

test("OpenCode real: recuperação de estado quando eventos são perdidos (reconexão)", { skip }, async () => {
  const ctx = await setup();
  try {
    // Simula a queda do fluxo de eventos: o adaptador deixa de receber notificações.
    const engine = ctx.engine as any; const original = engine.handle; engine.handle = () => {};
    const mission = ctx.hq.createMission({ objective: "Analise o projeto. LEIA:package.json" });
    await until(() => ctx.store.tasks.some(t => t.missionId === mission.id && t.stage === "analyst" && Boolean(t.sessionId)), "sessão criada", 30000);
    await until(() => ctx.llm.calls.some((c: any) => c.toolResults === 1 && /package\.json/.test(c.text)), "modelo respondeu", 30000);
    await new Promise(r => setTimeout(r, 1500));
    const analyst = () => ctx.store.tasks.find(t => t.missionId === mission.id && t.stage === "analyst")!;
    assert.equal(analyst().status, "running", "sem eventos, a etapa ainda aparece em execução");
    engine.handle = original;
    await ctx.engine.reconcile(); // é o que a reconexão executa
    await until(() => analyst().status === "completed", "estado recuperado", 20000);
    assert.match(analyst().result, /Roteiro concluído/);
    await until(() => done(ctx.hq, mission.id), "missão concluir após recuperação", 60000);
  } finally { await ctx.close(); }
});

test("OpenCode real: chave de provedor vai direto ao OpenCode e nunca reaparece", { skip }, async () => {
  const ctx = await setup();
  try {
    const key = "chave-ficticia-" + "0123456789abcdef0123";
    assert.equal(ctx.hq.catalog().providers.find(p => p.id === "groq")!.connected, false);
    await ctx.hq.providerAuth("groq", key);
    const catalog = ctx.hq.catalog();
    assert.equal(catalog.providers.find(p => p.id === "groq")!.connected, true, "provedor conectado após gravar a credencial no OpenCode");
    assert.ok(catalog.models.some(m => m.providerId === "groq"));
    assert.ok(!JSON.stringify([catalog, ctx.hq.snapshot(), ctx.store.all("settings"), ctx.store.events]).includes(key), "a chave não aparece em catálogo, snapshot, banco ou eventos");
    await assert.rejects(ctx.hq.providerAuth("../x", key), /inválido/);
    await ctx.hq.providerLogout("groq");
    assert.equal(ctx.hq.catalog().providers.find(p => p.id === "groq")!.connected, false);
  } finally { await ctx.close(); }
});
