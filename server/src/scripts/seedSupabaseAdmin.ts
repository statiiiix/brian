// Create (or update) the founder's Supabase Auth user with tenant/role in
// app_metadata — the hosted replacement for `npm run seed:admin` (bcrypt).
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ADMIN_EMAIL/ADMIN_PASSWORD.
// Run: cd server && npm run seed:supabase-admin
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { FOUNDING_TENANT_ID } = await import("../db/tenant.js");

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!url || !serviceKey || !email || !password) {
  console.error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD in server/.env",
  );
  process.exit(2);
}

const headers = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  "content-type": "application/json",
};
const body = {
  email,
  password,
  email_confirm: true,
  app_metadata: { tenant_id: FOUNDING_TENANT_ID, role: "admin" },
};

const create = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST", headers, body: JSON.stringify(body),
});
if (create.ok) {
  console.log(`created Supabase auth user ${email} (tenant ${FOUNDING_TENANT_ID})`);
  process.exit(0);
}
// Already exists -> find and update (password + metadata).
const list = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
const { users = [] } = (await list.json()) as { users?: { id: string; email: string }[] };
const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!existing) {
  console.error(`create failed (${create.status}): ${await create.text()}`);
  process.exit(1);
}
const update = await fetch(`${url}/auth/v1/admin/users/${existing.id}`, {
  method: "PUT", headers, body: JSON.stringify(body),
});
if (!update.ok) {
  console.error(`update failed (${update.status}): ${await update.text()}`);
  process.exit(1);
}
console.log(`updated Supabase auth user ${email} (tenant ${FOUNDING_TENANT_ID})`);
