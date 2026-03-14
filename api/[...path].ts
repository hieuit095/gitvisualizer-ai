import type { VercelRequest, VercelResponse } from "@vercel/node";
import routeApiRequest from "../server/router.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return await routeApiRequest(req, res);
}
