export async function runConsentGate({
  answerYes,
  installDir,
  source,
  importPreflight,
  spawnOnboarding,
  exit,
  reportFailure,
}) {
  try {
    const imported = await importPreflight();
    const preflight = imported.default ?? imported;
    const applied = preflight.applyUnattendedConsent(answerYes, installDir, { source });
    if (!applied) {
      reportFailure(`FAILED to persist unattended-mode consent (${answerYes ? 'Yes' : 'No'}).`);
    }
  } catch (error) {
    reportFailure(`FAILED to persist unattended-mode consent: ${error instanceof Error ? error.message : String(error)}`);
  }

  await spawnOnboarding();
  return true;
}
