// Embedded in the page so rendering needs no asset requests or CSS loader.
export const pageStyles = `
:root {
  color-scheme:light dark;
  --bg:#f7f9fb;
  --surface:#fff;
  --ink:#142332;
  --muted:#657585;
  --border:#e1e8ed;
  --green:#129c66;
  --amber:#a7650b;
  --red:#c53444;
  --blue:#286fbb;
  --unknown:#8a96a1;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}

* {
  box-sizing:border-box;
}

html {
  scroll-behavior:smooth;
  scroll-padding-top:24px;
}

body {
  margin:0;
  background:var(--bg);
  color:var(--ink);
  line-height:1.65;
}

a {
  color:inherit;
}

a:focus-visible,summary:focus-visible {
  outline:3px solid var(--blue);
  outline-offset:4px;
}

.topbar {
  background:var(--surface);
  border-bottom:1px solid var(--border);
}

.topbar-inner {
  max-width:1040px;
  margin:auto;
  padding:22px 28px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:24px;
}

.brand {
  display:flex;
  align-items:center;
  gap:12px;
  text-decoration:none;
  font-size:23px;
  font-weight:750;
  letter-spacing:-.6px;
}

.brand-mark {
  position:relative;
  width:30px;
  height:30px;
  flex-shrink:0;
}

.brand-mark:before,.brand-mark:after {
  content:"";
  position:absolute;
  width:22px;
  height:22px;
  border-radius:5px;
}

.brand-mark:before {
  background:#24c881;
  left:0;
  top:0;
}

.brand-mark:after {
  background:#168779;
  right:0;
  bottom:0;
  opacity:.85;
}

nav {
  display:flex;
  gap:24px;
  font-size:13px;
}

nav a {
  text-decoration:none;
}

nav a:hover {
  color:var(--green);
}

.container {
  max-width:1040px;
  margin:auto;
  padding:32px 28px 0;
}

h1,h2,h3,p {
  margin:0;
}

h1 {
  font-size:clamp(22px,3vw,31px);
  line-height:1.45;
  letter-spacing:-.6px;
}

h2 {
  font-size:24px;
  line-height:1.45;
  margin-bottom:20px;
  letter-spacing:-.5px;
}

h3 {
  font-size:19px;
  line-height:1.45;
  overflow-wrap:anywhere;
}

.banner {
  display:flex;
  align-items:center;
  gap:24px;
  padding:32px;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--surface);
}

.banner.operational {
  background:#eaf8f1;
  border-color:#d4eee1;
  color:#096944;
}

.banner.degraded,.banner.partial_outage {
  background:#fff6e6;
  border-color:#f1dfbd;
  color:#80520b;
}

.banner.major_outage {
  background:#fff0f2;
  border-color:#f4d5dc;
  color:#a82235;
}

.banner.unknown {
  background:#edf2f6;
  color:#526270;
}

.banner-icon {
  display:grid;
  place-items:center;
  width:64px;
  height:64px;
  flex-shrink:0;
  border-radius:50%;
  background:currentColor;
}

.banner-icon svg {
  width:32px;
  height:32px;
  color:white;
}

.banner p {
  margin-top:8px;
  font-size:13px;
}

.site-description {
  margin-bottom:16px;
  color:var(--muted);
  white-space:pre-wrap;
}

.section {
  margin-top:36px;
}

.card {
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:10px;
  padding:24px;
  margin-bottom:16px;
}

.component-heading {
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:20px;
}

.description {
  margin-top:6px;
  font-size:14px;
  white-space:pre-wrap;
}

.muted {
  color:var(--muted);
}

.status {
  display:inline-flex;
  align-items:center;
  gap:8px;
  white-space:nowrap;
  font-size:14px;
  font-weight:600;
}

.operational {
  color:var(--green);
}

.degraded,.partial_outage {
  color:var(--amber);
}

.major_outage {
  color:var(--red);
}

.unknown {
  color:var(--unknown);
}

.dot {
  width:10px;
  height:10px;
  border-radius:50%;
  background:currentColor;
}

.history-bars {
  display:flex;
  gap:3px;
  height:29px;
  margin-top:22px;
}

.history-day {
  flex:1;
  min-width:0;
  border-radius:2px;
  background:currentColor;
}

.history-day.operational {
  color:#21bf7a;
}

.history-day.degraded {
  color:#e5b83f;
}

.history-day.partial_outage {
  color:#ed9837;
}

.history-day.major_outage {
  color:#df5462;
}

.history-day.unknown {
  color:#d5dde3;
}

.history-scale {
  display:flex;
  justify-content:space-between;
  gap:8px;
  font-size:12px;
  margin-top:8px;
}

.history-scale strong {
  font-weight:500;
}

.legend {
  display:flex;
  flex-wrap:wrap;
  gap:14px;
  align-items:center;
  font-size:12px;
  margin:14px 0;
}

.legend .status {
  font-size:12px;
  font-weight:400;
}

.daily-details {
  font-size:12px;
  color:var(--muted);
  margin-top:12px;
}

.daily-details summary {
  cursor:pointer;
  width:fit-content;
}

.table-scroll {
  max-height:260px;
  overflow:auto;
  margin-top:10px;
}

table {
  width:100%;
  border-collapse:collapse;
  text-align:left;
}

caption {
  text-align:left;
  padding:8px 0;
}

th,td {
  border-bottom:1px solid var(--border);
  padding:6px;
  font-weight:400;
}

.event-heading {
  display:flex;
  align-items:center;
  gap:14px;
  flex-wrap:wrap;
}

.pill {
  font-size:12px;
  font-weight:650;
  border-radius:7px;
  padding:3px 9px;
  background:#fff0db;
}

.pill.resolved {
  color:#10704b;
  background:#e8f7ef;
}

.pill.maintenance {
  color:#2368ad;
  background:#e9f3ff;
}

.pill.major_outage {
  background:#fff0f2;
}

.event-date {
  font-size:13px;
  margin-top:12px;
}

.affected {
  font-size:13px;
  margin-top:4px;
}

.event>p:last-child:not(.affected) {
  margin-top:12px;
  white-space:pre-wrap;
}

.timeline {
  list-style:none;
  margin:20px 0 0 5px;
  padding:0 0 0 21px;
  border-left:2px solid var(--border);
}

.timeline li {
  position:relative;
  margin-top:18px;
}

.timeline li:before {
  content:"";
  position:absolute;
  left:-27px;
  top:8px;
  width:10px;
  height:10px;
  border:2px solid var(--green);
  border-radius:50%;
  background:var(--surface);
}

.timeline li>div {
  display:flex;
  gap:12px;
  flex-wrap:wrap;
  font-size:13px;
}

.timeline p {
  font-size:14px;
  white-space:pre-wrap;
  margin-top:4px;
}

.empty {
  padding:20px 24px;
  background:var(--surface);
  border:1px dashed var(--border);
  border-radius:10px;
  font-size:14px;
}

.past-maintenance {
  margin-top:20px;
}

.past-maintenance>summary {
  cursor:pointer;
  font-weight:600;
  margin-bottom:16px;
}

footer {
  display:flex;
  justify-content:flex-end;
  align-items:center;
  gap:12px;
  padding:26px 0;
  margin-top:40px;
  border-top:1px solid var(--border);
  font-size:12px;
  color:var(--muted);
}

@media(max-width:640px) {
  .topbar-inner {
    padding:18px;
    flex-wrap:wrap;
    gap:12px;
  }
  .brand {
    font-size:20px;
  }
  nav {
    gap:18px;
    font-size:12px;
  }
  .container {
    padding:22px 16px 0;
  }
  .banner {
    padding:22px 18px;
    gap:14px;
  }
  .banner-icon {
    width:42px;
    height:42px;
  }
  .banner-icon svg {
    width:24px;
    height:24px;
  }
  h2 {
    font-size:21px;
  }
  .card {
    padding:18px;
  }
  .component-heading {
    gap:12px;
    flex-wrap:wrap;
  }
  .history-bars {
    gap:2px;
    height:25px;
  }
  .history-scale {
    font-size:11px;
  }
  .status {
    font-size:12px;
  }
  footer {
    flex-wrap:wrap;
  }
  .section {
    margin-top:28px;
  }
}

@media(prefers-color-scheme:dark) {
  :root {
    --bg:#101a23;
    --surface:#17232e;
    --ink:#e5eef4;
    --muted:#a1b1bf;
    --border:#2c3b48;
    --green:#54d69d;
    --amber:#edba62;
    --red:#f47e8d;
    --blue:#7bb5ed;
    --unknown:#a9b6c1;
  }
  .banner.operational {
    background:#123c2d;
    border-color:#235641;
    color:#9ee7c0;
  }
  .banner.degraded,.banner.partial_outage {
    background:#403119;
    border-color:#5e4824;
    color:#f3d298;
  }
  .banner.major_outage {
    background:#42212a;
    border-color:#623240;
    color:#ffb4bf;
  }
  .banner.unknown {
    background:#263440;
    color:#c0ced8;
  }
  .history-day.unknown {
    color:#445461;
  }
  .pill {
    background:#403119;
  }
  .pill.resolved {
    color:#9ee7c0;
    background:#123c2d;
  }
  .pill.maintenance {
    color:#b1d7fc;
    background:#193650;
  }
  .pill.major_outage {
    background:#42212a;
  }
}

@media(prefers-reduced-motion:reduce) {
  html {
    scroll-behavior:auto;
  }
}
`;
