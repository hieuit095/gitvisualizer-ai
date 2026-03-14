import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { parse as parseUrl } from "node:url";
import { parse as parseQs } from "node:querystring";
import routeApiRequest from "./router.js";

const PORT = parseInt(process.env.API_PORT ?? "3001", 10);

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function buildVercelRequest(req: IncomingMessage, body: string, parsedUrl: ReturnType<typeof parseUrl>) {
  const rawQuery = parsedUrl.query ?? "";
  const query = typeof rawQuery === "string" ? parseQs(rawQuery) : rawQuery;

  const pathParts = (parsedUrl.pathname ?? "")
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);

  const bodyParsed = (() => {
    if (!body) return {};
    try { return JSON.parse(body); } catch { return {}; }
  })();

  return Object.assign(req, {
    body: bodyParsed,
    query: { ...query, path: pathParts },
    cookies: {},
  }) as any;
}

function buildVercelResponse(res: ServerResponse) {
  const chunks: Buffer[] = [];
  let statusCode = 200;
  const headers: Record<string, string | string[]> = {};

  const vres = Object.assign(res, {
    status(code: number) { statusCode = code; res.statusCode = code; return vres; },
    setHeader(name: string, value: string | string[]) { headers[name.toLowerCase()] = value; res.setHeader(name, value); return vres; },
    json(data: unknown) {
      if (!res.headersSent) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(statusCode);
      }
      res.end(JSON.stringify(data));
      return vres;
    },
    write(chunk: string) { chunks.push(Buffer.from(chunk)); return true; },
    end(data?: string) {
      if (!res.headersSent) res.writeHead(statusCode);
      for (const chunk of chunks) res.write(chunk);
      if (data) res.write(data);
      res.end();
      return vres;
    },
  }) as any;

  return vres;
}

const server = createServer(async (req, res) => {
  const parsedUrl = parseUrl(req.url ?? "");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.writeHead(200);
    res.end();
    return;
  }

  const body = await readBody(req);
  const vreq = buildVercelRequest(req, body, parsedUrl);
  const vres = buildVercelResponse(res);

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
