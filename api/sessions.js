import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === "GET") {
    try {
      const team_id = req.query?.team_id || null;
      const rows = team_id
        ? await sql`select id, team_id, title, starts_at from sessions where team_id=${team_id} order by starts_at desc`
        : await sql`select id, team_id, title, starts_at from sessions order by starts_at desc`;
      return res.status(200).json({ ok: true, data: rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { title, starts_at, team_id } = req.body || {};
      if (!title || !starts_at) return res.status(400).json({ ok:false, error:"title et starts_at requis" });

      const rows = await sql`
        insert into sessions (title, starts_at, team_id)
        values (${title}, ${starts_at}, ${team_id ?? null})
        returning id, team_id, title, starts_at
      `;
      return res.status(200).json({ ok: true, data: rows[0] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).end();
}
