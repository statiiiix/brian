import bcrypt from "bcryptjs";
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";

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
  p: pg.Pool = defaultPool
): Promise<User> {
  const hash = await bcrypt.hash(input.password, 10);
  const { rows } = await p.query(
    `insert into users (email, password_hash, name, role)
     values ($1, $2, $3, $4)
     on conflict (email) do update
       set password_hash = excluded.password_hash,
           name = coalesce(excluded.name, users.name),
           role = excluded.role
     returning ${COLS}`,
    [input.email.toLowerCase(), hash, input.name ?? null, input.role ?? "admin"]
  );
  return rows[0];
}

export async function findUserByEmail(
  email: string, p: pg.Pool = defaultPool
): Promise<(User & { password_hash: string }) | null> {
  const { rows } = await p.query(
    `select ${COLS}, password_hash from users where email = $1`,
    [email.toLowerCase()]
  );
  return rows[0] ?? null;
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
