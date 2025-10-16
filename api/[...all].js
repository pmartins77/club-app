import express from "express";
import serverless from "serverless-http";
import { sql } from "./db.js";

const app = express();
app.use(express.json());

// --- API simple ---
app.get("/api/hello", (req, res) => {
  res.json({ message: "Bienvenue sur club-app 👋" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "healthy", ts: new Date().toISOString() });
});

// --- Vérif DB ---
app.get("/api/db/health", async (req, res) => {
  try {
    const rows = await sql`select now() as now`;
    res.json({ ok: true, now: rows?.[0]?.now ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Membres ---
app.get("/api/members", async (req, res) => {
  try {
    const rows = await sql`
      select m.id, m.first_name, m.last_name, m.email,
             m.member_number, m.gender, m.created_at, t.name as team_name
      from members m
      left join teams t on t.id = m.team_id
      where m.deleted = false
      order by m.last_name, m.first_name
    `;
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default serverless(app);
