import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';

import {
  ensureBypassPromptSuppressed,
  ensureFolderTrusted,
} from '../../../src/utils/claude-preflight.js';

describe('Claude preflight', () => {
  it('creates both Claude config files when they are absent', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-preflight-'));

    expect(ensureFolderTrusted('/workspace/new-agent', { homeDir })).toBe(true);
    expect(ensureBypassPromptSuppressed({ homeDir })).toBe(true);

    expect(JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8')))
      .toMatchObject({ projects: { '/workspace/new-agent': { hasTrustDialogAccepted: true } } });
    expect(JSON.parse(readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf8')))
      .toMatchObject({ skipDangerousModePermissionPrompt: true });
  });

  it('creates or merges folder trust while preserving unrelated values and is idempotent', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-preflight-'));
    const configPath = join(homeDir, '.claude.json');
    const original = {
      theme: 'dark',
      literal: 'KEEP:  a  b',
      projects: { '/existing': { model: 'sonnet', custom: { enabled: true } } },
    };
    writeFileSync(configPath, JSON.stringify(original, null, 2) + '\n');

    ensureFolderTrusted('/workspace/new-agent', { homeDir });

    const firstWrite = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(firstWrite);
    expect(parsed.theme).toBe(original.theme);
    expect(parsed.literal).toBe(original.literal);
    expect(parsed.projects['/existing']).toEqual(original.projects['/existing']);
    expect(parsed.projects['/workspace/new-agent'].hasTrustDialogAccepted).toBe(true);
    expect(firstWrite).toContain('"literal": "KEEP:  a  b"');

    const noOpWrite = vi.fn();
    ensureFolderTrusted('/workspace/new-agent', { homeDir, write: noOpWrite });
    expect(noOpWrite).not.toHaveBeenCalled();
    expect(readFileSync(configPath, 'utf8')).toBe(firstWrite);
  });

  it('creates or merges bypass suppression while preserving unrelated settings and is idempotent', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-preflight-'));
    const claudeDir = join(homeDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.json');
    const original = { model: 'opus', permissions: { allow: ['Read'] }, literal: 'KEEP:  x  y' };
    writeFileSync(settingsPath, JSON.stringify(original, null, 2) + '\n');

    ensureBypassPromptSuppressed({ homeDir });

    const firstWrite = readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(firstWrite);
    expect(parsed.model).toBe(original.model);
    expect(parsed.permissions).toEqual(original.permissions);
    expect(parsed.literal).toBe(original.literal);
    expect(parsed.skipDangerousModePermissionPrompt).toBe(true);
    expect(firstWrite).toContain('"literal": "KEEP:  x  y"');

    const noOpWrite = vi.fn();
    ensureBypassPromptSuppressed({ homeDir, write: noOpWrite });
    expect(noOpWrite).not.toHaveBeenCalled();
    expect(readFileSync(settingsPath, 'utf8')).toBe(firstWrite);
  });

  it('swallows and logs atomic-write failures for both preflight files', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-preflight-'));
    const log = vi.fn();
    const write = vi.fn(() => { throw new Error('simulated disk failure'); });

    expect(() => ensureFolderTrusted('/workspace/agent', { homeDir, log, write })).not.toThrow();
    expect(() => ensureBypassPromptSuppressed({ homeDir, log, write })).not.toThrow();

    expect(write).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('simulated disk failure');
  });

  it('does not overwrite malformed Claude JSON and reports the parse failure', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-preflight-'));
    const configPath = join(homeDir, '.claude.json');
    writeFileSync(configPath, '{not-json\n');
    const log = vi.fn();

    expect(ensureFolderTrusted('/workspace/agent', { homeDir, log })).toBe(false);

    expect(readFileSync(configPath, 'utf8')).toBe('{not-json\n');
    expect(log).toHaveBeenCalledTimes(1);
  });
});
