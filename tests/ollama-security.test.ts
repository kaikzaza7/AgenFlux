import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { OllamaEngine } from "../server/engines/ollama.ts";
import { extractJson } from "../server/engines/types.ts";
import { readSummary } from "../server/missions.ts";
import { readOnlyCommand, commandRisk } from "../server/command-safety.ts";
import { localRequest } from "../server/security.ts";
import { redact, redactValue } from "../server/redact.ts";
import { createHq } from "./helpers.ts";

// O Ollama não está instalado no ambiente de testes: este servidor local imita a
// API HTTP documentada (/api/version, /api/tags, /api/chat em NDJSON) para validar
// o adaptador. É um substituto de teste, declarado como tal.
test("Ollama (API imitada): descoberta de modelos locais e conversa com streaming", async () => {
  const server = createServer(async (req, res) => {
    if (req.url === "/api/version") return void res.end(JSON.stringify({ version: "0.9.9" }));
    if (req.url === "/api/tags") return void res.end(JSON.stringify({ models: [{ name: "qwen2.5-coder:7b", details: { parameter_size: "7.6B" } }, { name: "nomic-embed-text:latest" }] }));
    let body = ""; for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).stream, true);
    res.write(JSON.stringify({ message: { content: '{"summary":"Análise ' } }) + "\n");
    res.end(JSON.stringify({ message: { content: 'local.","files":[],"findings":[],"needsChanges":false,"blockers":[]}' }, done: true, prompt_eval_count: 12, eval_count: 8 }) + "\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const finished: any[] = [], patches: any[] = [];
  const host: any = { statusChanged() {}, changed() {}, event() {}, patch: (_: string, p: any) => patches.push(p), finish: (...args: any[]) => finished.push(args), task: () => undefined };
  const engine = new OllamaEngine(host, `http://127.0.0.1:${(server.address() as any).port}`);
  await engine.connect();
  assert.equal(engine.status().status, "connected");
  assert.deepEqual(engine.models().map(m => m.modelId), ["qwen2.5-coder:7b"], "modelos de embedding ficam de fora");
  const model = engine.models()[0];
  assert.equal(model.cost, "local"); assert.equal(model.toolCall, false); assert.equal(model.tier, "light");
  await engine.start({ task: { id: "t1", cwd: "." } as any, agent: { name: "Analista" } as any, model, system: "s", prompt: "p", readOnly: true });
  for (let i = 0; i < 100 && !finished.length; i++) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(finished[0].slice(0, 2), ["t1", "completed"]);
  const result = patches.find(p => p.result); assert.equal(readSummary(result.result).summary, "Análise local."); assert.equal(result.cost, 0); assert.equal(result.tokenUsage.totalTokens, 20);
  assert.equal((await engine.test!(model)).ok, true);
  server.close();
  const offline = new OllamaEngine(host, "http://127.0.0.1:9");
  await assert.rejects(offline.connect(), /não está em execução/);
  await assert.rejects(new OllamaEngine(host, "http://exemplo.com:11434").connect(), /este computador/);
});

test("respostas imperfeitas de modelos gratuitos não bloqueiam a missão", () => {
  assert.deepEqual(extractJson('Claro! Aqui está:\n```json\n{"summary":"ok","files":[]}\n```\nEspero ter ajudado.'), { summary: "ok", files: [] });
  assert.deepEqual(extractJson('texto {"a":{"b":"} }"}} fim'), { a: { b: "} }" } });
  assert.equal(extractJson("sem json"), undefined);
  const loose = readSummary("Encontrei três problemas no arquivo x.ts.");
  assert.equal(loose.structured, false); assert.match(loose.summary, /três problemas/); assert.equal(loose.needsChanges, false);
  assert.equal(readSummary('{"summary":"s","needsChanges":"true","files":"x"}').needsChanges, false, "tipos errados são normalizados");
});

test("classificação de comandos: só leitura inequívoca é tratada como segura", () => {
  for (const safe of ["ls -la", "cat src/app.ts", "rg -n TODO src", "git status", "git log --oneline -5", "grep -r foo . | head -20", "Get-ChildItem src", "find . -name '*.ts'"]) assert.equal(readOnlyCommand(safe), true, safe);
  for (const unsafe of ["rm -rf dist", "ls; rm x", "cat a > b", "cat .env", "git push", "npm test", "curl http://x", "ls && whoami", "echo $(whoami)", "find . -delete", "sed -i s/a/b/ f", "git -c core.pager=x log", "node -e \"1\"", ""]) assert.equal(readOnlyCommand(unsafe), false, unsafe);
  assert.match(commandRisk("rm -rf build"), /EXCLUIR/); assert.match(commandRisk("git push origin main"), /deploy\/push/); assert.match(commandRisk("npm install x"), /dependências/); assert.match(commandRisk("curl https://x"), /rede/);
});

test("segurança: só a origem local é aceita e segredos são mascarados antes de persistir ou enviar", async () => {
  const request = (headers: Record<string, string>) => ({ headers } as unknown as IncomingMessage);
  assert.equal(localRequest(request({ host: "127.0.0.1:3000" }), 3000), true);
  assert.equal(localRequest(request({ host: "127.0.0.1:3000", origin: "https://malicioso.example" }), 3000), false);
  assert.equal(localRequest(request({ host: "192.168.0.10:3000" }), 3000), false, "acesso pela rede é recusado");
  assert.equal(localRequest(request({ host: "127.0.0.1:3000", "content-type": "text/plain" }), 3000, true), false, "bloqueia formulários de outros sites (CSRF)");
  const secret = "sk-" + "abcdefghijklmnop1234";
  assert.ok(!redact(`a chave é ${secret}`).includes(secret));
  assert.equal((redactValue({ apiKey: "qualquer-valor", nested: { token: "x" } }) as any).apiKey, "[SEGREDO REMOVIDO]");
  // Uma missão que contenha um segredo no texto não o grava nem o devolve ao navegador.
  const { hq, store } = await createHq();
  hq.createMission({ objective: `Analise o projeto usando a chave ${secret} que colei por engano.` });
  assert.ok(!JSON.stringify(store.all("mission")).includes(secret)); assert.ok(!JSON.stringify(hq.snapshot()).includes(secret));
  assert.ok(!JSON.stringify(hq.catalog()).match(/password|authorization/i));
  hq.close();
});
