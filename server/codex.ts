import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { delimiter, join, extname, dirname } from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

// Wire names and payloads checked against `codex-cli 0.167.0 app-server generate-ts`.
// App-server speaks newline-delimited JSON-RPC without the jsonrpc member.
export type Payload = Record<string, any>;
export interface RpcMessage { id?: string | number; method?: string; params?: Payload; result?: Payload; error?: { code: number; message: string } }
export interface CodexTransport extends EventEmitter {
  connect(): Promise<void>;
  request(method: string, params: Payload): Promise<Payload>;
  respond(id: string | number, result: Payload): void;
  reject(id: string | number, message: string): void;
  close(): void;
}

function fromJs(entry: string): { file: string; args: string[] } {
  if (process.platform !== "win32") return { file: process.execPath, args: [entry] };
  // Spawn the native binary on Windows: terminating the npm Node shim would
  // otherwise risk leaving its Codex grandchild running after HQ shuts down.
  const triple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const candidates = [join(dirname(entry), "..", "vendor", triple, "bin", "codex.exe")];
  try {
    const resolve = createRequire(entry).resolve;
    const packageJson = resolve(`@openai/codex-win32-${process.arch}/package.json`);
    candidates.unshift(join(dirname(packageJson), "vendor", triple, "bin", "codex.exe"));
  } catch { /* Older npm distributions bundled vendor directly. */ }
  const file = candidates.find(existsSync);
  if (!file) throw new Error("Binário nativo do Codex não encontrado. Configure CODEX_BIN para codex.exe ou reinstale o CLI oficial.");
  return { file, args: [] };
}
export function codexCommand(): { file: string; args: string[] } {
  const explicit = process.env.CODEX_BIN;
  if (explicit) {
    if (!existsSync(explicit) || ![".exe", ".js", ".mjs", ""].includes(extname(explicit))) throw new Error("CODEX_BIN deve apontar para codex.exe ou bin/codex.js; arquivos .cmd/.ps1 não são executados via shell.");
    return /\.m?js$/.test(explicit) ? fromJs(explicit) : { file: explicit, args: [] };
  }
  for (const path of (process.env.PATH ?? "").split(delimiter)) {
    const binary = join(path, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(binary)) return { file: binary, args: [] };
    const entry = join(path, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (existsSync(entry)) return fromJs(entry);
  }
  throw new Error("Codex não encontrado. Instale o CLI oficial ou configure CODEX_BIN com o caminho absoluto do executável.");
}

export class CodexClient extends EventEmitter implements CodexTransport {
  private child?: ChildProcessWithoutNullStreams;
  private seq = 0;
  private pending = new Map<number, { resolve: (value: Payload) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private connecting?: Promise<void>;
  private ready = false;
  private stderr = "";
  private resolveCommand: typeof codexCommand;
  constructor(resolveCommand: typeof codexCommand = codexCommand) { super(); this.resolveCommand = resolveCommand; }
  connect(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async open() {
    const command = this.resolveCommand();
    this.stderr = "";
    const child = spawn(command.file, [...command.args, "app-server", "--listen", "stdio://"], { windowsHide: true, stdio: "pipe", env: process.env });
    this.child = child;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", line => {
      let message: RpcMessage;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method) { this.emit(message.id === undefined ? "notification" : "serverRequest", message); return; }
      const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id as number);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result ?? {});
    });
    child.stderr.on("data", chunk => { this.stderr = (this.stderr + String(chunk)).slice(-4000); });
    child.stdin.on("error", error => { if (this.child === child) this.disconnected(error.message); });
    child.on("error", error => { if (this.child === child) this.disconnected(error.message); });
    child.on("exit", (code, signal) => { lines.close(); if (this.child === child) this.disconnected(`Codex encerrou (${signal ?? code}). ${this.stderr.slice(-1000)}`); });
    try {
      const info = await this.request("initialize", { clientInfo: { name: "agent_hq", title: "AgenFlux", version: "2.0.0" }, capabilities: { experimentalApi: true } });
      this.write({ method: "initialized", params: {} });
      this.ready = true;
      this.emit("ready", info);
    } catch (error) { child.kill(); throw error; }
  }
  private disconnected(message: string) {
    this.ready = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
    this.pending.clear(); this.emit("disconnect", message);
  }
  request(method: string, params: Payload): Promise<Payload> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Tempo limite em ${method}. Verifique a conexão do Codex.`)); }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  respond(id: string | number, result: Payload) { this.write({ id, result }); }
  reject(id: string | number, message: string) { this.write({ id, error: { code: -32601, message } }); }
  private write(message: RpcMessage) {
    if (!this.child?.stdin.writable) throw new Error("Codex desconectado.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  close() { this.ready = false; this.child?.kill(); }
}
