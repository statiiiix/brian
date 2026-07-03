import { loadServerEnv } from "../env.js";
loadServerEnv();

const { upsertUser } = await import("../auth/users.js");
const { pool } = await import("../db/pool.js");

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env first.");
  process.exit(1);
}
const u = await upsertUser({ email, password, name: process.env.ADMIN_NAME ?? null });
console.log(`admin user ready: ${u.email} (${u.id})`);
if (!process.env.AUTH_JWT_SECRET) {
  console.warn("WARNING: AUTH_JWT_SECRET is not set — logins will fail until it is.");
}
await pool.end();
