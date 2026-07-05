import bcrypt from "bcryptjs";
import { db, tenantOrFounding, type Queryable } from "../db/tenant.js";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

const COLS = "id, email, name, role, created_at";

export async function upsertUser(
  input: { email: string; password: string; name?: string | null; role?: string },
  p: Queryable = db()
): Promise<User> {
  const hash = await bcrypt.hash(input.password, 10);
  const { rows } = await p.query(
    `insert into users (email, password_hash, name, role, tenant_id)
     values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, email) do update
       set password_hash = excluded.password_hash,
           name = coalesce(excluded.name, users.name),
           role = excluded.role
     returning ${COLS}`,
    [input.email.toLowerCase(), hash, input.name ?? null, input.role ?? "admin", tenantOrFounding()]
  );
  return rows[0];
}

export async function findUserByEmail(
  email: string, p: Queryable = db()
): Promise<(User & { password_hash: string }) | null> {
  const { rows } = await p.query(
    `select ${COLS}, password_hash from users where email = $1 and tenant_id = $2`,
    [email.toLowerCase(), tenantOrFounding()]
  );
  return rows[0] ?? null;
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
