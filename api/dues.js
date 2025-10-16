import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const team_id = req.query?.team_id || null;

    const rows = team_id
      ? await sql`
        select member_id, first_name, last_name, email, member_number, team_name, paid_this_season
        from v_members_dues
        where team_name in (select name from teams where id = ${team_id})
        order by last_name, first_name
      `
      : await sql`
        select member_id, first_name, last_name, email, member_number, team_name, paid_this_season
        from v_members_dues
        order by last_name, first_name
      `;

    res.status(200).json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
