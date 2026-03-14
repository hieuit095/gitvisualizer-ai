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

export default async function routeApiRequest(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

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
