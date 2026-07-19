import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CtxEnv } from '../../../src/types/index.js';
import { unattendedConsentPath } from '../../../src/utils/claude-preflight.js';

const preflightMocks = vi.hoisted(() => ({
  ensureFolderTrusted: vi.fn(() => true),
  ensureBypassPromptSuppressed: vi.fn(() => true),
}));

vi.mock('../../../src/utils/claude-preflight.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/utils/claude-preflight.js')>(
    '../../../src/utils/claude-preflight.js',
  );
  return { ...actual, ...preflightMocks };
});

const { AgentPTY } = await import('../../../src/pty/agent-pty.js');

describe('AgentPTY corrupt unattended consent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails closed across args, preflight, and bypass matching', async () => {
    const frameworkRoot = mkdtempSync(join(tmpdir(), 'agent-consent-'));
    writeFileSync(unattendedConsentPath(frameworkRoot), '{broken');
    const env: CtxEnv = {
      instanceId: 'test',
      ctxRoot: join(frameworkRoot, '.ctx'),
      frameworkRoot,
      agentName: 'agent-test',
      agentDir: frameworkRoot,
      org: 'testorg',
      projectRoot: frameworkRoot,
    };
    let onData: ((data: string) => void) | undefined;
    let capturedArgs: string[] = [];
    const fakePty = {
      pid: 123,
      write: vi.fn(),
      onData: vi.fn((callback: (data: string) => void) => {
        onData = callback;
        return { dispose: () => undefined };
      }),
      onExit: vi.fn(() => ({ dispose: () => undefined })),
      kill: vi.fn(),
      resize: vi.fn(),
    };
    const pty = new AgentPTY(env, { vendor: 'anthropic' });
    (pty as unknown as { spawnFn: unknown }).spawnFn = vi.fn((_file: string, args: string[]) => {
      capturedArgs = args;
      return fakePty;
    });

    await pty.spawn('fresh', 'hello');
    onData?.(
      'Claude Code is running in Bypass Permissions mode.\n' +
      '  1. No, exit\n' +
      '  2. Yes, I accept\n',
    );
    vi.advanceTimersByTime(32000);

    expect(capturedArgs).not.toContain('--dangerously-skip-permissions');
    expect(preflightMocks.ensureBypassPromptSuppressed).not.toHaveBeenCalled();
    expect(fakePty.write).not.toHaveBeenCalledWith('\x1b[B\r');
  });

  it('keeps the legacy flag and logs the resolved path when no record exists', async () => {
    const frameworkRoot = mkdtempSync(join(tmpdir(), 'agent-consent-'));
    const env: CtxEnv = {
      instanceId: 'test',
      ctxRoot: join(frameworkRoot, '.ctx'),
      frameworkRoot,
      agentName: 'agent-test',
      agentDir: frameworkRoot,
      org: 'testorg',
      projectRoot: frameworkRoot,
    };
    let capturedArgs: string[] = [];
    const fakePty = {
      pid: 123,
      write: vi.fn(),
      onData: vi.fn(() => ({ dispose: () => undefined })),
      onExit: vi.fn(() => ({ dispose: () => undefined })),
      kill: vi.fn(),
      resize: vi.fn(),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pty = new AgentPTY(env, { vendor: 'anthropic' });
    (pty as unknown as { spawnFn: unknown }).spawnFn = vi.fn((_file: string, args: string[]) => {
      capturedArgs = args;
      return fakePty;
    });

    await pty.spawn('fresh', 'hello');

    expect(capturedArgs).toContain('--dangerously-skip-permissions');
    expect(preflightMocks.ensureBypassPromptSuppressed).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(unattendedConsentPath(frameworkRoot)),
    );
    warn.mockRestore();
  });
});
