import type { PublicState } from "../config";
import type { PublicSnapshot } from "../types";
import { pageText } from "./messages";

export function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return value.replace(/[&<>"']/g, character => entities[character]!);
}

export function createPageContext(snapshot: PublicSnapshot) {
  const language = snapshot.site.language ?? "en";
  const formatter = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: snapshot.site.timezone
  });
  const timezone = formatter.resolvedOptions().timeZone;
  const timezoneLabel = timezone === "Asia/Tokyo" ? "JST" : timezone;
  const localizedText = pageText[language];
  const text = {
    ...localizedText,
    legend: `${localizedText.legend} · ${timezoneLabel}`,
    date: language === "ja" ? `${localizedText.date}（${timezoneLabel}）` : `${localizedText.date} (${timezoneLabel})`
  };

  return {
    language,
    text,
    timezoneLabel,
    renderDate(value: string): string {
      const formatted = formatter.format(new Date(value));
      return `<time datetime="${escapeHtml(value)}">${escapeHtml(formatted)} ${escapeHtml(timezoneLabel)}</time>`;
    },
    formatPercentage(value: number | null): string {
      return value === null ? text.noData : `${value.toFixed(2)}%`;
    },
    renderStatusBadge(status: PublicState): string {
      return `<span class="status ${status}"><span class="dot" aria-hidden="true"></span>${text.states[status]}</span>`;
    },
    renderComponentNames(ids: string[]): string {
      const names = ids.map(id => snapshot.components.find(component => component.id === id)?.name ?? id);
      return escapeHtml(names.join(language === "ja" ? "、" : ", "));
    }
  };
}

export type PageContext = ReturnType<typeof createPageContext>;
