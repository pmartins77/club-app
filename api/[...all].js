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

// --------- Normalisations / util ---------
function normBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return ["1","true","vrai","oui","yes","y","x"].includes(s) ? true
       : ["0","false","faux","non","no","n"].includes(s) ? false
       : null;
}
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
}
function splitName(full) {
  // "Ines Silva" -> {first:"Ines", last:"Silva"}
  const p = (full || "").trim().split(/\s+/);
  if (p.length === 0) return { first:"", last:"" };
  if (p.length === 1) return { first:p[0], last:"" };
  return { first:p[0], last:p.slice(1).join(" ") };
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

    // Teams
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

    // Sessions GET/POST (GET supporte ?team_id= OU ?team_name=, et/ou ?date=YYYY-MM-DD)
    if (pathname === "/api/sessions") {
      if (method === "GET") {
        const team_id = searchParams.get("team_id");
        const team_name = searchParams.get("team_name");
        const dateStr = searchParams.get("date"); // yyyy-mm-dd (Europe/Paris)

        let rows;
        if (dateStr) {
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

    /* =========================
       IMPORTS (Membres / Cotisations / Séances)
       ========================= */

    // 1) IMPORT MEMBRES
    if (pathname === "/api/import/members" && method === "POST") {
      const body = await readBody(req);
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (!rows.length) return json(res, 400, { ok:false, error:"rows requis" });

      let teamsCreated = 0, inserted = 0, updated = 0;

      for (const r0 of rows) {
        // mapping d’en-têtes FR variés
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [k.trim(), v]));
        const fullName = r["Nom d'utilisateur"] || r["Utilisateur"] || "";
        const nom = r["Nom"] || "";
        const prenom = r["Prénom"] || r["Prenom"] || "";
        const email = (r["E-mail"] || r["Email"] || r["Courriel"] || r["E-mail 2"] || "").trim().toLowerCase();
        const team_name = (r["Équipe"] || r["Equipe"] || r["Équipe/département"] || r["Equipe/département"] || "").trim();
        const member_number = (r["Numéro de athlète"] || r["Numéro de athlete"] || r["Numéro de réf."] || r["N° de réf."] || "").trim();
        const gender = (r["Genre"] || "").trim().toLowerCase();

        let first_name = prenom;
        let last_name = nom;
        if (!first_name && !last_name && fullName) {
          const sp = splitName(fullName); first_name = sp.first; last_name = sp.last;
        }
        if (!first_name && !last_name) continue;

        // upsert équipe par nom
        let team_id = null;
        if (team_name) {
          const t = await sql`select id from teams where name=${team_name}`;
          if (t.length) team_id = t[0].id;
          else {
            const ins = await sql`insert into teams (name) values (${team_name}) returning id`;
            team_id = ins[0].id; teamsCreated++;
          }
        }

        // upsert membre (email -> member_number -> nom+prenom)
        let existing = [];
        if (email) existing = await sql`select id from members where email=${email}`;
        if (!existing.length && member_number) existing = await sql`select id from members where member_number=${member_number}`;
        if (!existing.length && (first_name || last_name)) {
          existing = await sql`
            select id from members
            where lower(first_name)=lower(${first_name}) and lower(last_name)=lower(${last_name})
            limit 1
          `;
        }

        if (existing.length) {
          const id = existing[0].id;
          await sql`
            update members
            set first_name=${first_name}, last_name=${last_name},
                email=${email || null}, member_number=${member_number || null},
                gender=${gender || null}, team_id=${team_id}
            where id=${id}
          `;
          updated++;
        } else {
          await sql`
            insert into members (first_name,last_name,email,team_id,gender,member_number)
            values (${first_name}, ${last_name}, ${email || null}, ${team_id}, ${gender || null}, ${member_number || null})
          `;
          inserted++;
        }
      }

      return json(res, 200, { ok:true, teams_created: teamsCreated, inserted, updated });
    }

    // 2) IMPORT COTISATIONS
    // crée la table dues si absente + upsert par membre (lié via email/numéro/nom+prénom)
    if (pathname === "/api/import/dues" && method === "POST") {
      const body = await readBody(req);
      const season = (body?.season || "2024-2025").trim();
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (!rows.length) return json(res, 400, { ok:false, error:"rows requis" });

      // DDL minimal (safe)
      await sql`
        create table if not exists dues (
          id bigserial primary key,
          member_id bigint references members(id) on delete cascade,
          season text not null,
          payment_method text,
          amount numeric(10,2),
          status text,
          paid_at timestamptz,
          transfer_date timestamptz,
          license_validated boolean,
          license_text text,
          certificate_valid boolean,
          t_shirt_size text,
          questionnaire_minor boolean,
          created_at timestamptz not null default now(),
          unique(member_id, season)
        )
      `;

      let upserted = 0, members_created = 0, teams_created = 0;

      for (const r0 of rows) {
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [k.trim(), v]));

        const email = (r["E-mail"] || r["Email"] || "").trim().toLowerCase();
        const nom = (r["Nom"] || r["Nom d'utilisateur"] || "").trim();
        const prenom = (r["Prénom"] || r["Prenom"] || "").trim();
        const team_name = (r["Équipe"] || r["Equipe"] || r["Équipe/département"] || r["Equipe/département"] || "").trim();
        const refNum = (r["N° de réf."] || r["No de réf."] || r["Numéro de athlète"] || "").trim();

        const payment_method = (r["Paiement"] || "").trim();
        const amount = (r["Montant"] || "").replace(',', '.').trim();
        const status = (r["Statut"] || "").trim();

        const paid_at = (r["Payé le"] || "").trim();
        const transfer_date = (r["Date du versement"] || "").trim();

        const license_validated = normBool(r["License validée"] || r["Licence validée"]);
        const license_text = (r["Licence"] || "").trim();
        const certificate_valid = normBool(r["CERTIFICAT MEDICAL"]);
        const t_shirt_size = (r["Taille de t-shirt"] || "").trim();
        const questionnaire_minor = normBool(r["Questionnaire de santé (Mineur)"]);

        // Trouver (ou créer) l’équipe
        let team_id = null;
        if (team_name) {
          const t = await sql`select id from teams where name=${team_name}`;
          if (t.length) team_id = t[0].id;
          else {
            const insT = await sql`insert into teams (name) values (${team_name}) returning id`;
            team_id = insT[0].id; teams_created++;
          }
        }

        // Trouver (ou créer) le membre
        let member = [];
        if (email) member = await sql`select id from members where email=${email}`;
        if (!member.length && refNum) member = await sql`select id from members where member_number=${refNum}`;
        if (!member.length && (prenom || nom)) {
          member = await sql`
            select id from members
            where lower(first_name)=lower(${prenom}) and lower(last_name)=lower(${nom})
            limit 1
          `;
        }
        let member_id;
        if (member.length) {
          member_id = member[0].id;
          // On peut mettre à jour l’équipe si fournie
          if (team_id != null) {
            await sql`update members set team_id=${team_id} where id=${member_id}`;
          }
        } else {
          // créer un membre minimal (si on a au moins un nom)
          if (!nom && !prenom && !email && !refNum) continue;
          const insM = await sql`
            insert into members (first_name, last_name, email, member_number, team_id)
            values (${prenom || null}, ${nom || null}, ${email || null}, ${refNum || null}, ${team_id})
            returning id
          `;
          member_id = insM[0].id;
          members_created++;
        }

        // Upsert due (member_id + season)
        const existing = await sql`select id from dues where member_id=${member_id} and season=${season}`;
        if (existing.length) {
          await sql`
            update dues
            set payment_method=${payment_method || null},
                amount=${amount ? Number(amount) : null},
                status=${status || null},
                paid_at=${paid_at ? paid_at : null}::timestamptz,
                transfer_date=${transfer_date ? transfer_date : null}::timestamptz,
                license_validated=${license_validated},
                license_text=${license_text || null},
                certificate_valid=${certificate_valid},
                t_shirt_size=${t_shirt_size || null},
                questionnaire_minor=${questionnaire_minor}
            where id=${existing[0].id}
          `;
        } else {
          await sql`
            insert into dues (member_id, season, payment_method, amount, status, paid_at, transfer_date,
                              license_validated, license_text, certificate_valid, t_shirt_size, questionnaire_minor)
            values (${member_id}, ${season}, ${payment_method || null}, ${amount ? Number(amount) : null},
                    ${status || null}, ${paid_at ? paid_at : null}::timestamptz,
                    ${transfer_date ? transfer_date : null}::timestamptz,
                    ${license_validated}, ${license_text || null}, ${certificate_valid},
                    ${t_shirt_size || null}, ${questionnaire_minor})
          `;
        }
        upserted++;
      }

      return json(res, 200, { ok:true, upserted, members_created, teams_created, season });
    }

    // 3) IMPORT SÉANCES (conservé)
    if (pathname === "/api/import/sessions" && method === "POST") {
      const body = await readBody(req);
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (!rows.length) return json(res, 400, { ok:false, error:"rows requis" });

      let inserted = 0;
      for (const r0 of rows) {
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [k.trim(), v]));
        const team_name = (r.team_name || "").trim();
        const title     = (r.title     || "").trim() || "Séance";
        const starts_at = (r.starts_at || "").trim();
        if (!starts_at) continue;

        let team_id = null;
        if (team_name) {
          const t = await sql`select id from teams where name=${team_name}`;
          if (t.length) team_id = t[0].id;
          else {
            const ins = await sql`insert into teams (name) values (${team_name}) returning id`;
            team_id = ins[0].id;
          }
        }

        const dup = await sql`
          select 1 from sessions
          where team_id is not distinct from ${team_id}
            and title = ${title}
            and starts_at = ${starts_at}::timestamptz
          limit 1
        `;
        if (dup.length) continue;

        await sql`
          insert into sessions (team_id,title,starts_at)
          values (${team_id}, ${title}, ${starts_at}::timestamptz)
        `;
        inserted++;
      }

      return json(res, 200, { ok:true, inserted });
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
