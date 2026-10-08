import type { Monitor, MonitorContext } from "@statusframe/core";
import { boundedText, check } from "./common";
const recordNumbers = { A: 1, AAAA: 28, CNAME: 5, TXT: 16, MX: 15 } as const;
export function normalizeDns(type: keyof typeof recordNumbers, value: string): string {
  if (type === "CNAME") return value.toLowerCase().replace(/\.$/, "");
  if (type === "AAAA") return new URL(`http://[${value}]/`).hostname;
  if (type === "MX") {
    const match = /^(\d+)\s+(\S+)$/.exec(value.trim());
    if (!match) throw new Error("Invalid MX value");
    return `${Number(match[1])} ${match[2]!.toLowerCase().replace(/\.$/, "")}`;
  }
  if (type === "TXT" && value.startsWith('"')) {
    const parts = value.match(/"(?:[^"\\]|\\.)*"/g);
    if (!parts || parts.join(" ") !== value) throw new Error("Invalid TXT value");
    return parts.map(part => JSON.parse(part) as string).join("");
  }
  return value;
}
export function dnsMonitor(monitor: Extract<Monitor, { type: "dns" }>, context: MonitorContext) {
  return check(monitor, context, async signal => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", monitor.name); url.searchParams.set("type", monitor.record_type);
    context.budget.take({ subrequests: 1 });
    const response = await context.io.fetch(url.href, { headers: { accept: "application/dns-json" }, redirect: "manual", signal, cache: "no-store" });
    if (!response.ok) { await response.body?.cancel(); return false; }
    const data: unknown = JSON.parse(await boundedText(response, 65_536, signal));
    if (!data || typeof data !== "object" || !("Status" in data) || data.Status !== 0 || !("Answer" in data) || !Array.isArray(data.Answer)) return false;
    const answers = data.Answer.filter((answer: unknown): answer is { type: number; data: string } =>
      !!answer && typeof answer === "object" && "type" in answer && answer.type === recordNumbers[monitor.record_type] && "data" in answer && typeof answer.data === "string"
    ).map(answer => normalizeDns(monitor.record_type, answer.data));
    if (!answers.length) return false;
    return !monitor.expect || monitor.expect.values.every(value => answers.includes(normalizeDns(monitor.record_type, value)));
  });
}
