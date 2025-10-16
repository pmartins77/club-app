import express from "express";
import serverless from "serverless-http";
import { getSql, dbNow } from "./db.js";

const app = express();
app.use(express.json());

// --- API simple (ne touche pas à la DB) ---
app.get("/api/hello", (_req, res) => {
  res.json({ message: "Bienvenue sur club-app 👋" });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", ts: new Date().toISOString() });
});

// --- Vérif DB ---
app.get("/api/db/health", async (_req, res) => {
  try {
    const now = await dbNow();
    res.json({ ok: true, now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Membres ---
app.get("/api/members", async (_req, res) => {
  try {
    const sql = getSql();
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

// (optionnel) route de diagnostic sans secret
app.get("/api/env-check", (_req, res) => {
  res.json({ hasDatabaseUrl: Boolean(process.env.DATABASE_URL) });
});

export default serverless(app);
