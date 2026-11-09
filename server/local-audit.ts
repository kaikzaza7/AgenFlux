import { readdirSync, statSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

// Bounded local scan. Only locations and categories leave this function.
// This does not claim to identify every secret or dependency vulnerability.
export function localAudit(workspace: string) {
  const root = realpathSync(workspace);
  const findings: { file: string; line: number; category: string }[] = [];
  const stack = [root]; let files = 0, bytes = 0, skipped = 0;
  const excluded = new Set(["node_modules", ".git", ".next", "data", "dist", "build", ".protocol"]);
  while (stack.length && files < 1200 && bytes < 8_000_000 && findings.length < 100) {
    const dir = stack.pop()!;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { skipped++; continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) { skipped++; continue; }
      const path = resolve(dir, entry.name);
      if (!path.startsWith(root + sep)) continue;
      if (entry.isDirectory()) { if (!excluded.has(entry.name)) stack.push(path); continue; }
      if (!entry.isFile() || files >= 1200 || bytes >= 8_000_000 || findings.length >= 100) continue;
      try {
        const size = statSync(path).size;
        if (size > 500_000 || size + bytes > 8_000_000) { skipped++; continue; }
        const buffer = readFileSync(path); files++; bytes += buffer.length;
        if (buffer.includes(0)) { skipped++; continue; }
        const lines = buffer.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length && findings.length < 100; i++) {
          const line = lines[i];
          if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) findings.push({file:relative(root,path),line:i+1,category:"Possível chave privada"});
          else if (/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/.test(line)) findings.push({file:relative(root,path),line:i+1,category:"Possível credencial com prefixo reconhecido"});
          else if (/(?:password|passwd|api[_-]?key|secret|access[_-]?token)["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i.test(line)) findings.push({file:relative(root,path),line:i+1,category:"Possível segredo atribuído em literal (pode ser exemplo ou teste)"});
        }
      } catch { skipped++; }
    }
  }
  return { files, bytes, skipped, truncated: stack.length > 0 || findings.length >= 100, findings, limitations: "Varredura local heurística e limitada; não prova ausência de segredos. Histórico Git e CVEs não verificados automaticamente. Nenhum valor de credencial foi incluído." };
}
