declare module "*.mjs" {
  export interface ScriptEnv {
    home: string;
    platform: string;
    serverPath: string;
    [key: string]: string | undefined;
  }

  export interface OnboardOptions {
    serverPath: string;
    url?: string;
    token?: string;
  }

  export interface OnboardPlan {
    file: string;
    action: string;
    layer?: string;
    description?: string;
  }

  export interface OnboardStatus {
    mcp: string;
    alwaysOn: string;
  }

  export interface OnboardDetection {
    detected: boolean;
    evidence: string;
  }

  export interface OnboardApplyResult {
    applied: Array<{ file: string; action: string }>;
    skipped: Array<{ file: string; reason: string }>;
  }

  export const name: string;
  export const label: string;
  export function detect(env: ScriptEnv): OnboardDetection;
  export function status(env: ScriptEnv): OnboardStatus;
  export function plan(env: ScriptEnv, opts: OnboardOptions): OnboardPlan[];
  export function apply(env: ScriptEnv, opts: OnboardOptions): Promise<OnboardApplyResult>;

  export function readJsonFile(file: string): { ok: boolean; reason?: string; value?: unknown };
  export function deepMerge(base: unknown, patch: unknown): unknown;
  export function backupFile(file: string): string | null;
  export function writeJsonFile(file: string, value: unknown, opts?: { backup?: boolean }): void;
  export function readText(file: string): string | null;
  export function writeTextFile(file: string, content: string, opts?: { backup?: boolean }): void;
  export function hasMarkerBlock(text: string): boolean;
  export function upsertMarkerBlock(text: string, body: string): { text: string; changed: boolean };
  export function mcpEntry(opts?: { serverPath?: string; url?: string; token?: string }): unknown;
  export const CONTRACT: string;
  export function tomlHasSection(text: string, section: string): boolean;
  export function appendTomlSection(text: string, sectionText: string): string;
  export function mergeMcpServer(file: string, entry: unknown): { status: string };
  export function wireMarkerFile(file: string, body: string): { status: string };

  export const hookScript: string;
  export const hookCommand: string;
  export function installBrianHooks(opts: { settingsPath: string }): { changed: boolean };
}
