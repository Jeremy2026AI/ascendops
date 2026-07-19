import { describe, expect, it, vi } from 'vitest';
import { runConsentGate } from '../../installer/consent-gate.mjs';

describe('installer unattended consent gate', () => {
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
