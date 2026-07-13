const SENSITIVE_KEY = /(authorization|bearer|token|secret|password|code|state|verifier|header|cookie|query)/i;

export function sanitizeAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAuditMetadata(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return value.slice(0, 500);
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = sanitizeAuditMetadata(item, depth + 1);
  }
  return result;
}
