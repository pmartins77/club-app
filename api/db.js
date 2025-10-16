import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set");
}

export const sql = neon(process.env.DATABASE_URL);

export async function dbHealth() {
  const rows = await sql`select now() as now`;
  return rows?.[0]?.now ?? null;
}
