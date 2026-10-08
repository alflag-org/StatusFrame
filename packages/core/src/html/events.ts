import type { PublicIncident, PublicMaintenance } from "../types";
import { escapeHtml, type PageContext } from "./format";

function renderIncidentUpdates(updates: PublicIncident["updates"], context: PageContext): string {
  if (!updates.length) return "";

  const { text, renderDate } = context;
  const items = updates.map(update => `<li>
    <div><strong>${text.incident[update.status]}</strong><span class="muted">${renderDate(update.created_at)}</span></div>
    <p>${escapeHtml(update.body)}</p>
  </li>`).join("");
  return `<ol class="timeline">${items}</ol>`;
}

export function renderIncident(incident: PublicIncident, context: PageContext): string {
  const { text, renderDate, renderComponentNames } = context;
  const statusClass = incident.status === "resolved" ? "resolved" : incident.impact;
  const resolvedDate = incident.resolved_at ? ` — ${renderDate(incident.resolved_at)}` : "";

  return `<article class="card event">
    <div class="event-heading"><span class="pill ${statusClass}">${text.incident[incident.status]}</span><h3>${escapeHtml(incident.title)}</h3></div>
    <p class="muted event-date">${renderDate(incident.started_at)}${resolvedDate}</p>
    <p class="muted affected">${text.affected}: ${renderComponentNames(incident.components)}</p>
    ${renderIncidentUpdates(incident.updates, context)}
  </article>`;
}

export function renderMaintenance(maintenance: PublicMaintenance, context: PageContext): string {
  const { text, renderDate, renderComponentNames } = context;
  return `<article class="card event">
    <div class="event-heading"><span class="pill maintenance">${text.maintenanceStates[maintenance.status]}</span><h3>${escapeHtml(maintenance.title)}</h3></div>
    <p class="muted event-date">${renderDate(maintenance.starts_at)} — ${renderDate(maintenance.ends_at)}</p>
    <p class="muted affected">${text.affected}: ${renderComponentNames(maintenance.components)}</p>
    <p>${escapeHtml(maintenance.body)}</p>
  </article>`;
}
