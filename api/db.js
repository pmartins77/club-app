import { neon } from "@neondatabase/serverless";

let _sql = null;

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!_sql) {
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

export async function dbNow() {
  const sql = getSql();
  const rows = await sql`select now() as now`;
  return rows?.[0]?.now ?? null;
}
