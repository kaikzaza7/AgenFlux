import { resolve } from "node:path";
import type { Task } from "../src/lib/types.ts";

export function assertSafeUsageRetry(task: Task, workspace: string) {
  const samePath=(a:string,b:string)=>process.platform==="win32"?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
  if (task.mode!=="real" || task.status!=="failed" || !["reviewer","reporter"].includes(task.agentId) || !/usage limit|usageLimitExceeded/i.test(task.error??"") || task.result.trim() || task.files.length || !samePath(task.cwd,workspace)) throw new Error("Retomada recusada: somente revisão/relatório sem resultado ou alterações e falhos por limite de uso no workspace autorizado.");
}
export function usageRetry(task: Task, id: string, at: string, workspace: string): Task {
  assertSafeUsageRetry(task,workspace);
  const {threadId,turnId,error,tokenUsage,effectiveModel,effectiveEffort,...previous}=task;
  return {...previous,id,title:task.title.slice(0,83)+" — retomada após limite",status:"queued",createdAt:at,updatedAt:at,result:"",files:[],commands:[],permission:"read-only",attempt:(task.attempt??0)+1,retryOf:task.id};
}
