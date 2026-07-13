import { AGENT_CONTRACT, MARKER_CLOSE, MARKER_OPEN } from "../constants.mjs";
import { makeChange, readFileState } from "./files.mjs";

const BLOCK_PATTERN = /^# >>> brian >>>\r?\n[\s\S]*?^# <<< brian <<<[ \t]*(?:\r?\n|$)/gm;

function markerBlock(body = AGENT_CONTRACT) {
  return `${MARKER_OPEN}\n${body}\n${MARKER_CLOSE}\n`;
}

export function inspectMarkerFile(file) {
  const source = readFileState(file);
  if (source.status === "missing") return { file, source, state: "missing" };
  if (source.status !== "ok") {
    return { file, source, state: "invalid", error: `cannot safely read ${source.status} instruction file` };
  }
  const matches = [...source.text.matchAll(BLOCK_PATTERN)];
  if (matches.length > 1) {
    return { file, source, state: "duplicate", error: "multiple Brian instruction blocks found" };
  }
  if (matches.length === 0) return { file, source, state: "missing" };
  return {
    file,
    source,
    state: matches[0][0].trimEnd() === markerBlock().trimEnd() ? "connected" : "outdated",
    match: matches[0],
  };
}

export function planMarkerConnect(file) {
  const inspection = inspectMarkerFile(file);
  if (inspection.error) return { inspection, changes: [], errors: [inspection.error] };
  if (inspection.state === "connected") return { inspection, changes: [], errors: [] };

  let nextText;
  if (inspection.match) {
    const start = inspection.match.index;
    nextText = `${inspection.source.text.slice(0, start)}${markerBlock()}${inspection.source.text.slice(start + inspection.match[0].length)}`;
  } else {
    const text = inspection.source.text;
    const separator = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    nextText = `${text}${separator}${markerBlock()}`;
  }
  const change = makeChange(inspection.source, nextText, "install Brian instruction block", "instructions");
  return { inspection, changes: change ? [change] : [], errors: [] };
}

export function planMarkerDisconnect(file) {
  const inspection = inspectMarkerFile(file);
  if (inspection.error) return { inspection, changes: [], errors: [inspection.error] };
  if (!inspection.match) return { inspection, changes: [], errors: [] };

  const start = inspection.match.index;
  let before = inspection.source.text.slice(0, start);
  let after = inspection.source.text.slice(start + inspection.match[0].length);
  if (before.endsWith("\n\n")) before = before.slice(0, -1);
  if (before === "" && after.startsWith("\n")) after = after.slice(1);
  const nextText = `${before}${after}`;
  const change = makeChange(inspection.source, nextText, "remove only the Brian instruction block", "instructions");
  return { inspection, changes: change ? [change] : [], errors: [] };
}
