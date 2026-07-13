import { claudeCode } from "./claudeCode.mjs";
import { claudeDesktop } from "./claudeDesktop.mjs";
import { cursor } from "./cursor.mjs";
import { codex } from "./codex.mjs";

export const platforms = Object.freeze([claudeCode, claudeDesktop, cursor, codex]);

export function selectedPlatforms(only = null) {
  if (!only) return [...platforms];
  const selected = new Set(only);
  return platforms.filter((platform) => selected.has(platform.name));
}
