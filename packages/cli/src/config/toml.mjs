import { CANONICAL_MCP_URL } from "../constants.mjs";
import { makeChange, readFileState } from "./files.mjs";

const DESIRED_SECTION = `[mcp_servers.brian]\nurl = "${CANONICAL_MCP_URL}"\noauth_resource = "${CANONICAL_MCP_URL}"\n`;

function stripCommentAndValidateStrings(line) {
  let quote = null;
  let escaped = false;
  let output = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const triple = line.slice(index, index + 3);
    if (!quote && (triple === '\"\"\"' || triple === "'''")) {
      return { error: "multiline TOML strings are unsupported for safe editing" };
    }
    if (quote === '"') {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      output += char;
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }
    if (char === "#") break;
    output += char;
  }
  if (quote) return { error: "unterminated TOML string" };
  return { code: output.trim() };
}

function parseDottedKey(raw) {
  const parts = [];
  let index = 0;
  while (index < raw.length) {
    while (/\s/.test(raw[index] ?? "")) index++;
    if (index >= raw.length) break;
    let part = "";
    if (raw[index] === '"' || raw[index] === "'") {
      const quote = raw[index++];
      let escaped = false;
      let closed = false;
      while (index < raw.length) {
        const char = raw[index++];
        if (quote === '"' && escaped) {
          part += char;
          escaped = false;
        } else if (quote === '"' && char === "\\") {
          escaped = true;
        } else if (char === quote) {
          closed = true;
          break;
        } else {
          part += char;
        }
      }
      if (!closed) return null;
    } else {
      const match = raw.slice(index).match(/^[A-Za-z0-9_-]+/);
      if (!match) return null;
      part = match[0];
      index += part.length;
    }
    parts.push(part);
    while (/\s/.test(raw[index] ?? "")) index++;
    if (index >= raw.length) break;
    if (raw[index] !== ".") return null;
    index++;
  }
  return parts.length ? parts : null;
}

function headerFromCode(code) {
  const array = code.startsWith("[[");
  const opener = array ? "[[" : "[";
  const closer = array ? "]]" : "]";
  if (!code.startsWith(opener) || !code.endsWith(closer)) return null;
  const inner = code.slice(opener.length, -closer.length).trim();
  const parts = parseDottedKey(inner);
  return parts ? { array, parts, key: parts.join(".") } : null;
}

function updateNesting(code, nesting) {
  let quote = null;
  let escaped = false;
  for (const char of code) {
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") nesting.square++;
    else if (char === "]") nesting.square--;
    else if (char === "{") nesting.curly++;
    else if (char === "}") nesting.curly--;
    if (nesting.square < 0 || nesting.curly < 0) return false;
  }
  return true;
}

function lineRecords(text) {
  const records = [];
  let offset = 0;
  for (const raw of text.match(/.*(?:\n|$)/g) ?? []) {
    if (raw === "" && offset === text.length) break;
    records.push({ raw, start: offset, end: offset + raw.length });
    offset += raw.length;
  }
  return records;
}

export function scanToml(text) {
  const records = lineRecords(text);
  const headers = [];
  const nesting = { square: 0, curly: 0 };

  for (const record of records) {
    const stripped = stripCommentAndValidateStrings(record.raw.replace(/\r?\n$/, ""));
    if (stripped.error) return { error: stripped.error };
    const code = stripped.code;
    if (!code) continue;

    if (nesting.square === 0 && nesting.curly === 0 && code.startsWith("[")) {
      const header = headerFromCode(code);
      if (!header) return { error: "malformed TOML table header" };
      headers.push({ ...header, start: record.start, headerEnd: record.end });
      continue;
    }

    if (nesting.square === 0 && nesting.curly === 0 && !code.includes("=")) {
      return { error: "malformed TOML assignment" };
    }
    const valueCode = nesting.square === 0 && nesting.curly === 0 ? code.slice(code.indexOf("=") + 1) : code;
    if (!updateNesting(valueCode, nesting)) return { error: "unbalanced TOML brackets" };
  }

  if (nesting.square !== 0 || nesting.curly !== 0) return { error: "unbalanced TOML brackets" };
  const sections = headers.map((header, index) => ({
    ...header,
    end: headers[index + 1]?.start ?? text.length,
    raw: text.slice(header.start, headers[index + 1]?.start ?? text.length),
  }));
  return { headers, sections, preamble: text.slice(0, headers[0]?.start ?? text.length) };
}

function isBrianSection(section) {
  return section.parts[0] === "mcp_servers" && section.parts[1] === "brian";
}

function isToolSection(section) {
  return isBrianSection(section) && section.parts[2] === "tools";
}

function appendSection(text, section) {
  const separator = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${separator}${section}`;
}

function transformedConnectText(text, scan) {
  let output = scan.preamble;
  let inserted = false;
  for (const section of scan.sections) {
    if (isBrianSection(section) && !isToolSection(section)) {
      if (!inserted) {
        output = appendSection(output, DESIRED_SECTION);
        inserted = true;
      }
      continue;
    }
    if (isToolSection(section) && !inserted) {
      output = appendSection(output, DESIRED_SECTION);
      inserted = true;
    }
    output += section.raw;
  }
  if (!inserted) output = appendSection(output, DESIRED_SECTION);
  return output;
}

function transformedDisconnectText(scan) {
  let output = scan.preamble;
  for (const section of scan.sections) {
    if (!isBrianSection(section)) output += section.raw;
  }
  return output;
}

export function inspectTomlConfig(file) {
  const source = readFileState(file);
  if (source.status === "missing") {
    return {
      file,
      source,
      scan: { headers: [], sections: [], preamble: "" },
      configState: "missing",
      brianState: "missing",
      warnings: [],
      staticCredential: false,
      legacyEndpoint: false,
      nextText: DESIRED_SECTION,
    };
  }
  if (source.status !== "ok") {
    return {
      file,
      source,
      configState: source.status,
      brianState: "invalid",
      warnings: [],
      error: `cannot safely read ${source.status} configuration`,
    };
  }
  const scan = scanToml(source.text);
  if (scan.error) {
    return {
      file,
      source,
      configState: "malformed",
      brianState: "invalid",
      warnings: [],
      error: `${scan.error}; file was not modified`,
    };
  }

  const brianSections = scan.sections.filter(isBrianSection);
  const parentSections = brianSections.filter((section) => section.parts.length === 2);
  if (parentSections.length > 1) {
    return {
      file,
      source,
      scan,
      configState: "duplicate",
      brianState: "invalid",
      warnings: [],
      error: "multiple [mcp_servers.brian] sections found",
    };
  }

  const brianText = brianSections.map((section) => section.raw).join("\n");
  const staticCredential = /authorization|bearer|api[_-]?(?:token|key)|access[_-]?token|refresh[_-]?token|client[_-]?secret|token[_-]?env[_-]?var|http_headers?/i.test(brianText);
  const legacyEndpoint = /\.supabase\.co\/functions\/v1\/brian(?:\/|\b)/i.test(brianText);
  const nextText = transformedConnectText(source.text, scan);
  const exact = nextText === source.text;
  const warnings = [];
  if (legacyEndpoint) warnings.push("legacy raw Supabase Brian endpoint detected");
  if (staticCredential) warnings.push("legacy static credential reference detected; its value will never be printed");

  let brianState = "noncanonical";
  if (brianSections.length === 0) brianState = "missing";
  else if (exact) brianState = "connected";
  else if (legacyEndpoint || staticCredential) brianState = "legacy";
  else if (/^\s*command\s*=/m.test(brianText)) brianState = "local";
  else if (brianText.includes(CANONICAL_MCP_URL)) brianState = "needs-cleanup";

  return {
    file,
    source,
    scan,
    configState: "valid",
    brianState,
    warnings,
    staticCredential,
    legacyEndpoint,
    nextText,
  };
}

export function planTomlConnect(file) {
  const inspection = inspectTomlConfig(file);
  if (inspection.error) return { inspection, changes: [], errors: [inspection.error] };
  const change = makeChange(
    inspection.source,
    inspection.nextText,
    inspection.brianState === "missing" ? "add Brian OAuth MCP section" : "replace Brian section with canonical OAuth MCP URL",
    "toml",
  );
  return { inspection, changes: change ? [change] : [], errors: [] };
}

export function planTomlDisconnect(file) {
  const inspection = inspectTomlConfig(file);
  if (inspection.error && inspection.configState !== "duplicate") {
    return { inspection, changes: [], errors: [inspection.error] };
  }
  const scan = inspection.scan;
  if (!scan) return { inspection, changes: [], errors: [inspection.error] };
  const nextText = transformedDisconnectText(scan);
  const change = makeChange(inspection.source, nextText, "remove only Brian MCP TOML sections", "toml");
  return { inspection, changes: change ? [change] : [], errors: [] };
}

export function safeTomlInspection(inspection) {
  return {
    file: inspection.file,
    configState: inspection.configState,
    brianState: inspection.brianState,
    staticCredential: Boolean(inspection.staticCredential),
    legacyEndpoint: Boolean(inspection.legacyEndpoint),
    warnings: [...(inspection.warnings ?? [])],
    ...(inspection.error ? { error: inspection.error } : {}),
  };
}

export { DESIRED_SECTION };
