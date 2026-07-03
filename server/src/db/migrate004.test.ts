import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("migration 004: users + interviews", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates users with unique email", async () => {
    await pool.query("delete from users where email = 'a@b.c'");
    await pool.query("insert into users (email, password_hash) values ('a@b.c','h')");
    await expect(
      pool.query("insert into users (email, password_hash) values ('a@b.c','h2')")
    ).rejects.toThrow();
    await pool.query("delete from users where email = 'a@b.c'");
  });

  it("creates interviews with defaults", async () => {
    const { rows } = await pool.query(
      "insert into interviews (topic) values ('refunds') returning *"
    );
    expect(rows[0].status).toBe("active");
    expect(rows[0].messages).toEqual([]);
    expect(rows[0].coverage).toEqual({});
    expect(rows[0].draft).toBeNull();
    await pool.query("delete from interviews where id = $1", [rows[0].id]);
  });

  it("is convergent (re-runs cleanly)", async () => {
    await runMigrations(pool);
  });
});
