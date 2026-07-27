import { createDocsPage, createHomePage, createJourneyPage, createWebPage } from "../web-page.js";
import { json } from "../http-helpers.js";
import type { RouteHandler } from "./context.js";

export const tryHandlePages: RouteHandler = async (context, request, response, url) => {
  const { config } = context;

  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, { status: "ok", ...context.queueStats() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
    });
    response.end(createHomePage());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/docs") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
    });
    response.end(createDocsPage());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/journeys") {
    const turnstileSources = config.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSources}; frame-src 'self'${turnstileSources}; img-src 'self' data: blob:; connect-src 'self'${turnstileSources}`,
    });
    response.end(createJourneyPage(config.allowCodeMode));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/scanner") {
    const turnstileSources = config.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSources}; frame-src 'self'${turnstileSources}; img-src 'self' data: blob:; connect-src 'self'${turnstileSources}`,
    });
    response.end(createWebPage(config.turnstileSiteKey, config.allowHistory, config.maxSitemapPages));
    return true;
  }

  return false;
};
