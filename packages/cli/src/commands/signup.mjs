import { SIGNUP_URL } from "../constants.mjs";
import { isHeadless, launchBrowser } from "../browser.mjs";

export async function runSignup(options, runtime) {
  const headless = isHeadless(runtime);
  if (options.dryRun || headless) {
    return {
      code: 0,
      result: {
        command: "signup",
        status: options.dryRun ? "dry-run" : "browser-skipped",
        url: SIGNUP_URL,
        opened: false,
        headless,
        message: headless ? "Open this URL in a browser to sign up." : "Dry run; browser was not opened.",
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
