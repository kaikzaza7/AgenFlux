import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { redact } from "./redact.ts";

// Inventário local do workspace, sem LLM. Dá ao Analista um mapa pronto do
// projeto (menos tokens gastos explorando) e serve de contexto para modelos sem
// ferramentas. Limites fixos mantêm a operação leve em computadores modestos.

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "target", ".venv", "venv", "__pycache__", ".dart_tool", ".gradle", ".idea", ".vscode", "coverage", ".protocol", ".cache", "vendor", "Pods"]);
const KEY_FILES = /^(readme(\.[a-z-]+)?\.md|package\.json|tsconfig\.json|next\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|pyproject\.toml|requirements\.txt|pubspec\.yaml|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|composer\.json|gemfile|dockerfile|docker-compose\.ya?ml|makefile|schema\.prisma|agents\.md|claude\.md|opencode\.jsonc?)$/i;
const LANGUAGES: Record<string, string> = { ".ts": "TypeScript", ".tsx": "TypeScript/React", ".js": "JavaScript", ".jsx": "JavaScript/React", ".mjs": "JavaScript", ".py": "Python", ".dart": "Dart", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".cs": "C#", ".php": "PHP", ".rb": "Ruby", ".swift": "Swift", ".sql": "SQL", ".css": "CSS", ".scss": "SCSS", ".html": "HTML", ".vue": "Vue", ".svelte": "Svelte", ".md": "Markdown", ".sh": "Shell", ".ps1": "PowerShell", ".c": "C", ".cpp": "C++", ".h": "C/C++" };
const SECRET_FILE = /(^|[\\/])(\.env(\..*)?|auth\.json|credentials(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.key)$/i;

export interface WorkspaceScan { root: string; files: number; bytes: number; truncated: boolean; languages: { name: string; files: number }[]; keyFiles: string[]; tree: string[]; stack: string[]; scripts: string[]; largest: { file: string; lines: number }[]; sensitiveFiles: string[] }

export function scanWorkspace(cwd: string, limit = 4000): WorkspaceScan {
  const root = realpathSync(cwd);
  const counts = new Map<string, number>(); const keyFiles: string[] = [], tree: string[] = [], sensitiveFiles: string[] = [];
  const sizes: { file: string; bytes: number }[] = [];
  let files = 0, bytes = 0, truncated = false;
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name); const rel = relative(root, path).split(sep).join("/");
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".github" && entry.name !== ".opencode")) continue;
        if (depth < 2 && tree.length < 120) tree.push(`${rel}/`);
        stack.push({ dir: path, depth: depth + 1 }); continue;
      }
      if (!entry.isFile()) continue;
      if (files >= limit) { truncated = true; continue; }
      files++;
      let size = 0; try { size = statSync(path).size; } catch { /* arquivo removido durante a varredura */ }
      bytes += size;
      if (SECRET_FILE.test(rel)) { if (sensitiveFiles.length < 30) sensitiveFiles.push(rel); continue; }
      const language = LANGUAGES[extname(entry.name).toLowerCase()];
      if (language) { counts.set(language, (counts.get(language) ?? 0) + 1); if (language !== "Markdown" && size < 2_000_000) sizes.push({ file: rel, bytes: size }); }
      if (KEY_FILES.test(entry.name) && keyFiles.length < 40) keyFiles.push(rel);
      if (depth < 1 && tree.length < 120) tree.push(rel);
    }
  }
  const detected = new Set<string>(); const scripts: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, label] of [["next", "Next.js"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["express", "Express"], ["fastify", "Fastify"], ["@nestjs/core", "NestJS"], ["tailwindcss", "Tailwind CSS"], ["prisma", "Prisma"], ["typescript", "TypeScript"], ["vitest", "Vitest"], ["jest", "Jest"], ["@playwright/test", "Playwright"], ["electron", "Electron"], ["@supabase/supabase-js", "Supabase"]] as const) if (deps[name]) detected.add(`${label} ${String(deps[name]).replace(/^[\^~]/, "")}`);
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) if (scripts.length < 15) scripts.push(`npm run ${name} → ${redact(String(command)).slice(0, 120)}`);
  } catch { /* projeto sem package.json */ }
  for (const [file, label] of [["pubspec.yaml", "Flutter/Dart"], ["pyproject.toml", "Python (pyproject)"], ["requirements.txt", "Python (requirements)"], ["Cargo.toml", "Rust"], ["go.mod", "Go"], ["pom.xml", "Java/Maven"], ["Dockerfile", "Docker"]] as const) if (keyFiles.some(key => key.toLowerCase() === file.toLowerCase())) detected.add(label);
  const largest = sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 8).map(item => {
    let lines = 0; try { lines = readFileSync(join(root, item.file), "utf8").split("\n").length; } catch { /* ilegível */ }
    return { file: item.file, lines };
  });
  return { root, files, bytes, truncated, languages: [...counts].map(([name, total]) => ({ name, files: total })).sort((a, b) => b.files - a.files).slice(0, 12), keyFiles, tree: tree.sort(), stack: [...detected], scripts, largest, sensitiveFiles };
}

// Resultado no mesmo contrato JSON das etapas com LLM, para ser encaminhado adiante.
export function scanSummary(scan: WorkspaceScan) {
  const languages = scan.languages.map(l => `${l.name} (${l.files})`).join(", ") || "nenhuma linguagem reconhecida";
  return {
    summary: `Inventário local (sem LLM): ${scan.files} arquivo(s)${scan.truncated ? "+ (limite atingido)" : ""}, ${(scan.bytes / 1024).toFixed(0)} KB. Linguagens: ${languages}. Tecnologias detectadas: ${scan.stack.join(", ") || "não identificadas automaticamente"}.`,
    files: scan.keyFiles.slice(0, 20),
    findings: [
      `Estrutura principal: ${scan.tree.slice(0, 40).join(", ") || "(vazia)"}`,
      ...(scan.scripts.length ? [`Scripts disponíveis: ${scan.scripts.join("; ")}`] : []),
      ...(scan.largest.length ? [`Maiores arquivos de código: ${scan.largest.map(l => `${l.file} (${l.lines} linhas)`).join(", ")}`] : []),
      ...(scan.sensitiveFiles.length ? [`Arquivos potencialmente sensíveis presentes (conteúdo NÃO lido): ${scan.sensitiveFiles.join(", ")}`] : []),
    ],
    needsChanges: false, blockers: [] as string[],
  };
}

// Pacote de contexto para modelos sem ferramentas (ex.: Ollama direto): inventário
// mais trechos dos arquivos-chave, com segredos mascarados e tamanho limitado.
export function contextPack(cwd: string, budget = 14000): string {
  const scan = scanWorkspace(cwd, 1500);
  const parts = [JSON.stringify(scanSummary(scan))];
  let used = parts[0].length;
  for (const file of [...scan.keyFiles, ...scan.largest.map(l => l.file)]) {
    if (used >= budget) break;
    try {
      const text = redact(readFileSync(join(scan.root, file), "utf8")).slice(0, Math.min(2500, budget - used));
      parts.push(`--- ${file} (trecho) ---\n${text}`); used += text.length + file.length + 20;
    } catch { /* ignora arquivo ilegível */ }
  }
  return parts.join("\n\n");
}
