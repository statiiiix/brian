import {
  constants as fsConstants,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { accessSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

export function timestamp(date = new Date()) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-` +
    `${pad(date.getMilliseconds(), 3)}`
  );
}

export function readFileState(file) {
  if (!existsSync(file)) return { status: "missing", file, text: "", exists: false };

  let info;
  try {
    info = lstatSync(file);
  } catch {
    return { status: "unreadable", file, exists: true };
  }
  if (info.isSymbolicLink()) return { status: "symlink", file, exists: true };
  if (!info.isFile()) return { status: "not-file", file, exists: true };

  try {
    return {
      status: "ok",
      file,
      text: readFileSync(file, "utf8"),
      exists: true,
      mode: info.mode,
      writable: (info.mode & 0o222) !== 0,
    };
  } catch {
    return { status: "unreadable", file, exists: true };
  }
}

function closestExistingDirectory(file) {
  let current = path.dirname(file);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

export function validateChange(change) {
  const current = readFileState(change.file);
  if (current.status !== "ok" && current.status !== "missing") {
    return { ok: false, file: change.file, reason: `refusing ${current.status} path` };
  }
  if (current.exists && current.writable === false) {
    return { ok: false, file: change.file, reason: "refusing read-only file" };
  }
  if (current.exists !== change.originalExists || current.text !== change.originalText) {
    return { ok: false, file: change.file, reason: "file changed after it was inspected" };
  }
  if (!current.exists) {
    const parent = closestExistingDirectory(change.file);
    if (!parent) return { ok: false, file: change.file, reason: "no writable parent directory" };
    try {
      accessSync(parent, fsConstants.W_OK);
    } catch {
      return { ok: false, file: change.file, reason: "parent directory is not writable" };
    }
  }
  return { ok: true };
}

export function preflightChanges(changes) {
  return changes.map(validateChange).filter((result) => !result.ok);
}

export function backupFile(file, { now = () => new Date() } = {}) {
  if (!existsSync(file)) return null;
  const base = `${file}.bak-brian-${timestamp(now())}`;
  let backup = base;
  let counter = 1;
  while (existsSync(backup)) backup = `${base}-${counter++}`;
  copyFileSync(file, backup, fsConstants.COPYFILE_EXCL);
  // Legacy Brian entries may contain bearer credentials. Never duplicate one
  // into a group/world-readable backup even when the source mode was loose.
  chmodSync(backup, 0o600);
  return backup;
}

function atomicWrite(file, content, mode) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.brian-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: mode ?? 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

export function applyChanges(changes, { now = () => new Date(), backup = true } = {}) {
  const preflight = preflightChanges(changes);
  if (preflight.length) return { applied: [], errors: preflight };

  const applied = [];
  for (const change of changes) {
    try {
      const backupPath = backup && change.originalExists ? backupFile(change.file, { now }) : null;
      const mode = change.mode ?? (change.originalExists ? statSync(change.file).mode : 0o600);
      atomicWrite(change.file, change.nextText, mode);
      applied.push({ file: change.file, action: change.action, backup: backupPath });
    } catch {
      return {
        applied,
        errors: [{ file: change.file, reason: "write failed; inspect permissions and retry" }],
      };
    }
  }
  return { applied, errors: [] };
}

export function makeChange(fileState, nextText, action, kind = "config") {
  if (fileState.text === nextText) return null;
  return {
    file: fileState.file,
    originalExists: fileState.exists,
    originalText: fileState.text,
    nextText,
    action,
    kind,
  };
}
