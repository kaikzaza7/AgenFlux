import type { CodexTransport, Payload } from "./codex.ts";

// Official config/read includes cwd in the installed 0.167.0 protocol. Read
// effective project layers and disable configured external tools per thread;
// never copy credentials, URLs or commands from that config into our records.
export async function localExecutionConfig(codex: CodexTransport, cwd: string): Promise<Payload> {
  const response = await codex.request("config/read", { cwd, includeLayers: false });
  if (!response.config || typeof response.config !== "object" || Array.isArray(response.config)) throw new Error("Não foi possível verificar as ferramentas externas do workspace. A etapa foi bloqueada antes da inferência.");
  const servers = response.config.mcp_servers;
  if (servers != null && (typeof servers !== "object" || Array.isArray(servers))) throw new Error("Configuração MCP inesperada. Nenhum turno iniciado.");
  return {
    web_search: "disabled",
    features: { apps: false, plugins: false, memories: false },
    mcp_servers: Object.fromEntries(Object.keys(servers ?? {}).map(name => [name, { enabled: false }])),
  };
}
