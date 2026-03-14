import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getHistory } from "../lib/store.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const repoUrl = req.query.repo as string;
    if (!repoUrl) return res.status(400).json({ error: "repo query param is required" });
    res.json(getHistory(repoUrl));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
