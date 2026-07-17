import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('AgentPTY subclass spawn funnel', () => {
  it('requires every AgentPTY subclass spawn override to call super.spawn', () => {
    const sourceRoot = join(process.cwd(), 'src', 'pty');
    const files = ['hermes-pty.ts', 'opencode-pty.ts'];

    for (const file of files) {
      const source = readFileSync(join(sourceRoot, file), 'utf8');
      expect(source, `${file} must extend AgentPTY`).toMatch(/class\s+\w+\s+extends\s+AgentPTY/);
      const spawnOverride = source.match(/async\s+spawn\s*\([^]*?\n\s*}\n/);
      expect(spawnOverride, `${file} must expose its spawn override to the census`).not.toBeNull();
      expect(spawnOverride?.[0], `${file} must funnel spawn through AgentPTY`).toContain('super.spawn(');
    }
  });
});
