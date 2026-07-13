import { spawn } from "node:child_process";

export function isHeadless(context) {
  const env = context.env ?? process.env;
  if (env.SSH_CONNECTION || env.SSH_TTY || env.CI) return true;
  if (context.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return true;
  return false;
}

export function launchBrowser(url, context) {
  if (!/^https:\/\//.test(url)) return Promise.resolve(false);
  const platform = context.platform ?? process.platform;
  const invocation = platform === "darwin"
    ? { command: "open", args: [url] }
    : platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] }
      : { command: "xdg-open", args: [url] };

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(invocation.command, invocation.args, {
      detached: true,
      stdio: "ignore",
      env: context.env ?? process.env,
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve(true);
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });
  });
}
