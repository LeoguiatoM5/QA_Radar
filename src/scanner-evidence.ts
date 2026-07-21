import type { Page } from "playwright";
import type { Issue, IssueEvidence, IssueInput } from "./types.js";

export function correlateIssues(issues: IssueInput[]): IssueInput[] {
  const correlated = issues.filter((issue) => {
    if (!issue.url) return true;
    const transportIssue = issues.some(
      (candidate) =>
        candidate !== issue &&
        candidate.url === issue.url &&
        (candidate.category === "http" || candidate.category === "network"),
    );
    if (!transportIssue) return true;
    if (issue.category === "console" && /Failed to load resource/i.test(issue.message)) return false;
    if (issue.category === "element" && issue.title === "Imagem quebrada na página") return false;
    return true;
  });

  const grouped: IssueInput[] = [];
  const cookieGroups = new Map<string, IssueInput>();
  for (const issue of correlated) {
    if (issue.title === "Cookie de terceiro bloqueado pelo navegador") {
      const cookieName = /Cookie [“"]([^”"]+)[”"]/i.exec(issue.message)?.[1] ?? "terceiro";
      const existing = cookieGroups.get(cookieName);
      if (existing) {
        existing.occurrences += issue.occurrences;
        if (issue.url && !existing.message.includes(issue.url)) {
          existing.message += `\nTambém observado em: ${issue.url}`;
        }
        continue;
      }
      issue.title = `Cookie “${cookieName}” bloqueado na integração externa`;
      cookieGroups.set(cookieName, issue);
    }
    grouped.push(issue);
  }
  return grouped;
}

export async function annotateEvidence(page: Page, issues: Issue[]): Promise<void> {
  const input = issues.map((issue, index) => ({
    number: index + 1,
    category: issue.category,
    severity: issue.severity,
    title: issue.title ?? issue.message,
    impact: issue.impact,
    message: issue.message,
    status: issue.status,
    url: issue.url,
    selector: issue.evidence?.selector,
  }));

  const evidence = await page.evaluate((items) => {
    document.querySelector("[data-qa-radar-evidence]")?.remove();
    const layer = document.createElement("div");
    layer.dataset.qaRadarEvidence = "true";
    layer.style.cssText = "position:absolute;inset:0;z-index:2147483647;pointer-events:none;font-family:Arial,sans-serif;color:#fff";
    document.documentElement.appendChild(layer);

    const panel = document.createElement("section");
    panel.style.cssText = `position:absolute;top:${window.scrollY + 16}px;right:16px;width:390px;max-width:calc(100vw - 32px);background:#07111ff2;border:2px solid #22d3ee;border-radius:14px;padding:16px;box-shadow:0 16px 48px #000a;text-align:left`;
    const heading = document.createElement("div");
    heading.textContent = "QA RADAR · EVIDÊNCIA VISUAL";
    heading.style.cssText = "color:#67e8f9;font-size:12px;font-weight:900;letter-spacing:1.5px;margin-bottom:8px";
    const target = document.createElement("div");
    target.textContent = `${location.hostname} · ${new Date().toLocaleString("pt-BR")}`;
    target.style.cssText = "color:#a8bad1;font-size:11px;margin-bottom:12px";
    panel.append(heading, target);

    for (const item of items.slice(0, 8)) {
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:28px 1fr;gap:9px;border-top:1px solid #ffffff22;padding:8px 0;align-items:start";
      const number = document.createElement("b");
      number.textContent = String(item.number);
      number.style.cssText = `display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:${item.severity === "error" ? "#dc2626" : "#d97706"};font-size:12px`;
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.title.slice(0, 95);
      title.style.cssText = "display:block;font-size:11px;line-height:1.35";
      const url = document.createElement("span");
      url.textContent = item.impact ?? item.url ?? "Ocorrência global da página";
      url.style.cssText = "display:block;color:#93c5fd;font-size:9px;line-height:1.3;margin-top:3px;word-break:break-all";
      detail.append(title, url);
      row.append(number, detail);
      panel.appendChild(row);
    }
    if (items.length > 8) {
      const more = document.createElement("div");
      more.textContent = `+ ${items.length - 8} ocorrência(s) no relatório completo`;
      more.style.cssText = "color:#a8bad1;font-size:10px;margin-top:7px";
      panel.appendChild(more);
    }
    layer.appendChild(panel);

    const candidates = [...document.querySelectorAll<HTMLElement>(
      "img[src],script[src],link[href],iframe[src],source[src],video[src],audio[src],input[src],object[data]",
    )];
    const located: Array<{ number: number; selector: string; element: string; label: string; boundingBox: { x: number; y: number; width: number; height: number } | undefined }> = [];
    const marked = new Map<Element, HTMLElement>();

    for (const item of items) {
      let element: HTMLElement | undefined;
      if (item.selector) {
        try {
          element = document.querySelector<HTMLElement>(item.selector) ?? undefined;
        } catch {
          element = undefined;
        }
      }
      if (!element && item.url) {
        element = candidates.find((candidate) => {
          const attr = candidate.hasAttribute("src") ? "src" : candidate.hasAttribute("href") ? "href" : "data";
          const raw = candidate.getAttribute(attr);
          if (!raw) return false;
          try {
            const resolved = candidate instanceof HTMLImageElement && candidate.currentSrc
              ? candidate.currentSrc
              : new URL(raw, document.baseURI).toString();
            return resolved === item.url;
          } catch {
            return false;
          }
        });
      }
      if (!element) continue;

      const attr = element.hasAttribute("src") ? "src" : element.hasAttribute("href") ? "href" : "data";
      const raw = element.getAttribute(attr) ?? "";
      const selector = element.id
        ? `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`
        : `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(raw)}"]`;
      const description =
        element.getAttribute("alt") ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.tagName.toLowerCase();
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      const box = visible
        ? { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height }
        : undefined;
      const label = `#${item.number} ${item.title.toUpperCase().slice(0, 34)}`;
      const markerLabel = `#${item.number}`;
      located.push({ number: item.number, selector, element: `${element.tagName.toLowerCase()} · ${description}`, label, boundingBox: box });

      if (visible) {
        const existingBadge = marked.get(element);
        if (existingBadge) {
          existingBadge.textContent = `${existingBadge.textContent} ${markerLabel}`;
          continue;
        }
        const marker = document.createElement("div");
        marker.style.cssText = `position:absolute;left:${box?.x ?? 0}px;top:${box?.y ?? 0}px;width:${Math.max(box?.width ?? 0, 28)}px;height:${Math.max(box?.height ?? 0, 28)}px;border:4px solid #ef4444;background:#ef444425;box-shadow:0 0 0 3px #fff,0 8px 25px #0009;border-radius:4px`;
        const badge = document.createElement("b");
        badge.textContent = markerLabel;
        badge.title = item.title;
        badge.style.cssText = "position:absolute;left:-13px;top:-13px;display:grid;place-items:center;min-width:28px;height:28px;white-space:nowrap;background:#dc2626;color:white;border:2px solid white;border-radius:999px;padding:0 5px;font-size:10px;line-height:1;font-weight:900;box-shadow:0 4px 12px #0009";
        marker.appendChild(badge);
        layer.appendChild(marker);
        marked.set(element, badge);
      }
    }
    return located;
  }, input);

  for (const item of evidence) {
    const issue = issues[item.number - 1];
    if (!issue) continue;
    const value: IssueEvidence = {
      selector: item.selector,
      element: item.element,
      label: item.label,
      boundingBox: item.boundingBox,
    };
    issue.evidence = value;
  }
}
