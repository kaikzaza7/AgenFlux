import type { Approval, CatalogModel, EngineStatus, ProviderInfo, Task } from "../../src/lib/types.ts";
import { redact } from "../redact.ts";
import type { Engine, EngineHost, StartContext } from "./types.ts";

// Motor "local": executa ferramentas determinísticas do próprio AgenFlux
// (inventário, varredura de segredos, montagem de relatório). Não chama nenhum
// modelo de IA — é o que permite dizer "esta etapa custou zero tokens".
export type LocalTool = (task: Task) => Promise<string> | string;

export class LocalEngine implements Engine {
  readonly id = "local" as const;
  private host: EngineHost;
  private run: LocalTool;
  constructor(host: EngineHost, run: LocalTool) { this.host = host; this.run = run; }
  status(): EngineStatus { return { id: "local", name: "Ferramentas locais", status: "connected", message: "Sempre disponível: operações determinísticas sem LLM." }; }
  async connect() { /* sempre pronto */ }
  disconnect() { /* nada a encerrar */ }
  models(): CatalogModel[] { return []; }
  providers(): ProviderInfo[] { return []; }
  async start(context: StartContext) {
    const { task } = context;
    this.host.event(task.id, "local", `Ferramenta local "${task.stage ?? "tarefa"}" em execução. Nenhum modelo de IA foi chamado.`);
    // setImmediate: devolve o controle antes do trabalho síncrono de disco.
    setImmediate(async () => {
      try {
        const result = await this.run(task);
        if (!this.host.task(task.id) || !["running", "approval"].includes(this.host.task(task.id)!.status)) return;
        this.host.patch(task.id, { result: redact(result).slice(-100000), cost: 0 });
        this.host.finish(task.id, "completed");
      } catch (error) { this.host.finish(task.id, "failed", redact((error as Error).message)); }
    });
  }
  async interrupt(task: Task) { this.host.finish(task.id, "interrupted", "Execução interrompida."); }
  decide(_approval: Approval, _approve: boolean) { throw new Error("Ferramentas locais não solicitam aprovações."); }
  close() { /* nada a encerrar */ }
}
