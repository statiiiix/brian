import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { upsertUser, findUserByEmail, verifyPassword } from "./users.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

d("users repo", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await pool.query("delete from users where email = 'admin@test.io'");
  });
  afterAll(async () => { await pool.end(); });

  it("upserts, finds, verifies password; rejects wrong password", async () => {
    const u = await upsertUser({ email: "admin@test.io", password: "pw-one", name: "Admin" });
    expect(u.email).toBe("admin@test.io");
    const found = await findUserByEmail("admin@test.io");
    expect(found).not.toBeNull();
    expect(await verifyPassword(found!.password_hash, "pw-one")).toBe(true);
    expect(await verifyPassword(found!.password_hash, "nope")).toBe(false);

    await upsertUser({ email: "admin@test.io", password: "pw-two" });
    const again = await findUserByEmail("admin@test.io");
    expect(await verifyPassword(again!.password_hash, "pw-two")).toBe(true);
  });

  it("returns null for unknown email", async () => {
    expect(await findUserByEmail("ghost@test.io")).toBeNull();
  });
});
