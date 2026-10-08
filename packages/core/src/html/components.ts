import type { PublicComponent, PublicHistory } from "../types";
import { escapeHtml, type PageContext } from "./format";

type HistoryDay = PublicHistory["days"][number];

function renderHistoryBar(day: HistoryDay, context: PageContext): string {
  const { text, formatPercentage } = context;
  const status = day.known_ms ? text.states[day.status] : text.noData;
  const title = `${day.date} ${context.timezoneLabel} · ${status} · ${text.uptime} ${formatPercentage(day.uptime_percent)}`;
  return `<span class="history-day ${day.status}" title="${escapeHtml(title)}"></span>`;
}

function renderDailyHistory(name: string, days: HistoryDay[], context: PageContext): string {
  if (!days.length) return "";

  const { text, formatPercentage } = context;
  const rows = [...days].reverse().map(day => {
    const status = day.known_ms ? text.states[day.status] : text.noData;
    return `<tr><th scope="row">${day.date}</th><td>${status}</td><td>${formatPercentage(day.uptime_percent)}</td></tr>`;
  }).join("");

  return `<details class="daily-details">
    <summary>${text.details}</summary>
    <div class="table-scroll">
      <table>
        <caption>${escapeHtml(name)} · ${text.legend}</caption>
        <thead><tr><th scope="col">${text.date}</th><th scope="col">${text.status}</th><th scope="col">${text.uptime}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>`;
}

export function renderComponent(component: PublicComponent, context: PageContext): string {
  const { text, formatPercentage, renderStatusBadge } = context;
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
      <div><h3>${escapeHtml(component.name)}</h3>${description}</div>
      ${renderStatusBadge(component.status)}
    </div>
    <div class="history-bars" role="img" aria-label="${escapeHtml(historyLabel)}">${bars.map(day => renderHistoryBar(day, context)).join("")}</div>
    <div class="history-scale muted">
      <span>${text.firstDay}</span><span>${text.uptime} <strong>${uptime}</strong></span><span>${text.today}</span>
    </div>
    ${renderDailyHistory(component.name, days, context)}
  </article>`;
}
