function getRoutePath(req: VercelRequest): string {

const CORS_ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers["origin"] as string | undefined;