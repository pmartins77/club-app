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
  try {
    const { method, url } = req;
    const { pathname, searchParams } = new URL(url, "https://dummy.local");

    /* === Routes simples sans DB === */
    if (pathname === "/api/hello" && method === "GET") {
      return json(res, 200, { message: "Bienvenue sur club-app 👋" });
    }
    if (pathname === "/api/health" && method === "GET") {
      return json(res, 200, { ok: true, status: "healthy", ts: new Date().toISOString() });
    }
    if (pathname === "/api/env-check" && method === "GET") {
      return json(res, 200, { hasDatabaseUrl: !!process.env.DATABASE_URL });
    }

    /* === DB requise === */
    const sql = getSQL();

    if (pathname === "/api/db/health" && method === "GET") {
      const rows = await sql`select now() as now`;
      return json(res, 200, { ok: true, now: rows?.[0]?.now ?? null });
    }

    /* === IMPORT MEMBRES === */
    if (pathname === "/api/import/members") {
      // ---- GET (usage doc)
      if (method === "GET") {
        return json(res, 200, {
          ok: true,
          usage: {
            post_json: {
              content_type: "application/json",
              body_shape: "{ rows: Array<record> }",
              example: { rows: [
                {
                  "Nom d'utilisateur": "Ines Scilva",
                  "E-mail": "ines@example.com",
                  "Équipe": "Equipe 10-12 ans",
                  "Numéro de athlète": "ATH-001",
                  "Genre": "female"
                }
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

      // ---- POST (vrai import)
      if (method !== "POST") {
        res.setHeader("Allow", "GET, POST");
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
      if (!rowsInput.length) return json(res, 400, { ok:false, error:"Aucune ligne détectée (vide)" });

      let teamsCreated = 0, inserted = 0, updated = 0;

      for (const r0 of rowsInput) {
        const r = Object.fromEntries(Object.entries(r0).map(([k,v]) => [String(k).trim(), v]));
        const prenom = (r["Prénom"] || r["Prenom"] || "").trim();
        const nom = (r["Nom de famille"] || r["Nom"] || "").trim();
        const fullUsername = (r["Nom d'utilisateur"] || "").trim();
        const email = (r["E-mail"] || r["Email"] || r["E-mail 2"] || "").trim().toLowerCase();
        const team_name = (r["Équipe"] || r["Equipe"] || r["Équipe/département"] || "").trim();
        const member_number = (r["Numéro de athlète"] || r["N° de maillot"] || "").trim();
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
            limit 1`;
        }

        if (existing.length) {
          const id = existing[0].id;
          await sql`
            update members
            set first_name=${first_name}, last_name=${last_name},
                email=${email || null}, member_number=${member_number || null},
                gender=${gender || null}, team_id=${team_id}
            where id=${id}`;
          updated++;
        } else {
          await sql`
            insert into members (first_name,last_name,email,team_id,gender,member_number)
            values (${first_name},${last_name},${email||null},${team_id},${gender||null},${member_number||null})`;
          inserted++;
        }
      }
      return json(
