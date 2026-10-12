import type { PublicComponent, PublicHistory } from "../types";
import { escapeHtml, type PageContext } from "./format";

type HistoryDay = PublicHistory["days"][number];

function renderHistoryBar(day: HistoryDay, context: PageContext): string {
  const { text, formatPercentage } = context;
  const status = day.known_ms ? text.states[day.status] : text.noData;
  const title = `${day.date} ${context.timezoneLabel} · ${status} · ${text.uptime} ${formatPercentage(day.uptime_percent)}`;
  return `<span class="history-day ${day.status}" title="${escapeHtml(title)}"></span>`;
}

export function renderComponent(component: PublicComponent, context: PageContext): string {
  const { text, formatPercentage, renderStatusBadge, renderCheckDate } = context;
  const days = component.history?.days ?? [];
  const bars: HistoryDay[] = days.length ? days : Array.from({ length: 90 }, () => ({
    date: "", status: "unknown", known_ms: 0, uptime_percent: null
  }));
  const uptime = formatPercentage(component.history?.uptime_percent ?? null);
  const historyLabel = `${component.name} · ${text.legend} · ${text.uptime} ${uptime}`;
  const description = component.description
    ? `<p class="muted description">${escapeHtml(component.description)}</p>`
    : "";

  return `<article class="card component">
    <div class="component-heading">
      <div class="component-summary">
        <div class="component-title"><span class="uptime ${component.status}">${uptime}</span><h3>${escapeHtml(component.name)}</h3></div>
        <p class="uptime-period muted">${text.uptime} · ${text.period}</p>
        ${description}
      </div>
      ${renderStatusBadge(component.status)}
    </div>
    <div class="history-bars" role="img" aria-label="${escapeHtml(historyLabel)}">${bars.map(day => renderHistoryBar(day, context)).join("")}</div>
    <div class="history-scale muted">
      <span>${text.firstDay}</span><span>${text.today}</span>
    </div>
    <p class="last-check muted">${text.lastChecked}: ${component.last_checked_at ? renderCheckDate(component.last_checked_at) : text.notChecked}</p>
  </article>`;
}
