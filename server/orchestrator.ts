import type { Agent, AgentSettings, CatalogModel, MissionPlan, ModelTier, PlanStage, Profile, Settings, SkillInfo, SkillRef } from "../src/lib/types.ts";
import { AGENT_WEIGHT } from "../src/lib/team.ts";
import { routeModel } from "./catalog.ts";
import { normalize, type SkillLibrary } from "./skills.ts";

// ---------------------------------------------------------------------------
// Orquestrador — análise e planejamento.
//
// Esta parte é DETERMINÍSTICA de propósito: interpretar a intenção, medir a
// complexidade, escolher agentes, modelos e skills e montar o grafo de etapas não
// exige um LLM. Assim o planejamento custa zero tokens, é instantâneo e pode ser
// auditado: cada decisão vem acompanhada do motivo.
// Os modelos de IA ficam reservados para o trabalho que precisa de raciocínio.
// ---------------------------------------------------------------------------

interface Intent { id: string; label: string; pattern: RegExp; terms: string[]; write?: RegExp }
const INTENTS: Intent[] = [
  { id: "security", label: "Segurança", pattern: /seguran|vulnerab|chave(s)? de api|api key|senha|segredo|token|credenc|expost|sens[ií]ve|secret|password|owasp|inje[cç][aã]o|xss|csrf|auditori/, terms: ["seguranca", "segredos", "vulnerabilidades", "owasp", "credenciais"] },
  { id: "docs", label: "Documentação", pattern: /document|coment[aá]ri|explique|explica[cç]|readme|como (o c[oó]digo )?funciona|outro desenvolvedor|guia|manual|tutorial/, terms: ["documentacao", "comentarios", "explicacao", "readme"], write: /deix(e|ar) os coment|coment(e|ar) o c[oó]digo|escrev(a|er)|cri(e|ar) (a |um |uma )?(documenta|readme|guia)|atualiz(e|ar) (a |o )?(documenta|readme)|adicion(e|ar) coment/ },
  { id: "ui", label: "Interface", pattern: /interface|\bui\b|\bux\b|visual|layout|design|tela|frontend|front-end|css|estilo|moderna?|responsiv|anima[cç]|acessibil|componente/, terms: ["interface", "design", "frontend", "css", "acessibilidade", "animacoes", "qualidade visual", "componentes"] },
  { id: "database", label: "Banco de dados", pattern: /banco de dados|database|\bsql\b|consulta|query|queries|tabela|migra[cç][aã]o|schema|[ií]ndice|postgres|mysql|sqlite|supabase|prisma|mongodb/, terms: ["banco de dados", "sql", "consultas", "schema", "indices", "migracoes"] },
  { id: "bugfix", label: "Correção de erros", pattern: /corrij|corrig|conserte|\bbug|erro(s)?\b|falha|quebrad|n[aã]o funciona|problema|defeito|exce[cç][aã]o|crash/, terms: ["depuracao", "erros", "correcao"], write: /corrij|corrig|conserte|resolva|arrum/ },
  { id: "feature", label: "Implementação", pattern: /implement|adicion|cri(e|ar) (uma? )?(fun[cç]|recurso|tela|endpoint|api|componente|p[aá]gina)|\bdesenvolv(a|er|am)\b|constru(a|ir)|nova funcionalidade|integr(e|ar)\b/, terms: ["implementacao", "arquitetura"], write: /implement|adicion|\bcri(e|ar)\b|\bdesenvolv(a|er|am)\b|constru(a|ir)|integr(e|ar)\b/ },
  { id: "refactor", label: "Refatoração", pattern: /refator|reorganiz|reestrutur|simplifi|limp(e|ar) o c[oó]digo|d[ií]vida t[eé]cnica|moderniz|melhor(e|ar)|otimiz|deix(e|ar) mais/, terms: ["refatoracao", "qualidade de codigo"], write: /refator|reorganiz|reestrutur|simplifi|limp(e|ar)|moderniz|melhor(e|ar)|otimiz|deix(e|ar) mais/ },
  { id: "tests", label: "Testes", pattern: /\bteste|testar|cobertura|\bqa\b|verifi(que|car) se (os )?requisitos|valida[cç][aã]o|e2e|unit[aá]rio/, terms: ["testes", "cobertura", "verificacao"], write: /cri(e|ar) testes|escrev(a|er) testes|adicion(e|ar) testes/ },
  { id: "performance", label: "Desempenho", pattern: /desempenho|performance|lent[oa]|r[aá]pid|otimiz|mem[oó]ria|consumo|gargalo/, terms: ["desempenho", "otimizacao"] },
  { id: "review", label: "Revisão", pattern: /revis(e|ar|[aã]o)|code review|qualidade do c[oó]digo|regress/, terms: ["revisao", "qualidade de codigo"] },
  { id: "analysis", label: "Análise", pattern: /analis|investig|entend|mape(ie|ar)|diagn[oó]stic|encontr(e|ar)|identifi|verifi|avali|levant/, terms: ["analise"] },
];
const READ_ONLY_HINT = /sem (alterar|modificar|editar|mudar) (nenhum |os |o )?(arquivo|c[oó]digo)|somente leitura|apenas (analis|relat|leia|leitura)|n[aã]o (altere|modifique|edite) (nenhum |os )?arquivo/;

export interface PlanInput {
  objective: string; allowWrite: boolean; profile: Profile; cwd: string; stack?: string[];
  agents: Agent[]; agentSettings: AgentSettings[]; models: CatalogModel[]; settings: Settings; skills: SkillInfo[]; library: SkillLibrary;
  overrides?: PlanOverrides;
}
// Substituições manuais do usuário sobre as escolhas do Orquestrador.
export interface PlanOverrides { agents?: string[]; models?: Record<string, string>; skills?: Record<string, string[]> }

export function analyzeMission(input: PlanInput): MissionPlan {
  const text = normalize(input.objective);
  const intents = INTENTS.map(intent => ({ intent, matched: [...new Set((text.match(new RegExp(intent.pattern.source, "g")) ?? []).map(m => m.trim()))].slice(0, 5) })).filter(item => item.matched.length);
  if (!intents.length) intents.push({ intent: INTENTS.find(i => i.id === "analysis")!, matched: ["(pedido genérico)"] });
  const has = (id: string) => intents.some(item => item.intent.id === id);
  const readOnlyHint = READ_ONLY_HINT.test(text);
  const needsWrite = !readOnlyHint && intents.some(item => item.intent.write?.test(text));
  const canWrite = needsWrite && input.allowWrite;
  const warnings: string[] = [];
  if (needsWrite && !input.allowWrite) warnings.push("A missão pede alterações, mas a edição não foi autorizada: a equipe vai analisar e recomendar, sem modificar arquivos. Marque \"Permitir edição\" para o Desenvolvedor atuar.");

  // Complexidade: tamanho do pedido, número de frentes e se envolve alterar código.
  const words = text.split(/\s+/).length;
  const points = (words > 60 ? 2 : words > 25 ? 1 : 0) + Math.max(0, intents.filter(i => i.intent.id !== "analysis").length - 1) + (needsWrite ? 1 : 0) + (/todo o projeto|projeto inteiro|completa|todos os arquivos|arquitetura/.test(text) ? 1 : 0);
  const complexity: MissionPlan["complexity"] = points >= 4 ? "high" : points >= 2 ? "medium" : "low";

  const available = new Set(input.agents.map(a => a.id));
  const wanted = new Map<string, string>(); // agente → motivo
  wanted.set("analyst", "Toda missão começa mapeando os arquivos relevantes.");
  if (complexity !== "low" || canWrite) wanted.set("planner", complexity === "high" ? "Missão complexa: precisa de etapas e critérios definidos." : "Organiza as etapas antes de qualquer alteração.");
  if (canWrite && (has("bugfix") || has("feature") || has("refactor") || has("ui") || has("database") || has("tests") || has("performance"))) wanted.set("developer", "A missão pede alterações no código e a edição foi autorizada.");
  if (has("docs")) wanted.set("documenter", "O pedido envolve documentação ou explicação do código.");
  if (has("security") || wanted.has("developer")) wanted.set("security", has("security") ? "O pedido trata de segurança ou dados sensíveis." : "Toda alteração de código passa por verificação de segurança.");
  if (has("review") || wanted.has("developer") || (wanted.has("documenter") && canWrite) || has("ui")) wanted.set("reviewer", wanted.has("developer") || canWrite ? "Revisa as alterações em busca de regressões." : "Avalia a qualidade do que foi encontrado.");
  if (has("tests") || wanted.has("developer")) wanted.set("tester", has("tests") ? "O pedido envolve testes ou verificação de requisitos." : "Verifica se as alterações atendem aos requisitos.");
  wanted.set("orchestrator", "Consolida as entregas no relatório final.");

  // Substituição manual: a lista do usuário prevalece (Orquestrador sempre fica).
  let selected = [...wanted.keys()];
  if (input.overrides?.agents) {
    selected = [...new Set([...input.overrides.agents.filter(id => available.has(id)), "orchestrator"])];
    for (const id of selected) if (!wanted.has(id)) wanted.set(id, "Incluído manualmente por você.");
  }
  for (const id of [...selected]) if (!available.has(id)) { selected = selected.filter(s => s !== id); warnings.push(`O agente "${id}" não existe no catálogo e foi deixado de fora.`); }
  const on = (id: string) => selected.includes(id);

  const terms = [...intents.flatMap(item => item.intent.terms), ...(input.stack ?? [])];
  const stages: PlanStage[] = [];
  const settingsOf = (id: string) => input.agentSettings.find(s => s.id === id);
  const add = (stage: Omit<PlanStage, "skills" | "routing" | "routingError" | "weight"> & { weight?: ModelTier }) => {
    const agentSettings = settingsOf(stage.agentId);
    const weight = stage.weight ?? bump(AGENT_WEIGHT[stage.agentId] ?? "medium", complexity);
    const manualSkills = input.overrides?.skills?.[stage.agentId];
    const skills: SkillRef[] = stage.engine === "local" ? [] : manualSkills
      ? manualSkills.flatMap(id => { const s = input.skills.find(item => item.id === id); return s ? [{ id: s.id, name: s.name, source: s.origin, matched: ["escolha manual"], sha256: s.sha256 }] : []; }).slice(0, 4)
      : input.library.select({ text: input.objective, terms, agentId: stage.agentId, allowed: agentSettings?.skills }, input.skills);
    const forced = stage.engine === "llm" ? input.overrides?.models?.[stage.agentId] : undefined;
    const full: PlanStage = { ...stage, weight, skills, ...(forced ? { forcedModelKey: forced } : {}) };
    if (stage.engine === "llm") {
      try { full.routing = routeModel({ agentId: stage.agentId, weight, needsTools: stage.write || stage.agentId === "tester", profile: input.profile, forcedKey: forced }, input.models, input.settings, agentSettings); }
      catch (error) { full.routingError = (error as Error).message; }
    }
    stages.push(full);
  };

  // --- Etapas locais (sem LLM) ---
  add({ key: "scan", agentId: on("analyst") ? "analyst" : "orchestrator", goal: "Inventariar o workspace: estrutura, linguagens, tecnologias e arquivos-chave.", dependsOn: [], engine: "local", write: false, criteria: ["Inventário gerado por ferramenta local"], reason: "Operação determinística: listar arquivos não precisa de IA." });
  if (on("security")) add({ key: "audit", agentId: "security", goal: "Varredura local por chaves privadas, credenciais com prefixo conhecido e segredos em literais.", dependsOn: [], engine: "local", write: false, criteria: ["Somente arquivo, linha e categoria; nenhum valor de segredo"], reason: "Expressões regulares locais encontram segredos sem enviar o código a ninguém." });

  // --- Etapas com modelo de IA ---
  // Orquestrador com modelo próprio (ex.: Claude): ele abre a missão com um briefing
  // real para a equipe e, no fim, redige o relatório. Sem modelo próprio, o
  // planejamento continua 100% local e sem tokens.
  const lead = Boolean(settingsOf("orchestrator")?.modelKey || input.overrides?.models?.orchestrator);
  if (lead) add({ key: "briefing", agentId: "orchestrator", goal: "Abrir a missão como Orquestrador: a partir do inventário local, definir prioridades, riscos e a orientação específica para cada especialista escalado. Não execute o trabalho deles; direcione-o.", dependsOn: ["scan"], engine: "llm", write: false, weight: "light", criteria: ["Orientação objetiva por agente", "Riscos e pontos de atenção"], reason: "O Orquestrador tem um modelo próprio configurado e conduz a equipe." });
  if (on("analyst")) add({ key: "analyst", agentId: "analyst", goal: "Investigar o projeto para esta missão: arquivos relevantes, pontos de atenção e impactos, partindo do inventário local.", dependsOn: lead ? ["briefing"] : ["scan"], engine: "llm", write: false, criteria: ["Descobertas com caminhos de arquivo", "Lacunas e limitações declaradas"], reason: wanted.get("analyst")! });
  const afterAnalysis = on("analyst") ? ["analyst"] : lead ? ["briefing"] : ["scan"];
  if (on("planner")) add({ key: "planner", agentId: "planner", goal: "Transformar as descobertas em etapas ordenadas, com critérios verificáveis para cada especialista.", dependsOn: afterAnalysis, engine: "llm", write: false, criteria: ["Plano mínimo, sem trabalho redundante"], reason: wanted.get("planner")! });
  const afterPlan = on("planner") ? ["planner"] : afterAnalysis;
  if (on("developer")) add({ key: "developer", agentId: "developer", goal: canWrite ? "Implementar as alterações da missão, seguindo o plano e preservando o comportamento existente." : "Propor as alterações necessárias em detalhe (a missão é somente leitura: não edite arquivos).", dependsOn: afterPlan, engine: "llm", write: canWrite, criteria: ["Arquivos modificados informados", "Mudanças limitadas ao escopo da missão"], reason: wanted.get("developer")! });
  const afterBuild = on("developer") ? ["developer"] : afterPlan;
  const docWrites = canWrite && Boolean(INTENTS.find(i => i.id === "docs")!.write?.test(text));
  if (on("documenter")) add({ key: "documenter", agentId: "documenter", goal: docWrites ? "Escrever a documentação e os comentários em português nos arquivos, sem alterar o comportamento do código." : "Explicar em português como o código funciona, para outro desenvolvedor (entregue o texto no resultado; não edite arquivos).", dependsOn: afterBuild, engine: "llm", write: docWrites, criteria: ["Texto em português brasileiro", "Explicação fiel ao código analisado"], reason: wanted.get("documenter")! });
  const changed = [...(on("developer") ? ["developer"] : []), ...(on("documenter") && docWrites ? ["documenter"] : [])];
  const verifyAfter = changed.length ? changed : afterBuild;
  // Revisão, segurança e testes são independentes entre si: podem rodar em paralelo.
  if (on("reviewer")) add({ key: "reviewer", agentId: "reviewer", goal: "Revisar o trabalho realizado: qualidade, aderência aos requisitos e possíveis regressões.", dependsOn: verifyAfter, engine: "llm", write: false, criteria: ["Problemas concretos com evidência", "needsChanges=true somente se houver correção necessária"], reason: wanted.get("reviewer")! });
  if (on("security")) add({ key: "security", agentId: "security", goal: "Analisar os riscos de segurança: avaliar os achados da varredura local, configurações inseguras e exposição de dados. Nunca reproduzir valores de segredos.", dependsOn: ["audit", ...verifyAfter], engine: "llm", write: false, criteria: ["Riscos classificados por gravidade", "Sugestões de correção", "Nenhum segredo revelado"], reason: wanted.get("security")! });
  if (on("tester")) add({ key: "tester", agentId: "tester", goal: "Executar os testes e verificações apropriados e confirmar se os requisitos foram atendidos.", dependsOn: verifyAfter, engine: "llm", write: false, criteria: ["Comandos executados e resultados reais", "Nenhum teste declarado sem evidência"], reason: wanted.get("tester")! });

  // Agentes personalizados incluídos manualmente entram como especialistas extras.
  for (const id of selected) if (!stages.some(s => s.agentId === id) && id !== "orchestrator") add({ key: `extra-${id}`, agentId: id, goal: "Contribuir com a missão conforme a sua especialidade, usando as entregas anteriores.", dependsOn: afterPlan, engine: "llm", write: false, criteria: ["Entrega objetiva e verificável"], reason: wanted.get(id) ?? "Incluído manualmente." });

  const terminal = stages.filter(s => !stages.some(other => other.dependsOn.includes(s.key))).map(s => s.key);
  // Relatório final: no perfil Econômico é montado localmente; nos demais, o
  // Orquestrador usa um modelo leve para redigir a síntese.
  const localReport = input.profile === "economic" && !lead;
  add({ key: "report", agentId: "orchestrator", goal: "Consolidar as entregas em um relatório final em português: o que foi feito, arquivos, verificações, problemas e limitações.", dependsOn: terminal, engine: localReport ? "local" : "llm", write: false, weight: "light", criteria: ["Relatório fiel às entregas reais"], reason: localReport ? "Perfil Econômico: juntar resultados estruturados é uma operação local, sem tokens." : wanted.get("orchestrator")! });

  const llm = stages.filter(s => s.engine === "llm");
  for (const stage of llm) if (stage.routingError) warnings.push(`${input.agents.find(a => a.id === stage.agentId)?.name ?? stage.agentId}: ${stage.routingError}`);
  const names = [...new Set(stages.map(s => input.agents.find(a => a.id === s.agentId)?.name ?? s.agentId))];
  const skillNames = [...new Set(stages.flatMap(s => s.skills.map(skill => skill.name)))];
  const modelNames = [...new Set(llm.flatMap(s => s.routing ? [s.routing.modelName] : []))];
  return {
    intents: intents.map(item => ({ id: item.intent.id, label: item.intent.label, matched: item.matched })), complexity, needsWrite, stages, warnings,
    llmCalls: llm.length, localSteps: stages.length - llm.length,
    summary: `Agentes selecionados: ${names.join(", ")}. Skills selecionadas: ${skillNames.join(", ") || "nenhuma"}. Modelo(s): ${modelNames.join(", ") || "nenhum disponível"}.`,
  };
}

// Missões complexas sobem um degrau no porte do modelo das etapas de raciocínio.
function bump(weight: ModelTier, complexity: MissionPlan["complexity"]): ModelTier {
  if (complexity !== "high") return weight;
  return weight === "light" ? "light" : "heavy";
}

// Relatório final montado localmente a partir das entregas estruturadas.
export function assembleReport(objective: string, parts: { agent: string; stage: string; model?: string; local?: boolean; summary: string; files: string[]; findings: string[]; needsChanges: boolean; blockers: string[] }[], blockers: string[]): string {
  const lines = [`# Relatório da missão`, ``, `**Objetivo:** ${objective}`, ``];
  const pending = parts.filter(p => p.needsChanges);
  lines.push(`## Resumo`, pending.length ? `A equipe concluiu as etapas, mas ${pending.map(p => p.agent).join(", ")} apontou(aram) ajustes necessários.` : `Todas as etapas foram concluídas sem pendências de correção.`, ``);
  for (const part of parts) {
    lines.push(`## ${part.agent}${part.local ? " — ferramenta local (sem LLM)" : part.model ? ` — ${part.model}` : ""}`, part.summary.trim(), "");
    if (part.findings.length) lines.push("**Pontos identificados:**", ...part.findings.map(f => `- ${f}`), "");
    if (part.files.length) lines.push("**Arquivos:**", ...part.files.map(f => `- \`${f}\``), "");
  }
  const allBlockers = [...blockers, ...parts.flatMap(p => p.blockers)];
  if (allBlockers.length) lines.push("## Bloqueios e limitações", ...allBlockers.map(b => `- ${b}`), "");
  lines.push("---", "_Relatório montado localmente pelo Orquestrador a partir das entregas reais de cada etapa; nenhum modelo de IA foi usado nesta consolidação._");
  return lines.join("\n");
}
