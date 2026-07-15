import { CANONICAL_MCP_URL, EXIT } from "../constants.mjs";
import { applyChanges, preflightChanges } from "../config/files.mjs";
import { readLastHealth } from "../config/health.mjs";
import { selectedPlatforms } from "../platforms/index.mjs";

function candidates(options) {
  return selectedPlatforms(options.only).map((platform) => ({
    platform,
    detection: platform.detect(options.runtime),
  }));
}

function safeChange(change) {
  return { file: change.file, action: change.action, kind: change.kind };
}

function safePlan(plan) {
  return {
    name: plan.name,
    label: plan.label,
    before: plan.before,
    actions: plan.changes.map(safeChange),
    warnings: [...plan.warnings],
    errors: [...plan.errors],
    nextStep: plan.nextStep,
    restartRequired: plan.restartRequired,
  };
}

function authenticationRecord(platform, plan, authentication, extra = {}) {
  return {
    client: platform.name,
    configured: true,
    authentication,
    retryCommand: plan.retryCommand,
    instruction: plan.instruction,
    ...extra,
  };
}

async function authenticateConfiguredClients(platforms, options, runtime) {
  const suppressCommands = options.json
    || options.dryRun
    || options.noLogin
    || !runtime.isInteractive;
  const records = [];
  for (const platform of platforms) {
    const plan = platform.loginPlan(runtime);
    if (plan.kind === "manual") {
      records.push(authenticationRecord(platform, plan, "manual"));
      continue;
    }
    if (plan.kind !== "command" || suppressCommands) {
      records.push(authenticationRecord(platform, plan, "skipped"));
      continue;
    }
    const approved = typeof runtime.confirmLogin === "function"
      ? await runtime.confirmLogin({
        name: platform.name,
        label: platform.label,
        retryCommand: plan.retryCommand,
      })
      : false;
    if (!approved) {
      records.push(authenticationRecord(platform, plan, "skipped"));
      continue;
    }
    let result;
    try {
      result = await runtime.runInteractiveCommand(plan.executable, [...plan.args]);
    } catch {
      result = { status: "failed", exitCode: null };
    }
    if (result?.status === "succeeded") {
      records.push(authenticationRecord(platform, plan, "authenticated"));
      continue;
    }
    const exitCode = Number.isInteger(result?.exitCode)
      && result.exitCode >= 0
      && result.exitCode <= 255
      ? result.exitCode
      : null;
    records.push(authenticationRecord(
      platform,
      plan,
      "failed",
      exitCode === null ? {} : { exitCode },
    ));
  }
  return records;
}

export function runStatus(options, runtime) {
  const selected = selectedPlatforms(options.only);
  const clients = selected.map((platform) => platform.inspect(runtime));
  const detected = clients.filter((client) => client.detected);
  return {
    code: detected.length ? EXIT.OK : EXIT.NO_CLIENTS,
    result: {
      command: "status",
      status: detected.length ? "ok" : "no-clients",
      canonicalMcpUrl: CANONICAL_MCP_URL,
      lastHealthCheck: readLastHealth(runtime),
      clients,
    },
  };
}

async function runMutation(command, options, runtime) {
  const rows = selectedPlatforms(options.only).map((platform) => ({
    platform,
    detection: platform.detect(runtime),
  }));
  const detected = rows.filter((row) => row.detection.detected);
  if (!detected.length) {
    return {
      code: EXIT.NO_CLIENTS,
      result: {
        command,
        status: "no-clients",
        canonicalMcpUrl: CANONICAL_MCP_URL,
        clients: rows.map(({ platform, detection }) => ({
          name: platform.name,
          label: platform.label,
          detected: false,
          evidence: detection.evidence,
        })),
      },
    };
  }

  const plans = detected.map(({ platform }) => command === "connect"
    ? platform.connectPlan(runtime)
    : platform.disconnectPlan(runtime));
  const changes = plans.flatMap((plan) => plan.changes);
  const preflight = preflightChanges(changes);
  const planErrors = plans.flatMap((plan) => plan.errors.map((reason) => ({ client: plan.name, reason })));
  const errors = [...planErrors, ...preflight];
  const baseResult = {
    command,
    canonicalMcpUrl: CANONICAL_MCP_URL,
    clients: plans.map(safePlan),
    notDetected: rows
      .filter((row) => !row.detection.detected)
      .map(({ platform, detection }) => ({ name: platform.name, label: platform.label, evidence: detection.evidence })),
    changes: changes.map(safeChange),
    errors,
  };

  if (errors.length) {
    return { code: EXIT.FAILED, result: { ...baseResult, status: "blocked" } };
  }
  if (options.dryRun) {
    return { code: EXIT.OK, result: { ...baseResult, status: "dry-run" } };
  }
  if (changes.length && !options.yes) {
    if (options.json || typeof runtime.confirm !== "function") {
      return {
        code: EXIT.DECLINED,
        result: { ...baseResult, status: "confirmation-required", errors: [] },
      };
    }
    const approved = await runtime.confirm({ ...baseResult, status: "planned" });
    if (!approved) {
      return { code: EXIT.DECLINED, result: { ...baseResult, status: "declined", errors: [] } };
    }
  }

  let applied = { applied: [], errors: [] };
  if (changes.length) {
    applied = applyChanges(changes, { now: runtime.now });
    if (applied.errors.length) {
      return {
        code: EXIT.FAILED,
        result: { ...baseResult, status: "failed", applied: applied.applied, errors: applied.errors },
      };
    }
  }
  const configurationStatus = changes.length ? "applied" : "unchanged";
  const authentication = command === "connect"
    ? await authenticateConfiguredClients(detected.map(({ platform }) => platform), options, runtime)
    : [];
  const authenticationFailed = authentication.some((item) => item.authentication === "failed");
  return {
    code: authenticationFailed ? EXIT.FAILED : EXIT.OK,
    result: {
      ...baseResult,
      status: authenticationFailed ? "authentication-failed" : configurationStatus,
      configurationStatus,
      applied: applied.applied,
      ...(command === "connect" ? { authentication } : {}),
      ...(command === "disconnect"
        ? { revocation: "Local configuration removed only. Revoke the server-side grant in the Brian dashboard if desired." }
        : {}),
    },
  };
}

export function runConnect(options, runtime) {
  return runMutation("connect", options, runtime);
}

export function runDisconnect(options, runtime) {
  return runMutation("disconnect", options, runtime);
}
