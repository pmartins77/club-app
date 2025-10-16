// api/[...all].js
// Catch-all unique pour toutes les routes /api/* (sans Express)
// Compatible Vercel Hobby (1 seule Serverless Function)

import { neon } from "@neondatabase/serverless";

// Helpers
function json(res, code, obj) {
  res.statusCode = code || 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
function getSQL() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

// Router
export default async function handler(req, res) {
  try {
    const { method, url } = req;
    const { pathname, searchParams } = new URL(url, "https://dummy.local");

    // --- Routes sans DB ---
    if (pathname === "/api/hello" && method === "GET") {
      return json(res, 200, { message: "Bienvenue sur club-app 👋" });
    }
    if (pathname === "/api/health" && method === "GET") {
      return json(res, 200, { ok: true, status: "healthy", ts: new Date().toISOString() });
    }
    if (pathname === "/api/env-check" && method === "GET") {
      return json(res, 200, { hasDatabaseUrl: Boolean(process.env.DATABASE_URL) });
    }

    // --- DB requise à partir d'ici
    const sql = getSQL();

    // DB health
    if (pathname === "/api/db/health" && method === "GET") {
      const rows = await sql`select now() as now`;
      return json(res, 200, { ok: true, now: rows?.[0]?.now ?? null });
    }

    // Teams (laisse tel quel même si le front ne l'utilise plus)
    if (pathname === "/api/teams" && method === "GET") {
      const rows = await sql`select id, name from teams order by name`;
      return json(res, 200, { ok: true, data: rows });
    }

    // Members (optionnel ?team_id=)
    if (pathname === "/api/members" && method === "GET") {
      const team_id = searchParams.get("team_id");
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
      return json(res, 200, { ok: true, data: rows });
    }

    // Dues (cotisations) (optionnel ?team_id=)
    if (pathname === "/api/dues" && method === "GET") {
      const team_id = searchParams.get("team_id");
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
      return json(res, 200, { ok: true, data: rows });
    }

    // Sessions GET/POST
    // GET supporte maintenant ?team_id= OU ?team_name=, et/ou ?date=YYYY-MM-DD (Europe/Paris)
    if (pathname === "/api/sessions") {
      if (method === "GET") {
        const team_id = searchParams.get("team_id");
        const team_name = searchParams.get("team_name"); // NEW
        const dateStr = searchParams.get("date");        // yyyy-mm-dd, Europe/Paris

        let rows;
        if (dateStr) {
          // Filtre exact sur la DATE locale Europe/Paris
          if (team_id) {
            rows = await sql`
              select id, team_id, title, starts_at
              from sessions
              where team_id = ${team_id}
                and (date(starts_at at time zone 'Europe/Paris')) = ${dateStr}
              order by starts_at asc
            `;
          } else if (team_name) {
            rows = await sql`
              select id, team_id, title, starts_at
              from sessions
              where team_id in (select id from teams where name = ${team_name})
                and (date(starts_at at time zone 'Europe/Paris')) = ${dateStr}
              order by starts_at asc
            `;
          } else {
            rows = await sql`
              select id, team_id, title, starts_at
              from sessions
              where (date(starts_at at time zone 'Europe/Paris')) = ${dateStr}
              order by starts_at asc
            `;
          }
        } else {
          // Sans date : renvoie tout (optionnellement filtré par équipe)
          if (team_id) {
            rows = await sql`
              select id, team_id, title, starts_at
              from sessions
              where team_id = ${team_id}
              order by starts_at desc
            `;
          } else if (team_name) {
            rows = await sql`
              select id, team_id, title, starts_at
              from sessions
              where team_id in (select id from teams where name = ${team_name})
              order by starts_at desc
            `;
          } else {
            rows = await sql`select id, team_id, title, starts_at from sessions order by starts_at desc`;
          }
        }

        return json(res, 200, { ok: true, data: rows });
      }

      if (method === "POST") {
        // (tu n'utilises plus la création côté UI; on laisse pour usage futur)
        const body = await readBody(req);
        const { title, starts_at, team_id } = body || {};
        if (!title || !starts_at) return json(res, 400, { ok: false, error: "title et starts_at requis" });
        const rows = await sql`
          insert into sessions (title, starts_at, team_id)
          values (${title}, ${starts_at}, ${team_id ?? null})
          returning id, team_id, title, starts_at
        `;
        return json(res, 200, { ok: true, data: rows[0] });
      }
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, error: "Method Not Allowed" });
    }

    // Attendance GET/POST
    if (pathname === "/api/attendance") {
      if (method === "GET") {
        const session_id = searchParams.get("session_id");
        if (!session_id) return json(res, 400, { ok: false, error: "session_id requis" });
        const rows = await sql`
          select a.member_id, a.present
          from attendance a
          where a.session_id = ${session_id}
        `;
        return json(res, 200, { ok: true, data: rows });
      }
      if (method === "POST") {
        const body = await readBody(req);
        const { session_id, member_id, present } = body || {};
        if (!session_id || !member_id || typeof present !== "boolean") {
          return json(res, 400, { ok: false, error: "session_id, member_id, present requis" });
        }
        await sql`
          insert into attendance (session_id, member_id, present)
          values (${session_id}, ${member_id}, ${present})
          on conflict (session_id, member_id)
          do update set present = ${present}
        `;
        return json(res, 200, { ok: true });
      }
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, error: "Method Not Allowed" });
    }

    // 404 API
    if (pathname.startsWith("/api/")) {
      return json(res, 404, { ok: false, error: "Not Found" });
    }

    // Pas une route /api/* => laisser Vercel servir le statique
    res.statusCode = 404;
    res.end("Not Found");
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}
