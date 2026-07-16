import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const contributing = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8');
const pullRequestTemplate = readFileSync(
  join(root, '.github/PULL_REQUEST_TEMPLATE.md'),
  'utf8',
);

describe('member contribution intake contract', () => {
  it('branches new work from the fetched public upstream main', () => {
    expect(contributing).toContain(
      'git checkout -b feat/skill-<your-skill-name> upstream/main',
    );
    expect(contributing).not.toMatch(
      /^git checkout -b feat\/skill-<your-skill-name>$/m,
    );
  });

  it('allows declared public integration domains while blocking private identifiers', () => {
    expect(contributing).toContain(
      'Array of strings listing every external API, service, or URL the skill contacts.',
    );
    for (const document of [contributing, pullRequestTemplate]) {
      expect(document).toMatch(/public integration domains/i);
      expect(document).toMatch(/private or organization-specific names, domains/);
      expect(document).not.toMatch(/No organization names, domains/);
    }
  });
});
