import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parse as parseUrl } from "node:url";
import { parse as parseQs } from "node:querystring";
import routeApiRequest from "./router.js";

const PORT = parseInt(process.env.API_PORT ?? "3001", 10);

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function adaptRequest(req: IncomingMessage, body: string, parsedUrl: ReturnType<typeof parseUrl>) {
  const rawQuery = parsedUrl.query ?? "";
  const qs = typeof rawQuery === "string" ? parseQs(rawQuery) : rawQuery;

  const pathParts = (parsedUrl.pathname ?? "")
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);

  const bodyParsed = (() => {
    if (!body) return {};
    try { return JSON.parse(body); } catch { return {}; }
  })();

  (req as any).body = bodyParsed;
  (req as any).query = { ...qs, path: pathParts };
  (req as any).cookies = {};

  return req as any;
}

function adaptResponse(res: ServerResponse) {
  let statusCode = 200;
  let headersSent = false;

  const ensureHeaders = () => {
    if (!headersSent) {
      headersSent = true;
      res.writeHead(statusCode);
    }
  };

  const vres: any = res;

  vres.status = (code: number) => {
    statusCode = code;
    return vres;
  };

  const originalSetHeader = res.setHeader.bind(res);
  vres.setHeader = (name: string, value: string | string[]) => {
    originalSetHeader(name, value);
    return vres;
  };

  vres.json = (data: unknown) => {
    if (!res.headersSent && !headersSent) {
      headersSent = true;
      res.setHeader("Content-Type", "application/json");
      res.writeHead(statusCode);
    }
    res.end(JSON.stringify(data));
    return vres;
  };

  const originalWrite = res.write.bind(res);
  vres.write = (chunk: string | Buffer) => {
    ensureHeaders();
    originalWrite(chunk);
    return true;
  };

  const originalEnd = res.end.bind(res);
  vres.end = (data?: string) => {
    ensureHeaders();
    if (data) {
      originalEnd(data);
    } else {
      originalEnd();
    }
    return vres;
  };

  try {
    Object.defineProperty(vres, "headersSent", {
      configurable: true,
      get: () => res.headersSent || headersSent,
    });
  } catch {
    // headersSent may already be defined non-configurably; fallback is fine
  }

  return vres;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = parseUrl(req.url ?? "");
  const body = await readBody(req);
  const vreq = adaptRequest(req, body, parsedUrl);
  const vres = adaptResponse(res);

  try {
    await routeApiRequest(vreq, vres);
  } catch (err) {
    console.error("dev-server error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`API dev server listening on http://localhost:${PORT}`);
});
