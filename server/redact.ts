// Defense in depth, not a general secret detector. Never persist streamed deltas:
// a credential can span multiple chunks. Sanitize complete messages first.
export function redact(value: string): string {
  if (/^\s*[\[{]/.test(value)) {
    try { return JSON.stringify(redactValue(JSON.parse(value))); } catch { /* Plain text or an incomplete JSON value. */ }
  }
  return value
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g, "[CHAVE PRIVADA REMOVIDA]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[SEGREDO REMOVIDO]")
    .replace(/((?:["']?[\w.-]*(?:password|passwd|secret|token|api[_-]?key)[\w.-]*["']?)\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1"[SEGREDO REMOVIDO]"')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[SEGREDO REMOVIDO]");
}
export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" && /^(password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token)$/i.test(key) ? "[SEGREDO REMOVIDO]" : redactValue(item)])) as T;
  return value;
}
