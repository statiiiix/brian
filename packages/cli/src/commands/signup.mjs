import { SIGNUP_URL } from "../constants.mjs";
import { isHeadless, launchBrowser } from "../browser.mjs";

export async function runSignup(options, runtime) {
  const headless = isHeadless(runtime);
  const noninteractive = options.json || runtime.isInteractive === false;
  if (options.dryRun || headless || noninteractive) {
    return {
      code: 0,
      result: {
        command: "signup",
        status: options.dryRun ? "dry-run" : "browser-skipped",
        url: SIGNUP_URL,
        opened: false,
        headless,
        message: options.dryRun
          ? "Dry run; browser was not opened."
          : "Open this URL in a browser to sign up.",
      },
    };
  }

  const opener = runtime.openBrowser ?? ((url) => launchBrowser(url, runtime));
  const opened = await opener(SIGNUP_URL).catch(() => false);
  return {
    code: 0,
    result: {
      command: "signup",
      status: opened ? "opened" : "browser-failed",
      url: SIGNUP_URL,
      opened,
      headless: false,
      message: opened ? "Signup opened in your browser." : "Browser launch failed; open this URL manually.",
    },
  };
}
