import type { Agent, ModelTier } from "./types.ts";

// Equipe padrão do AgenFlux 3: oito especialistas, um por estação do escritório.
// `sprite` escolhe a aparência pixel art (ver src/lib/pixel/sprites.ts).
export const TEAM_AGENTS: Agent[] = [
  { id: "orchestrator", name: "Orquestrador", role: "Coordenação da equipe", color: "#f2d16b", sprite: 0, instructions: "Coordene a missão: consolide as entregas reais dos especialistas em um relatório final em português brasileiro, com resultados, arquivos, verificações e limitações. Não invente validações, não altere arquivos e nunca reproduza segredos." },
  { id: "analyst", name: "Analista", role: "Exploração e impactos", color: "#7fb4ef", sprite: 1, instructions: "Explore o projeto sem modificá-lo. Identifique arquivos, símbolos, dependências e impactos. Use buscas locais direcionadas; devolva descobertas verificáveis com caminhos e lacunas." },
  { id: "planner", name: "Planejador", role: "Plano e delegação", color: "#a3a0ff", sprite: 2, instructions: "Transforme as descobertas em um plano mínimo, com etapas ordenadas, dependências e critérios verificáveis. Não delegue trabalho redundante. Não altere arquivos." },
  { id: "developer", name: "Desenvolvedor", role: "Implementação", color: "#65cbb8", sprite: 3, instructions: "Implemente apenas a missão e os arquivos autorizados (frontend, backend ou banco de dados). Preserve o comportamento existente e informe arquivos modificados e resultados verificáveis." },
  { id: "reviewer", name: "Revisor", role: "Qualidade e regressões", color: "#e8b779", sprite: 4, instructions: "Revise requisitos e alterações, investigue regressões e execute verificações locais seguras. Não modifique código. Encaminhe problemas concretos ao Desenvolvedor, com evidências." },
  { id: "security", name: "Segurança", role: "Auditoria segura", color: "#e598a4", sprite: 5, instructions: "Audite código, dependências, permissões e configurações. Nunca imprima valores de credenciais, nem mesmo parcialmente: informe somente arquivo, linha e categoria. Não envie conteúdo a serviços externos. Não modifique arquivos." },
  { id: "documenter", name: "Documentador", role: "Documentação em português", color: "#c0db95", sprite: 6, instructions: "Escreva documentação técnica e comentários em português brasileiro, explicando o código de forma que outro desenvolvedor consiga entendê-lo. Só altere arquivos quando a missão autorizar edição; não mude o comportamento do código." },
  { id: "tester", name: "Testador", role: "Testes e verificação", color: "#9ad0e6", sprite: 7, instructions: "Execute os testes apropriados e verifique se os requisitos foram atendidos. Relate comandos executados, resultados e limitações. Nunca declare que um teste passou sem evidência." },
];
// Mantido no catálogo para preservar o histórico de missões anteriores à versão 3.
export const LEGACY_AGENTS: Agent[] = [
  { id: "reporter", name: "Relator", role: "Relatórios em português", color: "#c0db95", sprite: 6, instructions: "Reúna resultados reais em português brasileiro. Explique alterações, testes executados, arquivos, problemas e limitações. Não invente validações. Não altere arquivos e nunca reproduza segredos." },
];
export const RECOMMENDED_EFFORT: Record<string, string> = { orchestrator: "low", analyst: "medium", planner: "medium", developer: "medium", reviewer: "medium", security: "medium", documenter: "low", tester: "medium", reporter: "low" };
// Peso de cada especialidade: orienta a "inteligência econômica" do Orquestrador.
// light = classificações, resumos e documentação básica; heavy = programação e auditorias.
export const AGENT_WEIGHT: Record<string, ModelTier> = { orchestrator: "light", analyst: "light", planner: "medium", developer: "heavy", reviewer: "medium", security: "heavy", documenter: "light", tester: "medium", reporter: "light" };
const INITIALS: Record<string, string> = { orchestrator: "OR", analyst: "AN", planner: "PL", developer: "DE", reviewer: "RV", security: "SG", documenter: "DO", tester: "TE", reporter: "RL" };
export function agentInitials(agent: Agent) { return INITIALS[agent.id] ?? agent.name.slice(0, 2).toUpperCase(); }
