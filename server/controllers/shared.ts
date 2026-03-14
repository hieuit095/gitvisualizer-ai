import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCacheById } from "../lib/store.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id is required" });

    const row = getCacheById(id);
    if (!row) return res.status(404).json({ error: "Analysis not found or expired" });

    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ error: "Analysis expired" });
    }

    res.json({ repo_url: row.repo_url, result: row.result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
