import type { VercelRequest, VercelResponse } from "@vercel/node";
import { query, queryOne } from "./lib/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const repoUrl = req.query.repo as string;
    if (!repoUrl) return res.status(400).json({ error: "repo query param is required" });

    const rows = await query(
      `SELECT id, cache_id, version, node_count, edge_count, created_at FROM analysis_history WHERE repo_url = $1 ORDER BY created_at DESC LIMIT 20`,
      [repoUrl]
    );
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
