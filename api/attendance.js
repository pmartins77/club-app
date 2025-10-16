import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === "GET") {
    try {
      const session_id = req.query?.session_id;
      if (!session_id) return res.status(400).json({ ok:false, error:"session_id requis" });

      const rows = await sql`
        select a.member_id, a.present
        from attendance a
        where a.session_id = ${session_id}
      `;
      return res.status(200).json({ ok:true, data: rows });
    } catch (e) {
      return res.status(500).json({ ok:false, error: e.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { session_id, member_id, present } = req.body || {};
      if (!session_id || !member_id || typeof present !== "boolean") {
        return res.status(400).json({ ok:false, error:"session_id, member_id, present requis" });
      }
      await sql`
        insert into attendance (session_id, member_id, present)
        values (${session_id}, ${member_id}, ${present})
        on conflict (session_id, member_id)
        do update set present = ${present}
      `;
      return res.status(200).json({ ok:true });
    } catch (e) {
      return res.status(500).json({ ok:false, error: e.message });
    }
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).end();
}
