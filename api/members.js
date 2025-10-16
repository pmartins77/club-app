import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const team_id = req.query?.team_id || null;

    const rows = team_id
      ? await sql`
        select m.id, m.first_name, m.last_name, m.email,
               m.member_number, m.gender, m.created_at, t.name as team_name
        from members m
        left join teams t on t.id = m.team_id
        where m.deleted = false and m.team_id = ${team_id}
        order by m.last_name, m.first_name
      `
      : await sql`
        select m.id, m.first_name, m.last_name, m.email,
               m.member_number, m.gender, m.created_at, t.name as team_name
        from members m
        left join teams t on t.id = m.team_id
        where m.deleted = false
        order by m.last_name, m.first_name
      `;
    res.status(200).json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
