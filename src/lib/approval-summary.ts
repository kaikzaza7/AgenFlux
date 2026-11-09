import type { Approval } from "./types.ts";

export function approvalSummary({ method, action }: Pick<Approval, "method" | "action">) {
  const command = action.toLowerCase();
  if (method === "demo/approval") return "Executar testes do cenário";
  if (method === "item/fileChange/requestApproval") return "Alterar arquivos do workspace";
  if (/autorizar rede|\b(curl|wget|invoke-webrequest)\b/.test(command)) return "Acessar um serviço externo";
  if (/\b(rm|rmdir|remove-item|unlink|del)\b/.test(command)) return "Excluir arquivos ou pastas";
  if (/\b(mkdir|move-item|rename-item|mv|new-item)\b/.test(command)) return "Organizar arquivos e pastas";
  if (/\b(npm|pnpm|yarn) (install|add|update|ci)\b/.test(command)) return "Atualizar dependências";
  if (/\b(test|pytest|vitest|jest)\b/.test(command)) return "Executar testes";
  if (/\b(rg|grep|ls|dir|cat|get-content|get-childitem)\b/.test(command)) return "Consultar arquivos do workspace";
  return "Executar uma ação no workspace";
}
