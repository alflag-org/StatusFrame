import { assertPublicUrl, type Monitor, type MonitorContext } from "@statusframe/core";
import { boundedText, check } from "./common";
export function httpMonitor(monitor: Extract<Monitor, { type: "http" }>, context: MonitorContext) {
  return check(monitor, context, async signal => {
    let url = assertPublicUrl(monitor.url);
    for (let redirects = 0; redirects <= 5; redirects++) {
      context.budget.take({ subrequests: 1 });
      const response = await context.io.fetch(url.href, { method: monitor.method, redirect: "manual", signal, cache: "no-store" });
      if ([301, 302, 303, 307, 308].includes(response.status) && monitor.follow_redirects) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 5) return false;
        const next = assertPublicUrl(new URL(location, url).href);
        if (url.protocol === "https:" && next.protocol !== "https:") return false;
        url = next;
        continue;
      }
      if (response.status !== monitor.expect.status) { await response.body?.cancel(); return false; }
      if (monitor.expect.body_contains !== undefined) {
        return (await boundedText(response, 1_048_576, signal)).includes(monitor.expect.body_contains);
      }
      await response.body?.cancel();
      return true;
    }
    return false;
  });
}
