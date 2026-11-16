// Servidor OpenAI-compatível ROTEIRIZADO, usado SOMENTE nos testes de integração.
// Ele não é um modelo de IA: responde de forma determinística para que um OpenCode
// real execute ferramentas, peça permissões e emita eventos verdadeiros, sem rede
// e sem custo. Diretivas reconhecidas no texto do usuário:
//   LEIA:<arquivo>     → chama a ferramenta read
//   EXECUTE:<comando>  → chama a ferramenta bash
//   ESCREVA:<arquivo>  → chama a ferramenta write
//   FALHE:429          → devolve erro HTTP 429 (limite de uso)
import { createServer } from "node:http";

export function startFakeLlm(port = 0) {
  const calls = [];
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: "roteiro-1", object: "model" }] })); return;
    }
    let raw = ""; for await (const chunk of req) raw += chunk;
    let body = {}; try { body = JSON.parse(raw); } catch { /* corpo vazio */ }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const text = messages.filter(m => m.role === "user").map(m => typeof m.content === "string" ? m.content : (m.content ?? []).map(p => p.text ?? "").join(" ")).join("\n");
    const toolResults = messages.filter(m => m.role === "tool").length;
    const tools = (body.tools ?? []).map(t => t.function?.name);
    calls.push({ model: body.model, tools: tools.length, toolResults, text: text.slice(0, 200) });
    if (/FALHE:429/.test(text)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit exceeded: free tier quota reached", type: "rate_limit_error" } })); return;
    }
    const directive = text.match(/(LEIA|EXECUTE|ESCREVA):([^\n]+)/);
    let call;
    if (directive && toolResults === 0 && tools.length) {
      const value = directive[2].trim();
      if (directive[1] === "LEIA" && tools.includes("read")) call = { name: "read", arguments: { filePath: value } };
      if (directive[1] === "EXECUTE" && tools.includes("bash")) call = { name: "bash", arguments: { command: value, description: "Comando do roteiro de teste" } };
      if (directive[1] === "ESCREVA" && tools.includes("write")) call = { name: "write", arguments: { filePath: value, content: "conteudo escrito pelo roteiro\n" } };
    }
    const answer = JSON.stringify({ summary: `Roteiro concluído (${toolResults} resultado(s) de ferramenta).`, files: [], findings: ["resposta determinística do servidor de teste"], needsChanges: false, blockers: [] });
    const id = "chatcmpl-" + Math.random().toString(36).slice(2);
    const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
    const usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 };
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (call) {
        send({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_" + id.slice(-8), type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage });
      } else {
        for (const piece of answer.match(/.{1,40}/gs)) send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: piece }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage });
      }
      res.end("data: [DONE]\n\n"); return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id, object: "chat.completion", created: base.created, model: body.model, usage,
      choices: [{ index: 0, finish_reason: call ? "tool_calls" : "stop", message: call
        ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] }
        : { role: "assistant", content: answer } }] }));
  });
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve({ server, calls, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/v1` })));
}
if (import.meta.url === `file://${process.argv[1]}`) startFakeLlm(Number(process.env.FAKE_LLM_PORT ?? 4197)).then(s => console.log("fake-llm em", s.url));
