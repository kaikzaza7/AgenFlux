import { CodexClient, codexCommand } from "../server/codex.ts";
import { spawnSync } from "node:child_process";

const client = new CodexClient();
client.on("disconnect", () => {});
try {
  console.log(`Node ${process.version} • ${process.platform}/${process.arch}`);
  const command = codexCommand();
  const version = spawnSync(command.file, [...command.args, "--version"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  console.log(version.stdout.trim() || "Versão indisponível.");
  if (version.error) throw version.error;
  await client.connect();
  console.log("OK: initialize → initialized via stdio.");
  const account = await client.request("account/read", { refreshToken: false });
  console.log(account.account?.type === "chatgpt" ? "OK: autenticação ChatGPT disponível (nenhuma credencial exibida)." : "ATENÇÃO: entre com ChatGPT via codex login. O AgenFlux não usa API keys.");
  const models = await client.request("model/list", { limit: 1 });
  console.log(`OK: model/list respondeu (${Array.isArray(models.data) ? models.data.length : 0} nesta página). Catálogo não confirma acesso nem limites.`);
  console.log("Nenhum turno de inferência foi iniciado.");
} catch (error) { console.error(`Diagnóstico: ${(error as Error).message}`); process.exitCode = 1; }
finally { client.close(); }
