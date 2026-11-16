import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Reconstrói data/packages/ecc/catalog.json a partir dos arquivos presentes em
// source/. O catálogo é só um índice (nome, descrição, SHA-256) e pode ser
// regenerado a qualquer momento; se já existir, nada é alterado.
const frontmatter = (text: string) => {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const read = (key: string) => block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  return { name: read("name"), description: read("description"), model: read("model") };
};
const responsible = (slug: string) => /review|evaluator|analyzer|hunter|auditor/.test(slug) ? "reviewer" : /security|sanitizer/.test(slug) ? "security" : /plan|architect|chief/.test(slug) ? "planner" : /doc|comment/.test(slug) ? "documenter" : /test|e2e|tdd/.test(slug) ? "tester" : /explorer|miner|lookup/.test(slug) ? "analyst" : "developer";

export function ensureEccCatalog(root = resolve("data/packages/ecc")): { created: boolean; entries: number } {
  const target = join(root, "catalog.json");
  if (existsSync(target)) return { created: false, entries: 0 };
  const source = join(root, "source");
  if (!existsSync(source)) return { created: false, entries: 0 };
  let commit = "0".repeat(40);
  try { commit = JSON.parse(readFileSync(join(root, "locale.pt-BR.json"), "utf8")).sourceCommit ?? commit; } catch { /* sem tradução */ }
  const entries: Record<string, unknown>[] = [];
  const add = (kind: "agent" | "skill", slug: string, sourcePath: string) => {
    if (!/^[a-z0-9-]+$/.test(slug)) return;
    const bytes = readFileSync(join(source, sourcePath)); const meta = frontmatter(bytes.toString("utf8"));
    entries.push({ id: `ecc:${kind}:${slug}`, kind, slug, name: meta.name ?? slug, description: meta.description ?? "", originalName: meta.name ?? slug, ...(meta.model ? { originalModel: meta.model } : {}), sourcePath, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, agentId: responsible(slug) });
  };
  if (existsSync(join(source, "agents"))) for (const file of readdirSync(join(source, "agents")).sort()) if (file.endsWith(".md")) add("agent", file.slice(0, -3), `agents/${file}`);
  if (existsSync(join(source, "skills"))) for (const dir of readdirSync(join(source, "skills")).sort()) if (existsSync(join(source, "skills", dir, "SKILL.md"))) add("skill", dir, `skills/${dir}/SKILL.md`);
  if (!entries.length) return { created: false, entries: 0 };
  writeFileSync(target, JSON.stringify({ version: 1, repository: "affaan-m/ECC", commit, license: "MIT", entries }, null, 1));
  return { created: true, entries: entries.length };
}
