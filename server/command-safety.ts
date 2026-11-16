// Classificação conservadora de comandos de shell. Usada para decidir se um pedido
// de aprovação pode ser aceito em missões somente leitura. Na dúvida, responde false.

const READ_COMMANDS = new Set([
  "ls", "dir", "cat", "type", "head", "tail", "wc", "pwd", "tree", "stat", "file", "which", "where", "whoami", "echo",
  "rg", "grep", "egrep", "fgrep", "findstr", "sort", "uniq", "cut", "nl", "basename", "dirname", "realpath", "du", "df", "date",
  "get-childitem", "get-content", "get-item", "get-location", "select-string", "select-object", "measure-object", "test-path", "resolve-path", "gci", "gc",
]);
const GIT_READ = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "describe", "remote", "shortlog", "tag"]);
const SECRET_PATH = /(^|[\\/\s"'=])(\.env(\.[\w.-]+)?|auth\.json|credentials(\.[\w.-]+)?|id_rsa|id_ed25519|\.npmrc|\.netrc)(\s|$|["'])/i;

export function readOnlyCommand(source: string): boolean {
  if (typeof source !== "string" || !source.trim() || source.length > 2000) return false;
  // Substituições, redirecionamentos, encadeamentos e blocos falham fechados.
  if (/[`$<>\r\n{}()]|&&|\|\||;|(^|\s)&(\s|$)/.test(source) || SECRET_PATH.test(source)) return false;
  return source.split("|").every(segment => {
    const words = segment.trim().split(/\s+/);
    const command = words[0]?.toLowerCase().replace(/\.exe$/, "");
    if (!command) return false;
    if (command === "git") {
      const sub = words.slice(1).find(word => !word.startsWith("-"));
      return Boolean(sub && GIT_READ.has(sub) && !words.some(word => /^(--output|-o|--exec|-c)$/.test(word)));
    }
    if (command === "find") return !words.some(word => /^-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(word));
    if (command === "sed") return words.includes("-n") && !words.some(word => /^-i|^--in-place/.test(word));
    return READ_COMMANDS.has(command);
  });
}

// Texto curto de risco exibido no cartão de aprovação.
export function commandRisk(source: string): string {
  const command = source.toLowerCase();
  if (/\b(rm|rmdir|del|remove-item|unlink|format|mkfs|dd)\b/.test(command)) return "Pode EXCLUIR arquivos ou dados. Confira o alvo com atenção.";
  if (/\b(git\s+push|deploy|publish|vercel|netlify|firebase\s+deploy|kubectl|terraform\s+apply|docker\s+push)\b/.test(command)) return "Publica ou altera um ambiente externo (deploy/push). Só aprove se realmente quiser isso agora.";
  if (/\b(curl|wget|invoke-webrequest|iwr|irm|ssh|scp|nc)\b/.test(command)) return "Acessa a rede. Dados do projeto podem sair do seu computador.";
  if (/\b(npm|pnpm|yarn|pip|pipx|cargo|go)\s+(install|add|update|ci|i)\b/.test(command)) return "Instala ou atualiza dependências e pode executar scripts de terceiros.";
  if (/\b(sudo|runas|chmod|chown|icacls|reg\s+add|setx)\b/.test(command)) return "Altera permissões ou configurações do sistema.";
  if (readOnlyCommand(source)) return "Comando de leitura dentro do workspace; não altera arquivos.";
  return "Executa um programa no seu computador com as suas permissões. Verifique o comando antes de aprovar.";
}
