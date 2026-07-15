import assert from "node:assert/strict";
import test from "node:test";
import { runSignup } from "../src/commands/signup.mjs";
import { SIGNUP_URL } from "../src/constants.mjs";

test("signup prints a browser fallback under SSH and never invokes opener", async () => {
  let called = false;
  const outcome = await runSignup(
    { dryRun: false },
    {
      platform: "darwin",
      env: { SSH_CONNECTION: "present" },
      openBrowser: async () => {
        called = true;
        return true;
      },
    },
  );
  assert.equal(outcome.result.status, "browser-skipped");
  assert.equal(outcome.result.url, SIGNUP_URL);
  assert.equal(called, false);
});

test("signup reports browser failure while retaining the safe URL", async () => {
  const outcome = await runSignup(
    { dryRun: false },
    { platform: "darwin", env: {}, openBrowser: async () => false },
  );
  assert.equal(outcome.result.status, "browser-failed");
  assert.equal(outcome.result.opened, false);
  assert.equal(outcome.result.url, SIGNUP_URL);
});

test("signup dry run never invokes opener", async () => {
  let called = false;
  const outcome = await runSignup(
    { dryRun: true },
    { platform: "darwin", env: {}, openBrowser: async () => { called = true; return true; } },
  );
  assert.equal(outcome.result.status, "dry-run");
  assert.equal(called, false);
});

test("signup JSON and noninteractive modes never invoke opener", async () => {
  for (const options of [
    { dryRun: false, json: true, isInteractive: true },
    { dryRun: false, json: false, isInteractive: false },
  ]) {
    let called = false;
    const outcome = await runSignup(options, {
      platform: "darwin",
      env: {},
      isInteractive: options.isInteractive,
      openBrowser: async () => { called = true; return true; },
    });
    assert.equal(outcome.result.status, "browser-skipped");
    assert.equal(outcome.result.opened, false);
    assert.equal(called, false);
  }
});
