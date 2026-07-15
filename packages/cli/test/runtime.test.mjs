import assert from "node:assert/strict";
import test from "node:test";
import { createRuntime, interactiveCommandOptions } from "../src/runtime.mjs";

test("interactive login execution inherits the terminal and never uses a shell", () => {
  const env = { PATH: "/safe/bin" };
  assert.deepEqual(interactiveCommandOptions(env), {
    stdio: "inherit",
    shell: false,
    env,
  });
});

test("runtime command probes and execution remain injectable", () => {
  const commandSupports = () => true;
  const runInteractiveCommand = () => ({ status: "succeeded", exitCode: 0 });
  const runtime = createRuntime({
    env: { HOME: "/tmp", PATH: "" },
    isInteractive: false,
    commandSupports,
    runInteractiveCommand,
  });
  assert.equal(runtime.isInteractive, false);
  assert.equal(runtime.commandSupports, commandSupports);
  assert.equal(runtime.runInteractiveCommand, runInteractiveCommand);
});
