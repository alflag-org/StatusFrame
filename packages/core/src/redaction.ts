import type { PublicSnapshot, ValidationIssue } from "./types";

const RFC1918_OR_LOCAL_IPV4 =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)\b/;
const LOCAL_IPV6 = /\b(?:localhost|::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i;
const INTERNAL_HOSTNAME = /\b(?:localhost|[\w.-]+(?:\.internal|\.local|\.lan|\.corp|\.home|\.priv))\b/i;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/i;
const WEBHOOK_PATTERN = /\bhttps:\/\/(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services)\/[^\s"'<>]+/i;
const TOKEN_PATTERN = /\b(?:xox[baprs]-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]+)\b/i;
const SECRET_WORD_PATTERN = /\b(?:api[_-]?key|secret|token|password)=?[A-Za-z0-9._~:/+-]{8,}\b/i;
const STACK_TRACE_PATTERN = /\b(?:at\s+\S+\s+\(|Traceback \(most recent call last\)|Error:\s.+\n\s+at\s+)/;

export interface LeakageMatch {
  path: string;
  value: string;
  reason: string;
}

export function findPublicLeakage(value: unknown, path = "$"): LeakageMatch[] {
  const matches: LeakageMatch[] = [];

  if (typeof value === "string") {
    const reason = leakageReason(value);
    if (reason) {
      matches.push({ path, value, reason });
    }
    return matches;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      matches.push(...findPublicLeakage(item, `${path}[${index}]`));
    });
    return matches;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      matches.push(...findPublicLeakage(child, `${path}.${key}`));
    }
  }

  return matches;
}

export function validatePublicOutput(snapshot: PublicSnapshot): ValidationIssue[] {
  return findPublicLeakage(snapshot).map((match) => ({
    path: match.path,
    message: `Public output may leak ${match.reason}`
  }));
}

export function assertPublicOutput(snapshot: PublicSnapshot): void {
  const issues = validatePublicOutput(snapshot);
  if (issues.length > 0) {
    const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Public output validation failed: ${detail}`);
  }
}

function leakageReason(value: string): string | undefined {
  if (RFC1918_OR_LOCAL_IPV4.test(value)) return "a private or local IPv4 address";
  if (LOCAL_IPV6.test(value)) return "a private or local IPv6 address or localhost";
  if (WEBHOOK_PATTERN.test(value)) return "a webhook URL";
  if (TOKEN_PATTERN.test(value)) return "a token";
  if (SECRET_WORD_PATTERN.test(value)) return "a secret-like value";
  if (STACK_TRACE_PATTERN.test(value)) return "a stack trace or raw error";
  if (URL_PATTERN.test(value)) return "a raw URL";
  if (INTERNAL_HOSTNAME.test(value)) return "an internal hostname";
  return undefined;
}
