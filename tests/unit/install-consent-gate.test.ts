import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  requireConsentGateFile,
  resolveInstallerConsent,
  runConsentCommand,
  runConsentGate,
} from '../../installer/consent-gate.mjs';

describe('installer unattended consent gate', () => {
  it('uses a controlling TTY when installer stdin is piped', async () => {
    const promptTty = vi.fn(async () => true);

    await expect(resolveInstallerConsent({
      envValue: undefined,
      stdinIsTTY: false,
      stdoutIsTTY: true,
      platform: 'darwin',
      promptTty,
      reportDefault: vi.fn(),
    })).resolves.toEqual({ answerYes: true, source: 'interactive-installer' });
    expect(promptTty).toHaveBeenCalledTimes(1);
  });

  it('fails closed with a loud grant notice when no controlling TTY exists', async () => {
    const reportDefault = vi.fn();

    await expect(resolveInstallerConsent({
      envValue: undefined,
      stdinIsTTY: false,
      stdoutIsTTY: false,
      platform: 'linux',
      promptTty: vi.fn(async () => { throw new Error('no tty'); }),
      reportDefault,
    })).resolves.toEqual({ answerYes: false, source: 'non-interactive-default' });
    expect(reportDefault).toHaveBeenCalledWith(expect.stringContaining('--grant'));
  });

  it.each([
    ['1', true, 'scripted-installer-opt-in'],
    ['0', false, 'scripted-installer-opt-out'],
  ])('honors scripted ASCENDOPS_UNATTENDED=%s', async (envValue, answerYes, source) => {
    await expect(resolveInstallerConsent({
      envValue,
      stdinIsTTY: false,
      stdoutIsTTY: false,
      platform: 'linux',
      promptTty: vi.fn(),
      reportDefault: vi.fn(),
    })).resolves.toEqual({ answerYes, source });
  });

  it('grant command records consent and applies Claude preflight', async () => {
    const installDir = mkdtempSync(join(tmpdir(), 'consent-command-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'consent-command-home-'));
    const applyUnattendedConsent = vi.fn(async (answerYes, dir, options) => {
      const actual = await import('../../src/utils/claude-preflight.js');
      return actual.applyUnattendedConsent(answerYes, dir, { ...options, homeDir });
    });

    await expect(runConsentCommand(['--grant'], { installDir, applyUnattendedConsent }))
      .resolves.toBe(true);
    expect(applyUnattendedConsent).toHaveBeenCalledWith(true, installDir, { source: 'consent-command' });
    expect(JSON.parse(readFileSync(join(installDir, '.claude-consent.json'), 'utf8')))
      .toMatchObject({ unattended_bypass: true, source: 'consent-command' });
    expect(JSON.parse(readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf8')))
      .toMatchObject({ skipDangerousModePermissionPrompt: true });
  });

  it('revoke command records a genuine opt-out without applying Claude preflight', async () => {
    const installDir = mkdtempSync(join(tmpdir(), 'consent-command-'));
    const applyUnattendedConsent = vi.fn(async () => true);

    await expect(runConsentCommand(['--revoke'], { installDir, applyUnattendedConsent }))
      .resolves.toBe(true);
    expect(applyUnattendedConsent).toHaveBeenCalledWith(false, installDir, { source: 'consent-command' });
  });

  it('stops before install work when the required consent gate is absent', () => {
    const installDir = mkdtempSync(join(tmpdir(), 'old-checkout-'));
    const installDependencies = vi.fn();

    expect(() => {
      requireConsentGateFile(installDir);
      installDependencies();
    }).toThrow(/consent-gate\.mjs/);
    expect(installDependencies).not.toHaveBeenCalled();
  });

  it('aborts a stale checkout before npm install when pull fails and the gate is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'stale-installer-'));
    const installDir = join(root, 'checkout');
    const fakeBin = join(root, 'bin');
    const npmMarker = join(root, 'npm-install-ran');
    mkdirSync(join(installDir, '.git'), { recursive: true });
    mkdirSync(fakeBin);

    const fake = (name, body) => {
      const file = join(fakeBin, name);
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
    };
    fake('node', 'echo v22.0.0');
    fake('npm', `if [ "$1" = "--version" ]; then echo 10.0.0; else touch ${JSON.stringify(npmMarker)}; fi`);
    fake('git', 'case "$1 $2 $3" in "--version  ") echo "git version 2.50.0";; "remote get-url upstream") echo upstream;; "pull upstream main") exit 1;; *) exit 0;; esac');
    fake('xcode-select', 'echo /Library/Developer/CommandLineTools');
    fake('python3', 'echo Python 3.12.0');
    fake('claude', 'if [ "$1 $2" = "auth status" ]; then echo "{\\"loggedIn\\":true}"; else echo 2.1.212; fi');
    fake('jq', 'echo jq-1.7');
    fake('rtk', 'echo rtk-1');
    fake('icm', 'echo icm-1');
    fake('brew', 'exit 0');

    const installerPath = process.env.ASCENDOPS_INSTALLER_UNDER_TEST ?? join(process.cwd(), 'install.mjs');
    const result = spawnSync(process.execPath, [installerPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ASCENDOPS_DIR: installDir,
        HOME: root,
        PATH: `${fakeBin}:/usr/bin:/bin`,
      },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Required installer file is missing');
    expect(existsSync(npmMarker)).toBe(false);
  });

  it.each([
    ['No', false, 'preflight import failure', vi.fn(async () => { throw new Error('missing bundle'); })],
    ['Yes', true, 'preflight import failure', vi.fn(async () => { throw new Error('missing bundle'); })],
    ['No', false, 'consent apply failure', vi.fn(async () => ({ applyUnattendedConsent: () => false }))],
    ['Yes', true, 'consent apply failure', vi.fn(async () => ({ applyUnattendedConsent: () => false }))],
  ])('exits before onboarding when %s encounters %s', async (_choice, answerYes, _label, importPreflight) => {
    const spawnOnboarding = vi.fn();
    const exit = vi.fn();
    const reportFailure = vi.fn();

    await runConsentGate({
      answerYes,
      installDir: '/tmp/ascendops',
      source: 'test',
      importPreflight,
      spawnOnboarding,
      exit,
      reportFailure,
    });

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(spawnOnboarding).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('launches onboarding only after persisting %s', async (answerYes) => {
    const spawnOnboarding = vi.fn();
    const exit = vi.fn();

    await runConsentGate({
      answerYes,
      installDir: '/tmp/ascendops',
      source: 'test',
      importPreflight: vi.fn(async () => ({ applyUnattendedConsent: () => true })),
      spawnOnboarding,
      exit,
      reportFailure: vi.fn(),
    });

    expect(exit).not.toHaveBeenCalled();
    expect(spawnOnboarding).toHaveBeenCalledTimes(1);
  });
});
