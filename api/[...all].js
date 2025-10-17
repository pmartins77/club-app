// api/[...all].js
// Catch-all unique pour toutes les routes /api/* (sans Express)
// Compatible Vercel Hobby (1 seule Serverless Function)

import { neon } from "@neondatabase/serverless";

/* =========================
   Helpers génériques
   ========================= */
function json(res, code, obj) {
  res.statusCode = code || 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}
function text(res, code, body) {
  res.statusCode = code || 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body || "");
}
function withCORS(res) {
  // CORS simple, utile pour tests / front
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Lit le corps tel quel (texte brut)
async function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data || ""));
    req.on("error", reject);
  });
}

// Parse JSON proprement
async function readJSON(req) {
  const raw = await readRaw(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    const hint = ct.includes("json")
      ? "JSON invalide."
      : "Content-Type non JSON. Envoie application/json ou texte collé depuis Excel (TAB/;/, avec en-têtes).";
    throw new Error(`Impossible de parser le corps: ${hint}`);
  }
}

function getSQL() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

/* =========================
   Utils
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

/* ===== Saisons sportives (1 août → 30 juin) ===== */
const PIVOT_MONTH = 8; // Août
function seasonLabelFromDate(d, pivotMonth = PIVOT_MONTH) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getUTCFullYear(); const m = dt.getUTCMonth() + 1;
  return (m >= pivotMonth) ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
function currentSeasonLabel(now = new Date()) { return seasonLabelFromDate(now); }
function seasonBounds(seasonLabel, pivotMonth = PIVOT_MONTH) {
  const [y1, y2] = String(seasonLabel).split("/").map(Number);
  if (!y1 || !y2 || y2 !== y1 + 1) throw new Error("Season label invalide (ex: 2025/2026)");
  const start = new Date(Date.UTC(y1, pivotMonth - 1, 1, 0, 0, 0, 0)); // 1 août
  const end   = new Date(Date.UTC(y2, 5, 30, 23, 59, 59, 999));        // 30 juin
  return { start, end };
}

/* =========================
   Parsing CSV/TAB
   ========================= */
function detectDelimiter(headerLine) {
  const tab = (headerLine.match(/\t/g) || []).length;
  const sc  = (headerLine.match(/;/g) || []).length;
  const cm  = (headerLine.match(/,/g) || []).length;
  if (tab > 0 && tab >= sc && tab >= cm) return "\t";
  if (sc >= cm) return ";";
  return ",";
}
function splitCSVLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseCSV(text) {
  const norm = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!norm) return [];
  const lines = norm.split("\n").filter(l => l.trim().length);
  if (!lines.length) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = splitCSVLine(lines[0], delim).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delim);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? "").trim(); });
    rows.push(obj);
  }
  return rows;
}

/* =========================
   Router principal
   ========================= */
export default async function handler(req, res) {
  withCORS(res);

  // OPTIONS global (CORS/preflight)
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    // Normalisation ULTRA-robuste du chemin
    const method = req.method;
    const rawUrl = req.url || "/";
    const safePath = rawUrl.split("?")[0] || "/"; // fallback si URL bizarres
    const { pathname } = new URL(rawUrl, "https://dummy.local");

    // helper /chemin et /chemin/
    const is = (p) => safePath === p || safePath === p + "/" || pathname === p || pathname === p + "/";

    /* === Index /api (utile pour debug) === */
    if (is("/api") && method === "GET") {
      return json(res, 200, {
        ok: true,
        routes: [
          "GET /api/hello",
          "GET /api/health",
          "GET /api/env-check",
          "GET /api/db/health",
          "GET /api/teams",
          "GET /api/members?team_id=",
          "GET /api/dues?team_id=",
          "GET|POST /api/sessions",
          "GET|POST /api/attendance",
          "GET|POST /api/import/members",
          "POST /api/import/dues",
          "POST /api/import/sessions"
        ],
        now: new Date().toISOString()
      });
    }

    /* === Routes sans DB (toujours avant toute connexion DB) === */
    if (is("/api/hello")) {
      if (method !== "GET" && method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }
      return json(res, 200, { message: "Bienvenue sur club-app 👋" });
    }

    if (is("/api/health")) {
      if (method !== "GET") {
        res.setHeader("Allow", "GET");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }
      return json(res, 200, { ok: true, status: "healthy", ts: new Date().toISOString() });
    }

    if (is("/api/env-check")) {
      if (method !== "GET") {
        res.setHeader("Allow", "GET");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }
      return json(res, 200, { hasDatabaseUrl: !!process.env.DATABASE_URL });
    }

    /* === DB requise === */
    const sql = getSQL();

    // DB health
    if (is("/api/db/health")) {
      if (method !== "GET") {
        res.setHeader("Allow", "GET");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }
      const rows = await sql`select now() as now`;
      return json(res, 200, { ok: true, now: rows?.[0]?.now ?? null });
    }

    // Teams
    if (is("/api/teams")) {
      if (method !== "GET") {
        res.setHeader("Allow", "GET");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }
      const rows = await sql`select id, name from teams order by name`;
      return json(res, 200, { ok: true, data: rows });
    }

    // Members (optionnel ?team_id=)
    if (is("/api/members")) {
      if (method !== "GET") {
        res.setHeader("Allow", "GET");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }
      const params = new URL(rawUrl, "https://dummy.local").searchParams;
      const team_id = params.get("team_id");
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

    // Dues (cotisations) — GET ?team_id=&season=YYYY/YYYY+1
    if (is("/api/dues")) {
      if (method !== "GET") { res.setHeader("Allow","GET"); return json(res,405,{ok:false,error:"Method Not Allowed"}); }
      const params = new URL(rawUrl, "https://dummy.local").searchParams;
      const team_id = params.get("team_id");
      const season = params.get("season") || currentSeasonLabel(); // ex: 2025/2026
      const { start, end } = seasonBounds(season);
      const whereTeam = team_id ? sql`m.team_id = ${team_id}` : sql`true`;
      const rows = await sql`
        select
          m.id as member_id, m.first_name, m.last_name, m.email, m.member_number,
          t.name as team_name,
          exists (
            select 1 from dues d
            where d.member_id = m.id
              and (d.status = 'paid' or d.status = 'exempt')
              and coalesce(d.paid_at, d.transfer_date) >= ${start.toISOString()}::timestamptz
              and coalesce(d.paid_at, d.transfer_date) <= ${end.toISOString()}::timestamptz
          ) as paid_this_season
        from members m
        left join teams t on t.id = m.team_id
        where m.deleted = false and ${whereTeam}
        order by m.last_name, m.first_name
      `;
      return json(res, 200, { ok:true, season, start:start.toISOString(), end:end.toISOString(), data: rows });
    }

    // Sessions GET/POST (GET: ?team_id= | ?team_name= | ?date=YYYY-MM-DD)
    if (is("/api/sessions")) {
      const params = new URL(rawUrl, "https://dummy.local").searchParams;

      if (method === "GET") {
        const team_id = params.get("team_id");
        const team_name = params.get("team_name");
        const dateStr = params.get("date"); // yyyy-mm-dd (Europe/Paris)

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
        const body = await readJSON(req);
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
    if (is("/api/attendance")) {
      const params = new URL(rawUrl, "https://dummy.local").searchParams;

      if (method === "GET") {
        const session_id = params.get("session_id");
        if (!session_id) return json(res, 400, { ok: false, error: "session_id requis" });
        const rows = await sql`
          select a.member_id, a.present
          from attendance a
          where a.session_id = ${session_id}
        `;
        return json(res, 200, { ok: true, data: rows });
      }

      if (method === "POST") {
        const body = await readJSON(req);
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
    if (is("/api/import/members")) {
      // GET → doc d’usage
      if (method === "GET") {
        return json(res, 200, {
          ok: true,
          usage: {
            post_json: {
              content_type: "application/json",
              body_shape: "{ rows: Array<record> }",
              example: { rows: [
                { "Nom d'utilisateur": "Ines Scilva", "E-mail": "ines@example.com", "Équipe":"Equipe 10-12 ans", "Numéro de athlète":"ATH-001", "Genre":"female" }
              ] }
            },
            post_text: {
              content_type: "text/plain | text/csv",
              header_required: true,
              delimiter: "TAB (Excel), ; ou ,"
            }
          }
        });
      }

      if (method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }

      // JSON vs Texte (TAB/;/,)
      const ctype = (req.headers["content-type"] || "").toLowerCase();
      let rowsInput = [];
      if (ctype.includes("json")) {
        const body = await readJSON(req);
        rowsInput = Array.isArray(body?.rows) ? body.rows : [];
      } else {
        const raw = await readRaw(req);
        rowsInput = parseCSV(raw);
      }
      if (!rowsInput.length) return json(res, 400, { ok:false, error:"Aucune ligne détectée (vide)" });

      let teamsCreated = 0, inserted = 0, updated = 0;

      for (const r0 of rowsInput) {
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [String(k).trim(), v]));
        const prenom = (r["Prénom"] || r["Prenom"] || "").trim();
        const nom = (r["Nom de famille"] || r["Nom"] || "").trim();
        const fullUsername = (r["Nom d'utilisateur"] || "").trim();
        const email = (r["E-mail"] || r["Email"] || r["E-mail 2"] || "").trim().toLowerCase();
        const team_name = (r["Équipe"] || r["Equipe"] || r["Équipe/département"] || "").trim();
        const member_number = (r["Numéro de athlète"] || r["N° de maillot"] || r["N° de réf."] || r["Numéro de réf."] || "").trim();
        const gender = (r["Genre"] || "").trim().toLowerCase();

        let first_name = prenom;
        let last_name  = nom;
        if (!first_name && !last_name && fullUsername) {
          const sp = splitName(fullUsername);
          first_name = sp.first; last_name = sp.last;
        }
        if (!first_name && !last_name) continue;

        // upsert équipe
        let team_id = null;
        if (team_name) {
          const t = await sql`select id from teams where name=${team_name}`;
          if (t.length) team_id = t[0].id;
          else {
            const ins = await sql`insert into teams (name) values (${team_name}) returning id`;
            team_id = ins[0].id; teamsCreated++;
          }
        }

        // upsert membre
        let existing = [];
        if (email) existing = await sql`select id from members where email=${email}`;
        if (!existing.length && member_number)
          existing = await sql`select id from members where member_number=${member_number}`;
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
    if (is("/api/import/dues")) {
      if (method !== "POST") {
        res.setHeader("Allow", "POST");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }

      const ctype = (req.headers["content-type"] || "").toLowerCase();
      let defaultSeason = currentSeasonLabel();
      let rowsInput = [];
      if (ctype.includes("json")) {
        const body = await readJSON(req);
        rowsInput = Array.isArray(body?.rows) ? body.rows : [];
      } else {
        const raw = await readRaw(req);
        rowsInput = parseCSV(raw);
      }

      if (!rowsInput.length) return json(res, 400, { ok:false, error:"rows requis (JSON) ou texte vide" });

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
      let lastSeason = null;

      for (const r0 of rowsInput) {
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [String(k).trim(), v]));

        const email = (r["E-mail"] || r["Email"] || "").trim().toLowerCase();
        const nom = (r["Nom"] || r["Nom d'utilisateur"] || "").trim();
        const prenom = (r["Prénom"] || r["Prenom"] || "").trim();
        const team_name = (r["Équipe"] || r["Equipe"] || r["Équipe/département"] || "").trim();
        const refNum = (r["N° de réf."] || r["No de réf."] || r["Numéro de athlète"] || "").trim();

        const payment_method = (r["Paiement"] || "").trim();
        const amount = String(r["Montant"] || "").replace(',', '.').trim();
        const status = (r["Statut"] || "").trim();

        const license_validated = normBool(r["License validée"] || r["Licence validée"]);
        const license_text = (r["Licence"] || "").trim();
        const certificate_valid = normBool(r["CERTIFICAT MEDICAL"]);
        const t_shirt_size = (r["Taille de t-shirt"] || "").trim();
        const questionnaire_minor = normBool(r["Questionnaire de santé (Mineur)"]);

        const paid_at_raw   = (r["Payé le"] || r["paid_at"] || "").trim();
        const transfer_raw  = (r["Date du versement"] || r["transfer_date"] || "").trim();
        let rowSeason = (r["Saison"] || r["season"] || "").trim();
        if (!rowSeason) {
          const refDate = paid_at_raw || transfer_raw;
          rowSeason = refDate ? seasonLabelFromDate(new Date(refDate)) : defaultSeason;
        }
        const season = rowSeason || defaultSeason;
        const paid_at = paid_at_raw;
        const transfer_date = transfer_raw;
        lastSeason = season;

        // équipe
        let team_id = null;
        if (team_name) {
          const t = await sql`select id from teams where name=${team_name}`;
          if (t.length) team_id = t[0].id;
          else {
            const insT = await sql`insert into teams (name) values (${team_name}) returning id`;
            team_id = insT[0].id; teams_created++;
          }
        }

        // membre
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
          if (team_id != null) {
            await sql`update members set team_id=${team_id} where id=${member_id}`;
          }
        } else {
          if (!nom && !prenom && !email && !refNum) continue;
          const insM = await sql`
            insert into members (first_name, last_name, email, member_number, team_id)
            values (${prenom || null}, ${nom || null}, ${email || null}, ${refNum || null}, ${team_id})
            returning id
          `;
          member_id = insM[0].id;
          members_created++;
        }

        // upsert due
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

      return json(res, 200, { ok:true, upserted, members_created, teams_created, season: lastSeason || defaultSeason });
    }

    // 3) IMPORT SÉANCES
    if (is("/api/import/sessions")) {
      if (method !== "POST") {
        res.setHeader("Allow", "POST");
        return json(res, 405, { ok:false, error:"Method Not Allowed" });
      }
      const ctype = (req.headers["content-type"] || "").toLowerCase();
      let rowsInput = [];
      if (ctype.includes("json")) {
        const body = await readJSON(req);
        rowsInput = Array.isArray(body?.rows) ? body.rows : [];
      } else {
        const raw = await readRaw(req);
        rowsInput = parseCSV(raw);
      }
      if (!rowsInput.length) return json(res, 400, { ok:false, error:"rows requis (JSON ou texte vide)" });

      let inserted = 0;
      for (const r0 of rowsInput) {
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [String(k).trim(), v]));
        const team_name = (r.team_name || r["Équipe"] || r["Equipe"] || "").trim();
        const title     = (r.title     || r["Titre"] || "").trim() || "Séance";
        const starts_at = (r.starts_at || r["Date/Heure"] || "").trim();
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
    if (safePath.startsWith("/api/") || pathname.startsWith("/api/")) {
      return json(res, 404, { ok: false, error: "Not Found", path: safePath });
    }

    // Pas une route /api/* => laisser Vercel servir le statique
    res.statusCode = 404;
    res.end("Not Found");
  } catch (e) {
    const msg = e?.message || "Unknown error";
    return json(res, 500, { ok: false, error: msg });
  }
}
