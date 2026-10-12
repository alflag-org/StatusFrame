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
  const firstRecordedDay = days.findIndex(day => day.known_ms > 0);
  // Keep unknown days after recording starts so gaps remain visible.
  const bars = firstRecordedDay < 0 ? [] : days.slice(firstRecordedDay);
  const uptimePercent = component.history?.uptime_percent ?? null;
  const uptime = formatPercentage(uptimePercent);
  const historyLabel = `${component.name} · ${text.legend} · ${text.uptime} ${uptime}`;
  const firstDate = bars[0]?.date;
  const lastDate = bars.at(-1)?.date;
  const history = bars.length ? `
    <div class="history-bars" style="--history-days:${bars.length}" role="img" aria-label="${escapeHtml(historyLabel)}">${bars.map(day => renderHistoryBar(day, context)).join("")}</div>
    <p class="history-scale muted">${escapeHtml(firstDate!)}${firstDate === lastDate ? "" : ` — ${escapeHtml(lastDate!)}`} ${escapeHtml(context.timezoneLabel)}</p>` : "";
  const description = component.description
    ? `<p class="muted description">${escapeHtml(component.description)}</p>`
    : "";

  return `<article class="card component">
    <div class="component-heading">
      <div class="component-summary">
        <div class="component-title">${uptimePercent === null ? "" : `<span class="uptime ${component.status}">${uptime}</span>`}<h3>${escapeHtml(component.name)}</h3></div>
        <p class="uptime-period muted">${uptimePercent === null ? text.noHistory : `${text.uptime} · ${text.period}`}</p>
        ${description}
      </div>
      ${renderStatusBadge(component.status)}
    </div>
    ${history}
    <p class="last-check muted">${text.lastChecked}: ${component.last_checked_at ? renderCheckDate(component.last_checked_at) : text.notChecked}</p>
  </article>`;
}
