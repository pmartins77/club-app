import { neon } from "@neondatabase/serverless";

export default async function handler(_req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`select id, name from teams order by name`;
    res.status(200).json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
