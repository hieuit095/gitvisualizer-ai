import type { VercelRequest, VercelResponse } from "@vercel/node";
import analyzeRepo from "./controllers/analyze-repo.js";
import cache from "./controllers/cache.js";
import chatRepo from "./controllers/chat-repo.js";
import embedChunks from "./controllers/embed-chunks.js";
import history from "./controllers/history.js";
import shared from "./controllers/shared.js";
import summarizeNode from "./controllers/summarize-node.js";

type RouteHandler = (req: VercelRequest, res: VercelResponse) => Promise<VercelResponse | void> | VercelResponse | void;

const ROUTES: Record<string, RouteHandler> = {
  "analyze-repo": analyzeRepo,
  cache,
  "chat-repo": chatRepo,
  "embed-chunks": embedChunks,
  history,
  shared,
  "summarize-node": summarizeNode,
};

function getRoutePath(req: VercelRequest): string {
  const path = req.query.path;
  if (Array.isArray(path) && path.length > 0) return path.join("/");
  if (typeof path === "string" && path.trim() !== "") return path;

  if (req.url) {
    const urlPath = req.url.split('?')[0];
    const parts = urlPath.replace(/^\//, "").split('/');
    if (parts[0] === 'api' && parts.length > 1) {
      return parts.slice(1).join('/');
    }
  }

  return "";
}

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["*"];

function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers["origin"] as string | undefined;
  if (ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function setSecurityHeaders(res: VercelResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
}

export default async function routeApiRequest(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  setSecurityHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const routePath = getRoutePath(req);
  const handler = ROUTES[routePath];

  if (!handler) {
    return res.status(404).json({
      error: routePath ? `Unknown API route: /api/${routePath}` : "Missing API route path",
    });
  }

  return await handler(req, res);
}
