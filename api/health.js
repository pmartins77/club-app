import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`select now() as now`;
    res.status(200).json({ ok: true, now: rows?.[0]?.now ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
