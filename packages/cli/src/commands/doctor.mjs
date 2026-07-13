import { CANONICAL_MCP_URL, EXIT } from "../constants.mjs";
import { saveLastHealth } from "../config/health.mjs";
import { runNetworkDoctor } from "../doctor/network.mjs";
import { selectedPlatforms } from "../platforms/index.mjs";

function clientChecks(client) {
  const checks = [];
  const config = client.config;
  const configured = config.brianState === "connected";
  checks.push({
    name: `${client.name}:configuration`,
    status: configured ? "pass" : "fail",
    detail: configured ? "canonical OAuth MCP URL configured" : `configuration state is ${config.brianState}`,
    file: config.file,
  });
  if (config.staticCredential) {
    checks.push({
      name: `${client.name}:static-credential`,
      status: "fail",
      detail: "legacy static credential detected; value was not printed",
      file: config.file,
    });
  }
  if (config.legacyEndpoint) {
    checks.push({
      name: `${client.name}:legacy-endpoint`,
      status: "fail",
      detail: "raw Supabase endpoint detected; run brian connect",
      file: config.file,
    });
  }
  if (client.instructions.state === "missing") {
    checks.push({
      name: `${client.name}:instructions`,
      status: "warn",
      detail: "Brian instruction block is not installed",
      file: client.instructions.file,
    });
  }
  if (client.oauthCapability.includes("unverified")) {
    checks.push({
      name: `${client.name}:oauth-compatibility`,
      status: "warn",
      detail: "this client/version still requires a dated Brian staging OAuth result",
    });
  }
  return checks;
}

export async function runDoctor(options, runtime) {
  const network = await runNetworkDoctor({
    fetchFn: runtime.fetch,
    resourceUrl: options.resourceUrl ?? CANONICAL_MCP_URL,
    timeoutMs: options.timeoutMs ?? 5000,
    allowHttp: Boolean(options.allowHttp),
  });
  const clients = selectedPlatforms(options.only).map((platform) => platform.inspect(runtime));
  const detected = clients.filter((client) => client.detected);
  const checks = [...network, ...detected.flatMap(clientChecks)];
  const failed = checks.some((item) => item.status === "fail");
  const code = failed ? EXIT.FAILED : detected.length ? EXIT.OK : EXIT.NO_CLIENTS;
  const status = failed ? "issues-found" : detected.length ? "healthy" : "no-clients";
  saveLastHealth(runtime, {
    status,
    resource: options.resourceUrl ?? CANONICAL_MCP_URL,
  });
  return {
    code,
    result: {
      command: "doctor",
      status,
      canonicalMcpUrl: CANONICAL_MCP_URL,
      checks,
      clients,
    },
  };
}
