import type { Page } from "playwright";
import type { PerformanceMetrics } from "./types.js";

export async function installPerformanceObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type VitalsState = {
      lcp: number | undefined;
      cls: number;
      clsWindow: number;
      clsWindowStart: number;
      clsWindowLast: number;
    };
    const state: VitalsState = { lcp: undefined, cls: 0, clsWindow: 0, clsWindowStart: 0, clsWindowLast: 0 };
    (globalThis as typeof globalThis & { __qaRadarVitals?: VitalsState }).__qaRadarVitals = state;
    try {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) state.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Métrica indisponível neste navegador.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (shift.hadRecentInput) continue;
          const continuesWindow = state.clsWindowLast > 0 &&
            shift.startTime - state.clsWindowLast < 1_000 &&
            shift.startTime - state.clsWindowStart < 5_000;
          if (continuesWindow) state.clsWindow += shift.value;
          else {
            state.clsWindow = shift.value;
            state.clsWindowStart = shift.startTime;
          }
          state.clsWindowLast = shift.startTime;
          state.cls = Math.max(state.cls, state.clsWindow);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Métrica indisponível neste navegador.
    }
  });
}

function rounded(value: number | undefined, digits = 0): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function collectPerformanceMetrics(page: Page): Promise<PerformanceMetrics | undefined> {
  try {
    const raw = await page.evaluate(() => {
      type VitalsState = { lcp?: number; cls?: number };
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!navigation) return undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const vitals = (globalThis as typeof globalThis & { __qaRadarVitals?: VitalsState }).__qaRadarVitals;
      return {
        ttfbMs: navigation.responseStart - navigation.startTime,
        fcpMs: fcp?.startTime,
        lcpMs: vitals?.lcp,
        cls: vitals?.cls,
        domContentLoadedMs: navigation.domContentLoadedEventEnd - navigation.startTime,
        loadMs: navigation.loadEventEnd > 0 ? navigation.loadEventEnd - navigation.startTime : undefined,
      };
    });
    if (!raw) return undefined;
    return {
      ttfbMs: rounded(raw.ttfbMs),
      fcpMs: rounded(raw.fcpMs),
      lcpMs: rounded(raw.lcpMs),
      cls: rounded(raw.cls, 3),
      domContentLoadedMs: rounded(raw.domContentLoadedMs),
      loadMs: rounded(raw.loadMs),
    };
  } catch {
    return undefined;
  }
}
