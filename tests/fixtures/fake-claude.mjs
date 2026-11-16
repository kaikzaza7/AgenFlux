#!/usr/bin/env node
// Substituto de TESTE do Claude Code CLI: emite o mesmo formato stream-json
// observado no CLI real (system/init → assistant com tool_use → result), sem rede
// e sem consumir assinatura. Usado via CLAUDE_BIN nos testes automatizados.
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("9.9.9 (Claude Code - substituto de teste)"); process.exit(0); }
let prompt = ""; for await (const chunk of process.stdin) prompt += chunk;
const model = args[args.indexOf("--model") + 1], tools = args[args.indexOf("--tools") + 1].split(",");
const out = message => console.log(JSON.stringify(message));
out({ type: "system", subtype: "init", session_id: "sessao-teste", model: `claude-${model}-teste`, tools });
if (/FALHE:LIMITE/.test(prompt)) { out({ type: "result", subtype: "error_during_execution", is_error: true, result: "Claude usage limit reached. Your limit will reset at 5pm.", usage: {} }); process.exit(1); }
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "README.md" } }] } });
if (/DEMORE/.test(prompt)) await new Promise(resolve => setTimeout(resolve, 30000));
out({ type: "assistant", message: { content: [{ type: "text", text: "pronto" }] } });
out({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.0123, usage: { input_tokens: 40, output_tokens: 20 },
  result: JSON.stringify({ summary: /Responda somente/.test(prompt) ? "OK" : `Briefing do Claude (${model}): priorize os arquivos-chave. Credencial de API no processo: ${process.env.ANTHROPIC_API_KEY ? "PRESENTE" : "ausente"}.`, files: [], findings: [`ferramentas: ${tools.join("+")}`, `argumentos: ${args.filter(a => a.startsWith("--")).join(" ")}`], needsChanges: false, blockers: [] }) });
