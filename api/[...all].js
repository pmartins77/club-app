// api/[...all].js
// Catch-all unique pour toutes les routes /api/* (sans Express)
// Compatible Vercel Hobby (1 seule Serverless Function)

import { neon } from "@neondatabase/serverless";

/* =========================
   CORS (simple & safe)
   ========================= */
const ALLOW_ORIGIN = "*";
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function isPreflight(req) {
  return req.method === "OPTIONS";
}

/* =========================
   Helpers HTTP
   ========================= */
function json(res, code, obj) {
  res.statusCode = code || 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

/**
 * Lit le corps en BRUT (string ou Buffer).
 * N'essaie PAS de parser JSON.
 */
async function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Lit le corps intelligemment selon le Content-Type :
 * - application/json -> renvoie l'objet JSON
 * - text/plain, text/csv -> renvoie { _rawText: "..." }
 * - autre -> tente JSON puis fallback texte
 */
async function readBodySmart(req) {
  const buf = await readRaw(req);
  const ctype = (req.headers["content-type"] || "").toLowerCase();

  // JSON explicite
  if (ctype.includes("application/json")) {
    try {
      return JSON.parse(buf.toString("utf8") || "{}");
    } catch (e) {
      throw new Error("JSON invalide: " + e.message);
    }
  }

  // CSV / texte
  if (ctype.includes("text/plain") || ctype.includes("text/csv")) {
    return { _rawText: buf.toString("utf8") };
  }

  // Tentative JSON, sinon texte
  const asString = buf.toString("utf8");
  try {
    return JSON.parse(asString);
  } catch {
    return { _rawText: asString };
  }
}

function getSQL() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

/* =========================
   Normalisations / util
   ========================= */
function normBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return ["1","true","vrai","oui","yes","y","x"].includes(s) ? true
       : ["0","false","faux","non","no","n"].includes(s) ? false
       : null;
}
function splitName(full) {
  const p = (full || "").trim().split(/\s+/);
  if (p.length === 0) return { first:"", last:"" };
  if (p.length === 1) return { first:p[0], last:"" };
  return { first:p[0], last:p.slice(1).join(" ") };
}

/**
 * Parse un CSV en tableau d'objets.
 * - Autodétecte le séparateur ; ou ,
 * - Utilise la 1ère ligne comme en-têtes
 * - Trim chaque cellule
 */
function parseCSVToRows(csvText) {
  const text = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];

  // Détection séparateur par fréquence
  const firstLine = text.split("\n")[0];
  const countSemi = (firstLine.match(/;/g) || []).length;
  const countComma = (firstLine.match(/,/g) || []).length;
  const sep = countSemi >= countComma ? ";" : ",";

  const lines = text.split("\n");
  const headers = lines[0].split(sep).map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(sep).map((c) => c.trim());
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    rows.push(obj);
  }
  return rows;
}

/* =========================
   ROUTER
   ========================= */
export default async function handler(req, res) {
  setCors(res);
  if (isPreflight(req)) {
    res.statusCode = 204;
    return res.end();
  }

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

    // Sessions GET/POST
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
        const body = await readBodySmart(req);
        const { title, starts_at, team_id } = body || {};
        if (!title || !starts_at) return json(res, 400, { ok: false, error: "title et starts_at requis" });
        const rows = await sql`
          insert into sessions (title, starts_at, team_id)
          values (${title}, ${starts_at}, ${team_id ?? null})
          returning id, team_id, title, starts_at
        `;
        return json(res, 200, { ok: true, data: rows[0] });
      }
      res.setHeader("Allow", "GET, POST, OPTIONS");
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
        const body = await readBodySmart(req);
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
      res.setHeader("Allow", "GET, POST, OPTIONS");
      return json(res, 405, { ok: false, error: "Method Not Allowed" });
    }

    /* =========================
       IMPORTS (Membres / Cotisations / Séances)
       ========================= */

    // --- IMPORT MEMBRES (JSON rows OU CSV brut) ---
    if (
      (pathname === "/api/import/members" || pathname === "/api/import/members-csv") &&
      method === "POST"
    ) {
      const body = await readBodySmart(req);

      // rows JSON ?
      let rows = Array.isArray(body?.rows) ? body.rows : [];

      // CSV brut ?
      if (!rows.length && typeof body?._rawText === "string" && body._rawText.trim()) {
        rows = parseCSVToRows(body._rawText);
      }

      if (!rows.length) {
        return json(res, 400, {
          ok: false,
          error:
            "Aucune donnée détectée. Envoyez soit { rows:[...] } en JSON, soit du CSV brut (text/csv ou text/plain).",
          hint: "CSV attendu avec en-têtes (ex: Prénom;Nom de famille;E-mail;Équipe;Numéro de athlète;Genre;...)"
        });
      }

      let teamsCreated = 0, inserted = 0, updated = 0;

      for (const r0 of rows) {
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [String(k).trim(), v]));

        // mapping conforme à tes exports
        const prenom = (r["Prénom"] || r["Prenom"] || "").trim?.() ?? "";
        const nom = (r["Nom de famille"] || r["Nom"] || "").trim?.() ?? "";
        const fullUsername = (r["Nom d'utilisateur"] || "").trim?.() ?? "";
        const email = (r["E-mail"] || r["Email"] || r["E-mail 2"] || "").trim?.().toLowerCase() ?? "";
        const team_name = (r["Équipe"] || r["Equipe"] || r["Équipe/département"] || r["Equipe/département"] || "").trim?.() ?? "";
        const member_number = (r["Numéro de athlète"] || r["N° de maillot"] || r["N° de réf."] || r["Numéro de réf."] || "").trim?.() ?? "";
        const gender = (r["Genre"] || "").trim?.().toLowerCase() ?? "";

        let first_name = prenom;
        let last_name  = nom;

        if (!first_name && !last_name && fullUsername) {
          const sp = splitName(fullUsername);
          first_name = sp.first; last_name = sp.last;
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

      return json(res, 200, { ok:true, mode: Array.isArray(body?.rows) ? "json" : "csv", teams_created: teamsCreated, inserted, updated });
    }

    // --- IMPORT COTISATIONS (inchangé) ---
    if (pathname === "/api/import/dues" && method === "POST") {
      const body = await readBodySmart(req);
      const season = (body?.season || "2024-2025").trim?.() ?? "2024-2025";
      let rows = Array.isArray(body?.rows) ? body.rows : [];

      if (!rows.length && typeof body?._rawText === "string" && body._rawText.trim()) {
        rows = parseCSVToRows(body._rawText);
      }
      if (!rows.length) return json(res, 400, { ok:false, error:"rows requis (JSON ou CSV brut)" });

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
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [String(k).trim(), v]));

        const email = (r["E-mail"] || r["Email"] || "").trim?.().toLowerCase() ?? "";
        const nom = (r["Nom"] || r["Nom d'utilisateur"] || "").trim?.() ?? "";
        const prenom = (r["Prénom"] || r["Prenom"] || "").trim?.() ?? "";
        const team_name = (r["Équipe"] || r["Equipe"] || r["Équipe/département"] || r["Equipe/département"] || "").trim?.() ?? "";
        const refNum = (r["N° de réf."] || r["No de réf."] || r["Numéro de athlète"] || "").trim?.() ?? "";

        const payment_method = (r["Paiement
