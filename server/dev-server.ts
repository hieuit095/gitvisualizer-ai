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

function adaptResponse(rawRes: ServerResponse) {
  let pendingStatus = 200;

  const rawWrite = rawRes.write.bind(rawRes);
  const rawEnd = rawRes.end.bind(rawRes);
  const rawSetHeader = rawRes.setHeader.bind(rawRes);
  const rawWriteHead = rawRes.writeHead.bind(rawRes);

  function ensureHead() {
    if (!rawRes.headersSent) {
      rawWriteHead(pendingStatus);
    }
  }

  const proxy: any = {
    status(code: number) {
      pendingStatus = code;
      return proxy;
    },
    setHeader(name: string, value: string | string[]) {
      if (!rawRes.headersSent) {
        rawSetHeader(name, value);
      }
      return proxy;
    },
    json(data: unknown) {
      if (!rawRes.headersSent) {
        rawSetHeader("Content-Type", "application/json");
        rawWriteHead(pendingStatus);
      }
      rawEnd(JSON.stringify(data));
      return proxy;
    },
    write(chunk: string | Buffer) {
      ensureHead();
      rawWrite(chunk);
      return true;
    },
    end(data?: string | Buffer) {
      ensureHead();
      if (data != null) {
        rawEnd(data);
      } else {
        rawEnd();
      }
      return proxy;
    },
    get headersSent() {
      return rawRes.headersSent;
    },
  };

  return proxy;
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
    const message = err instanceof Error ? err.message : String(err) || "Internal server error";
    console.error("[dev-server] Unhandled error:", message, err);
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(500);
      res.end(JSON.stringify({ error: message }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`API dev server listening on http://localhost:${PORT}`);
});
