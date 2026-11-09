import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Task } from "../src/lib/types.ts";
import type { Payload } from "./codex.ts";

// Installed AskForApproval schema: granular sandbox_approval:false forbids
// escalation. A read approval is distinct from granting additional access.
export const READ_ONLY_POLICY = { granular: { sandbox_approval: false, rules: true, skill_approval: false, request_permissions: false, mcp_elicitations: false } };
export function canApproveReadOnly(task: Task, method: string, params: Payload): boolean {
  if (method !== "item/commandExecution/requestApproval" || params.kind !== "command" || params.networkApprovalContext || params.additionalPermissions || params.proposedExecpolicyAmendment || params.proposedNetworkPolicyAmendments?.length) return false;
  if (!Array.isArray(params.commandActions) || !params.commandActions.length) return false;
  let root: string; try { root = realpathSync(task.cwd); } catch { return false; }
  return params.commandActions.every((action: Payload) => {
    if (!["read", "listFiles", "search"].includes(action.type)) return false;
    const target = typeof action.path === "string" ? resolve(task.cwd, action.path) : root;
    let actual: string; try { actual = realpathSync(target); } catch { return false; }
    const rel = relative(root, actual);
    return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
  });
}
