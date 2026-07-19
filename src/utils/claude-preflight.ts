import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { atomicWriteSync } from './atomic.js';

type JsonObject = Record<string, unknown>;
type AtomicWriter = (filePath: string, data: string) => void;

export interface ClaudePreflightOptions {
  homeDir?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
  write?: AtomicWriter;
  exists?: (filePath: string) => boolean;
  read?: (filePath: string) => string;
  source?: string;
  now?: () => Date;
}

export const CLAUDE_CONSENT_FILENAME = '.claude-consent.json';

export function unattendedConsentPath(installDir: string): string {
  return join(installDir, CLAUDE_CONSENT_FILENAME);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readObject(filePath: string): JsonObject {
  if (!existsSync(filePath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!isObject(parsed)) throw new Error(`${filePath} does not contain a JSON object`);
  return parsed;
}

function reportFailure(
  action: string,
  error: unknown,
  log: (message: string) => void,
): false {
  const detail = error instanceof Error ? error.message : String(error);
  log(`[claude-preflight] ${action} failed; spawn will continue: ${detail}`);
  return false;
}

export function ensureFolderTrusted(
  dir: string,
  options: ClaudePreflightOptions = {},
): boolean {
  const homeDir = options.homeDir ?? homedir();
  const log = options.log ?? console.warn;
  const write = options.write ?? atomicWriteSync;
  const filePath = join(homeDir, '.claude.json');

  try {
    const root = readObject(filePath);
    if (root.projects !== undefined && !isObject(root.projects)) {
      throw new Error(`${filePath} projects field is not a JSON object`);
    }
    const projects = (root.projects ?? {}) as JsonObject;
    if (projects[dir] !== undefined && !isObject(projects[dir])) {
      throw new Error(`${filePath} project entry for ${dir} is not a JSON object`);
    }
    const project = (projects[dir] ?? {}) as JsonObject;
    if (project.hasTrustDialogAccepted === true) return true;

    project.hasTrustDialogAccepted = true;
    projects[dir] = project;
    root.projects = projects;
    write(filePath, JSON.stringify(root, null, 2));
    return true;
  } catch (error) {
    return reportFailure(`folder trust update for ${dir}`, error, log);
  }
}

export function ensureBypassPromptSuppressed(
  options: ClaudePreflightOptions = {},
): boolean {
  const homeDir = options.homeDir ?? homedir();
  const log = options.log ?? console.warn;
  const write = options.write ?? atomicWriteSync;
  const filePath = join(homeDir, '.claude', 'settings.json');

  try {
    const settings = readObject(filePath);
    if (settings.skipDangerousModePermissionPrompt === true) return true;

    settings.skipDangerousModePermissionPrompt = true;
    write(filePath, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    return reportFailure('bypass prompt suppression update', error, log);
  }
}

export function recordUnattendedConsent(
  installDir: string,
  unattended: boolean,
  options: ClaudePreflightOptions = {},
): boolean {
  const log = options.log ?? console.warn;
  const write = options.write ?? atomicWriteSync;
  const filePath = unattendedConsentPath(installDir);
  try {
    write(filePath, JSON.stringify({
      unattended_bypass: unattended,
      decided_at: (options.now ?? (() => new Date()))().toISOString(),
      source: options.source ?? 'installer',
    }, null, 2));
    return true;
  } catch (error) {
    return reportFailure('unattended consent record update', error, log);
  }
}

export function readUnattendedConsent(
  installDir: string,
  options: Pick<ClaudePreflightOptions, 'log' | 'error' | 'exists' | 'read'> = {},
): boolean | undefined {
  const log = options.log ?? console.warn;
  const errorLog = options.error ?? console.error;
  const exists = options.exists ?? existsSync;
  const read = options.read ?? ((filePath: string) => readFileSync(filePath, 'utf8'));
  const filePath = unattendedConsentPath(installDir);
  try {
    if (!exists(filePath)) {
      log(`[claude-preflight] unattended consent record missing at ${filePath}; using legacy default`);
      return undefined;
    }
    const parsed: unknown = JSON.parse(read(filePath));
    if (!isObject(parsed)) {
      throw new Error(`${filePath} does not contain a JSON object`);
    }
    if (typeof parsed.unattended_bypass !== 'boolean') {
      throw new Error(`${filePath} unattended_bypass must be true or false`);
    }
    return parsed.unattended_bypass;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errorLog(`[claude-preflight] lost consent at ${filePath}; failing closed: ${detail}`);
    return false;
  }
}

export function applyUnattendedConsent(
  answerYes: boolean,
  installDir: string,
  options: ClaudePreflightOptions = {},
): boolean {
  const recorded = recordUnattendedConsent(installDir, answerYes, options);
  if (!answerYes) return recorded;

  const folderReady = ensureFolderTrusted(installDir, options);
  const bypassReady = ensureBypassPromptSuppressed(options);
  return recorded && folderReady && bypassReady;
}
