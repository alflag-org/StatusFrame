import type { PublicComponent, PublicSnapshot } from "./types";

const STATUS_TONES: Record<string, string> = {
  operational: "good",
  online: "good",
  degraded: "warn",
  unstable: "warn",
  maintenance: "warn",
  unknown: "muted",
  offline: "bad",
  major_outage: "bad"
};

export function renderStatusPage(snapshot: PublicSnapshot): string {
  const grouped = groupComponents(snapshot.components);
  const overallTone = toneFor(snapshot.site.status);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(snapshot.site.name)}</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f7f4ed;
      --ink: #171714;
      --muted: #69665d;
      --line: #d9d2c1;
      --good: #166a3b;
      --warn: #8a5b00;
      --bad: #9f2424;
      --panel: #fffdf8;
      --shadow: rgba(30, 28, 22, .08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      line-height: 1.5;
    }
    main {
      width: min(960px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 42px 0 56px;
    }
    header {
      border-bottom: 1px solid var(--line);
      padding-bottom: 28px;
      margin-bottom: 28px;
    }
    .kicker {
      color: var(--muted);
      font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    h1 {
      font-size: clamp(34px, 6vw, 72px);
      line-height: .95;
      letter-spacing: 0;
      margin: 10px 0 14px;
      max-width: 12ch;
    }
    .description {
      max-width: 64ch;
      color: var(--muted);
      margin: 0;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .overall {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 14px;
      align-items: start;
      margin: 28px 0;
      padding: 22px;
      background: var(--panel);
      border: 1px solid var(--line);
      box-shadow: 0 18px 45px var(--shadow);
    }
    .signal {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      margin-top: 7px;
      background: var(--muted);
    }
    .signal.good { background: var(--good); }
    .signal.warn { background: var(--warn); }
    .signal.bad { background: var(--bad); }
    .status-line {
      margin: 0;
      font-size: clamp(22px, 4vw, 36px);
      line-height: 1.1;
    }
    .section {
      margin-top: 34px;
    }
    .section h2 {
      margin: 0 0 14px;
      font: 700 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
      text-transform: uppercase;
      color: var(--muted);
    }
    .component-list {
      border-top: 1px solid var(--line);
    }
    .component {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      min-height: 68px;
      align-items: center;
      border-bottom: 1px solid var(--line);
      padding: 14px 0;
    }
    .component-name {
      font: 700 18px/1.2 ui-sans-serif, system-ui, sans-serif;
    }
    .component-desc {
      margin-top: 4px;
      color: var(--muted);
      font: 14px/1.35 ui-sans-serif, system-ui, sans-serif;
    }
    .badge {
      min-width: 116px;
      text-align: center;
      border: 1px solid currentColor;
      padding: 7px 10px;
      font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      text-transform: uppercase;
    }
    .badge.good { color: var(--good); }
    .badge.warn { color: var(--warn); }
    .badge.bad { color: var(--bad); }
    .badge.muted { color: var(--muted); }
    .notice-list {
      display: grid;
      gap: 12px;
    }
    .notice {
      border-left: 4px solid var(--line);
      padding: 2px 0 2px 14px;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .notice strong { display: block; }
    .notice span { color: var(--muted); }
    footer {
      margin-top: 42px;
      color: var(--muted);
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    @media (max-width: 620px) {
      main { width: min(100vw - 24px, 960px); padding-top: 28px; }
      .component { grid-template-columns: 1fr; gap: 10px; }
      .badge { justify-self: start; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="kicker">Public service status</div>
      <h1>${escapeHtml(snapshot.site.name)}</h1>
      ${snapshot.site.description ? `<p class="description">${escapeHtml(snapshot.site.description)}</p>` : ""}
    </header>
    <section class="overall" aria-label="Overall status">
      <div class="signal ${overallTone}"></div>
      <p class="status-line">${escapeHtml(labelForStatus(snapshot.site.status))}</p>
    </section>
    ${Array.from(grouped.entries())
      .map(([group, components]) => renderComponentGroup(group, components))
      .join("")}
    ${renderIncidents(snapshot)}
    ${renderMaintenance(snapshot)}
    <footer>Last updated: ${escapeHtml(formatTimestamp(snapshot.site.updated_at, snapshot.site.timezone))}</footer>
  </main>
</body>
</html>`;
}

function renderComponentGroup(group: string, components: PublicComponent[]): string {
  return `<section class="section">
    <h2>${escapeHtml(group)}</h2>
    <div class="component-list">
      ${components.map(renderComponent).join("")}
    </div>
  </section>`;
}

function renderComponent(component: PublicComponent): string {
  const tone = toneFor(component.status);
  const metrics = component.metrics
    ? `<div class="component-desc">${[
        component.metrics.uptime?.label,
        component.metrics.latency ? `Response time: ${component.metrics.latency.state}` : undefined
      ]
        .filter(Boolean)
        .map((value) => escapeHtml(String(value)))
        .join(" · ")}</div>`
    : "";
  return `<div class="component">
    <div>
      <div class="component-name">${escapeHtml(component.name)}</div>
      ${component.description ? `<div class="component-desc">${escapeHtml(component.description)}</div>` : ""}
      ${metrics}
    </div>
    <div class="badge ${tone}">${escapeHtml(labelForStatus(component.status))}</div>
  </div>`;
}

function renderIncidents(snapshot: PublicSnapshot): string {
  if (snapshot.active_incidents.length === 0) return "";
  return `<section class="section">
    <h2>Active incidents</h2>
    <div class="notice-list">
      ${snapshot.active_incidents
        .map(
          (incident) => `<div class="notice">
            <strong>${escapeHtml(incident.title)}</strong>
            <span>${escapeHtml(incident.status)} · ${escapeHtml(incident.impact)}</span>
          </div>`
        )
        .join("")}
    </div>
  </section>`;
}

function renderMaintenance(snapshot: PublicSnapshot): string {
  if (snapshot.scheduled_maintenance.length === 0) return "";
  return `<section class="section">
    <h2>Scheduled maintenance</h2>
    <div class="notice-list">
      ${snapshot.scheduled_maintenance
        .map(
          (maintenance) => `<div class="notice">
            <strong>${escapeHtml(maintenance.title)}</strong>
            <span>${escapeHtml(maintenance.starts_at)} - ${escapeHtml(maintenance.ends_at)}</span>
          </div>`
        )
        .join("")}
    </div>
  </section>`;
}

function groupComponents(components: PublicComponent[]): Map<string, PublicComponent[]> {
  const grouped = new Map<string, PublicComponent[]>();
  for (const component of components) {
    const key = component.group ?? "Components";
    grouped.set(key, [...(grouped.get(key) ?? []), component]);
  }
  return grouped;
}

function labelForStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toneFor(status: string): string {
  return STATUS_TONES[status] ?? "muted";
}

function formatTimestamp(value: string, timezone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone ?? "UTC"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
