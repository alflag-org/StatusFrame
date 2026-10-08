import type { PublicSnapshot } from "./types";
import { renderComponent } from "./html/components";
import { renderIncident, renderMaintenance } from "./html/events";
import { createPageContext, escapeHtml, type PageContext } from "./html/format";
import { pageStyles } from "./html/styles";

function renderStatusBanner(site: PublicSnapshot["site"], context: PageContext): string {
  const { text, renderDate } = context;
  const icon = site.status === "operational"
    ? '<path d="m5 12 4 4L19 6"/>'
    : '<path d="M12 5v9m0 4h.01"/>';

  return `<section class="banner ${site.status}" id="status" aria-labelledby="status-title">
    <span class="banner-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>
    <div>
      <h1 id="status-title">${text.banner[site.status]}</h1>
      <p>${text.updated}: ${renderDate(site.updated_at)} · ${escapeHtml(site.timezone)}</p>
    </div>
  </section>`;
}

function renderServices(components: PublicSnapshot["components"], context: PageContext): string {
  const { text, renderStatusBadge } = context;
  const legend = (["operational", "degraded", "partial_outage", "major_outage", "unknown"] as const)
    .map(renderStatusBadge).join("");

  return `<section class="section" id="services" aria-labelledby="services-title">
    <h2 id="services-title">${text.services}</h2>
    ${components.map(component => renderComponent(component, context)).join("")}
    <div class="legend muted"><span>${text.legend}</span>${legend}</div>
    <details class="daily-details history-note"><summary>${text.methodology}</summary><p>${text.note}</p></details>
  </section>`;
}

function renderMaintenanceSection(entries: PublicSnapshot["maintenance"], context: PageContext): string {
  const { text } = context;
  const planned = entries.filter(entry => ["scheduled", "in_progress"].includes(entry.status));
  const past = entries.filter(entry => ["completed", "cancelled"].includes(entry.status));
  const plannedCards = planned.length
    ? planned.map(entry => renderMaintenance(entry, context)).join("")
    : `<p class="empty muted">${text.noMaintenance}</p>`;
  const pastCards = past.length
    ? `<details class="past-maintenance"><summary>${text.pastMaintenance}</summary>${past.map(entry => renderMaintenance(entry, context)).join("")}</details>`
    : "";

  return `<section class="section" id="maintenance" aria-labelledby="maintenance-title">
    <h2 id="maintenance-title">${text.planned}</h2>
    ${plannedCards}${pastCards}
  </section>`;
}

export function renderStatusPage(snapshot: PublicSnapshot): string {
  const context = createPageContext(snapshot);
  const { language, text } = context;
  const { site } = snapshot;
  const activeIncidents = snapshot.incidents.filter(entry => entry.status !== "resolved");
  const pastIncidents = snapshot.incidents.filter(entry => entry.status === "resolved");
  const activeSection = activeIncidents.length
    ? `<section class="section" aria-labelledby="active-title"><h2 id="active-title">${text.active}</h2>${activeIncidents.map(entry => renderIncident(entry, context)).join("")}</section>`
    : "";
  const pastIncidentCards = pastIncidents.length
    ? pastIncidents.map(entry => renderIncident(entry, context)).join("")
    : `<p class="empty muted">${text.noIncidents}</p>`;

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(site.name)}</title>
  <style>${pageStyles}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="#status"><span class="brand-mark" aria-hidden="true"></span>${escapeHtml(site.name)}</a>
      <nav aria-label="${text.subtitle}"><a href="#services">${text.services}</a><a href="#maintenance">${text.maintenance}</a><a href="#incidents">${text.incidents}</a></nav>
    </div>
  </header>
  <main class="container">
    ${site.description ? `<p class="site-description">${escapeHtml(site.description)}</p>` : ""}
    ${renderStatusBanner(site, context)}
    ${activeSection}
    ${renderServices(snapshot.components, context)}
    ${renderMaintenanceSection(snapshot.maintenance, context)}
    <section class="section" id="incidents" aria-labelledby="incidents-title">
      <h2 id="incidents-title">${text.history}</h2>
      ${pastIncidentCards}
    </section>
    <footer><span>${text.powered}</span></footer>
  </main>
</body>
</html>`;
}
