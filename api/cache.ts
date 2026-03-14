import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCacheById } from "./lib/store";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id is required" });

    const row = getCacheById(id);
    if (!row) return res.status(404).json({ error: "Not found" });

    res.json({ id: row.id, result: row.result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
