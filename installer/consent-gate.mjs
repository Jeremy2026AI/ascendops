import { createReadStream, createWriteStream, existsSync, openSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createInterface } from 'readline/promises';

const CONSENT_GATE_RELATIVE_PATH = join('installer', 'consent-gate.mjs');

async function promptStream(input, output) {
  const readline = createInterface({ input, output, terminal: true });
  try {
    const answer = await readline.question('Enable unattended Bypass Permissions mode? [y/N] ');
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function promptControllingTty() {
  const fd = openSync('/dev/tty', 'r+');
  const input = createReadStream(null, { fd, autoClose: false });
  const output = createWriteStream(null, { fd, autoClose: true });
  return promptStream(input, output);
}

export async function resolveInstallerConsent({
  envValue,
  stdinIsTTY,
  stdoutIsTTY,
  platform,
  promptStdio = () => promptStream(process.stdin, process.stdout),
  promptTty = promptControllingTty,
  reportDefault = console.warn,
  grantCommand = 'node installer/consent-gate.mjs --grant',
}) {
  if (envValue === '1') return { answerYes: true, source: 'scripted-installer-opt-in' };
  if (envValue === '0') return { answerYes: false, source: 'scripted-installer-opt-out' };

  if (stdinIsTTY && stdoutIsTTY) {
    return { answerYes: await promptStdio(), source: 'interactive-installer' };
  }
  if (platform !== 'win32') {
    try {
      return { answerYes: await promptTty(), source: 'interactive-installer' };
    } catch {
      // A genuinely headless process has no controlling terminal.
    }
  }

  reportDefault(`No interactive terminal was available. Unattended mode remains disabled. To grant consent later, run: ${grantCommand}`);
  return { answerYes: false, source: 'non-interactive-default' };
}

export function requireConsentGateFile(installDir) {
  const filePath = join(installDir, CONSENT_GATE_RELATIVE_PATH);
  if (!existsSync(filePath)) {
    throw new Error(`Required installer file missing: ${filePath}`);
  }
  return filePath;
}

export async function runConsentCommand(args, { installDir, applyUnattendedConsent }) {
  const command = args.includes('--grant') ? true : args.includes('--revoke') ? false : undefined;
  if (command === undefined) throw new Error('Expected --grant or --revoke');
  const applied = await applyUnattendedConsent(command, installDir, { source: 'consent-command' });
  if (!applied) throw new Error(`Failed to ${command ? 'grant' : 'revoke'} unattended consent`);
  return true;
}

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
      exit(1);
      return false;
    }
  } catch (error) {
    reportFailure(`FAILED to persist unattended-mode consent: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
    return false;
  }

  await spawnOnboarding();
  return true;
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  const installDir = dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    const imported = await import(pathToFileURL(join(installDir, 'dist', 'claude-preflight.js')).href);
    const preflight = imported.default ?? imported;
    await runConsentCommand(process.argv.slice(2), {
      installDir,
      applyUnattendedConsent: preflight.applyUnattendedConsent,
    });
    console.log(`Unattended mode ${process.argv.includes('--grant') ? 'granted' : 'revoked'}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
