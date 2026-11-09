import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { Task } from '../src/lib/types.ts';
import type { Payload } from './codex.ts';

export const LOW_RISK_PREFERENCE = 'user-authorized-low-risk-v1';
const verifierHash = '8327a9e8650d34270896335f175dd9e6914a0a2c9d1d856c290cb20fe71cd75c';
const secrets = /(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|auth\.json|credentials(?:\.[^/\\]*)?|id_rsa|id_ed25519)(?:$|[/\\])/i;
const sensitiveLiteral = /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b|BEGIN .*PRIVATE KEY/;

function contained(cwd: string, candidate: string, mustExist = true): boolean {
  try {
    if (!candidate || /[\0*?]/.test(candidate) || secrets.test(candidate)) return false;
    const root = realpathSync(cwd), target = resolve(root, candidate);
    const inside = (path: string) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'); };
    if (!inside(target)) return false;
    let actual = target;
    while (!existsSync(actual)) { if (mustExist || dirname(actual) === actual) return false; actual = dirname(actual); }
    return inside(realpathSync(actual));
  } catch { return false; }
}

// No evaluation: tokenize only literal PowerShell commands. Substitutions,
// redirections, call operators and script blocks fail closed.
function literalCommands(source: string): string[][] | undefined {
  if (!source || /[`$&<>\r\n]/.test(source)) return;
  const commands: string[][] = []; let words: string[] = [], word = '', quote = '';
  const push = () => { if (word) { words.push(word); word = ''; } };
  for (const char of source) {
    if (quote) { if (char === quote) quote = ''; else word += char; continue; }
    if (char === '"' || char === "'") { if (word) return; quote = char; }
    else if (char === ';' || char === '|') { push(); if (!words.length) return; commands.push(words); words = []; }
    else if (/\s/.test(char)) push();
    else if (/[(){}@]/.test(char)) return;
    else word += char;
  }
  if (quote) return;
  push(); if (words.length) commands.push(words);
  return commands.length ? commands : undefined;
}
function safeReadCommand(words: string[], cwd: string): boolean {
  const [raw, ...args] = words, command = raw.toLowerCase();
  if (command === 'get-location') return !args.length;
  if (command === 'select-object') return args.every(s => /^(?:-(?:First|Last|Skip|Property)|\d+|Name|Source|FullName|Length|Count|,)+$/i.test(s));
  if (command === 'get-command' || command === 'where.exe') return args.length > 0 && args.every(s => /^(?:(?:flutter|dart|node|supabase|python|py|git|bash|psql)(?:\.exe|\.ps1)?|,|-ErrorAction|SilentlyContinue)+$/i.test(s));
  if (command === 'node') {
    if (args.length === 2 && args[0] === '--check') return contained(cwd, args[1]);
    if (args.length !== 1 || args[0].replaceAll('\\', '/') !== 'scripts/check_corrections.cjs' || !contained(cwd, args[0])) return false;
    return createHash('sha256').update(readFileSync(resolve(cwd, args[0]))).digest('hex') === verifierHash;
  }
  if (command === 'rg') {
    let files = false, pattern = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--files') { files = true; continue; }
      if (['-n', '-i', '-l', '-F', '--line-number', '--ignore-case', '--files-with-matches', '--fixed-strings', '--hidden'].includes(arg)) continue;
      if (['-A', '-B', '-C', '-m', '--context', '--max-count'].includes(arg)) { if (!/^\d+$/.test(args[++i] ?? '')) return false; continue; }
      if (['-g', '--glob', '-t', '--type', '-e', '--regexp'].includes(arg)) { if (!args[++i] || args[i].startsWith('-') || secrets.test(args[i])) return false; if (arg === '-e' || arg === '--regexp') pattern = true; continue; }
      if (arg.startsWith('-')) return false;
      if (!files && !pattern) { pattern = true; continue; }
      if (!contained(cwd, arg)) return false;
    }
    return (files || pattern) && (files || !args.includes('--hidden'));
  }
  if (!['get-content', 'get-childitem', 'get-item', 'test-path', 'resolve-path'].includes(command)) return false;
  let paths = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i].toLowerCase();
    if (['-encoding', '-erroraction'].includes(arg)) { if (!['utf8', 'utf-8', 'silentlycontinue', 'stop'].includes((args[++i] ?? '').toLowerCase())) return false; continue; }
    if (['-totalcount', '-tail', '-readcount'].includes(arg)) { if (!/^\d+$/.test(args[++i] ?? '')) return false; continue; }
    if (['-literalpath', '-path', '-raw', '-name', '-force', '-file', '-directory'].includes(arg)) continue;
    if (arg.startsWith('-')) return false;
    for (const path of args[i].split(',')) { if (!contained(cwd, path, !['test-path'].includes(command))) return false; paths++; }
  }
  return paths > 0 || (command === 'get-childitem' && !args.length);
}
export interface LowRiskDecision { category: 'read' | 'files'; reason: string }
export function lowRiskApproval(task: Task, method: string, params: Payload, proposedFiles?: Payload[]): LowRiskDecision | undefined {
  if (task.mode !== 'real' || params.networkApprovalContext || params.additionalPermissions || params.grantRoot || params.proposedNetworkPolicyAmendments?.length) return;
  if (Array.isArray(params.availableDecisions) && !params.availableDecisions.includes('accept')) return;
  if (method === 'item/commandExecution/requestApproval' && params.kind === 'command') {
    if (!Array.isArray(params.commandActions) || !params.commandActions.length) return;
    const safe = params.commandActions.every((action: Payload) => {
      if (['read', 'listFiles', 'search'].includes(action.type)) return contained(task.cwd, action.path ?? task.cwd);
      if (action.type !== 'unknown' || typeof action.command !== 'string') return false;
      const commands = literalCommands(action.command);
      return commands?.every(command => safeReadCommand(command, task.cwd)) === true;
    });
    if (safe) return { category: 'read', reason: 'Leitura ou verificação local segura no workspace; sem rede, escalada ou regra permanente.' };
  }
  if (method !== 'item/fileChange/requestApproval' || task.permission !== 'workspace-write') return;
  const files = proposedFiles ?? params.proposedFileChanges;
  if (!Array.isArray(files) || !files.length) return;
  for (const file of files) {
    if (typeof file.path !== 'string' || !contained(task.cwd, file.path, false) || !['add', 'update'].includes(file.kind?.type) || file.kind?.move_path || file.move_path || typeof file.diff !== 'string' || !file.diff || sensitiveLiteral.test(file.diff)) return;
    const path = relative(realpathSync(task.cwd), resolve(task.cwd, file.path)).replaceAll('\\', '/');
    if (path.split('/').some((p: string) => p.startsWith('.')) || /\.(?:sql|toml|ya?ml|json|lock|sh|ps1|py|bat)$/i.test(path)) return;
    const docs = /^(?:docs\/.*\.(?:md|txt)|(?:README|CHANGELOG)\.md)$/i.test(path);
    const tests = /^(?:tests?|__tests__)\/.*\.(?:dart|tsx?|[cm]?js)$/i.test(path);
    const ui = /^(?:src\/(?:components|app)\/|lib\/.*\/presentation\/|lib\/shared\/).*\.(?:tsx|jsx|dart|css)$/i.test(path);
    if (!docs && !tests && !ui) return;
    if (!docs && !tests && /(?:^|\/)(?:auth|invitations|security|permissions|api|server|backend)(?:\/|\.)/i.test(path)) return;
    const changed = file.kind?.type === 'add' ? file.diff : file.diff.split(/\r?\n/).filter((line: string) => /^[+-]/.test(line) && !/^(?:---|\+\+\+)/.test(line)).join('\n') || file.diff;
    if (!docs && /\b(?:exec|spawn|child_process|fetch|axios|https?|service_role|deploy|publish|sandbox|approval_policy)\b|DROP\s+TABLE|DELETE\s+FROM/i.test(changed)) return;
    if (ui && !tests && /\b(?:auth|signIn|signOut|password|secret|token|cookie|localStorage|sessionStorage|supabase|rpc|permissions?|authorization)\b/i.test(changed)) return;
  }
  return { category: 'files', reason: 'Alteração reversível em documentação, testes ou interface no workspace com escrita autorizada; sem arquivos sensíveis, SQL, exclusões ou movimentações.' };
}
