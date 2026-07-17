import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('installer Claude unattended-mode consent', () => {
  it('asks once and applies both preflight controls before launching onboarding', () => {
    const source = readFileSync(resolve('install.mjs'), 'utf8');
    const promptIndex = source.indexOf('Enable unattended Bypass Permissions mode? [y/N]');
    const folderIndex = source.indexOf('ensureFolderTrusted(INSTALL_DIR)');
    const bypassIndex = source.indexOf('ensureBypassPromptSuppressed()');
    const launchIndex = source.indexOf("spawn('claude', ['/onboarding']");

    expect(promptIndex).toBeGreaterThan(-1);
    expect(folderIndex).toBeGreaterThan(promptIndex);
    expect(bypassIndex).toBeGreaterThan(folderIndex);
    expect(launchIndex).toBeGreaterThan(bypassIndex);
    expect(source).toContain('--dangerously-skip-permissions');
    expect(source).toContain('dangerously_skip_permissions: false');
  });
});
