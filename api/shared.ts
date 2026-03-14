import type { VercelRequest, VercelResponse } from "@vercel/node";
import { queryOne } from "./lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id is required" });

    const row = await queryOne(
      `SELECT repo_url, result, expires_at FROM analysis_cache WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: "Analysis not found" });
    if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error: "Analysis expired" });

    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
