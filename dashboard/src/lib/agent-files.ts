// Agent Files — read-only browser for an agent's bootstrap files, knowledge/,
// .claude/skills/, memory/, and any custom scripts/. Mirrors the shape of
// lib/vault.ts (used by the Wiki page) but scoped to a single agent's own
// directory instead of a separate PARA vault, and covers more than .md files
// (config.json, goals.json, SKILL.md, .ts scripts) since that's the point —
// "everything about this agent," not just notes.

import fs from 'fs';
import path from 'path';
import { getAgentDir } from './config';

// Directories/files never shown, regardless of extension — credentials and
// noise. Matches the same categories orgs/gunn-property-services/.gitignore
// excludes from local version control, for the same reason.
const EXCLUDED_NAMES = new Set(['.git', '.env', 'node_modules', 'telegram-images']);
const EXCLUDED_PATTERNS = [/^secrets/i, /credential/i, /password/i, /\.key\.json$/i, /^\.env\./];

// Extensions worth showing in the tree, and the only ones editable via the
// dashboard's save endpoint. Binary/media/log noise is skipped entirely.
export const VISIBLE_EXTENSIONS = new Set(['.md', '.json', '.ts', '.js', '.txt', '.yml', '.yaml']);

function isExcluded(name: string): boolean {
  if (EXCLUDED_NAMES.has(name)) return true;
  return EXCLUDED_PATTERNS.some((p) => p.test(name));
}

export type AgentFileNode =
  | { kind: 'dir'; name: string; relPath: string; children: AgentFileNode[] }
  | { kind: 'file'; name: string; relPath: string; mtimeMs: number };

export function resolveAgentRoot(agent: string, org: string): string | null {
  const dir = getAgentDir(agent, org);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  return dir;
}

export function buildAgentFileTree(agentRoot: string): AgentFileNode[] {
  return walk(agentRoot, agentRoot);
}

function walk(abs: string, root: string): AgentFileNode[] {
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const dirs: AgentFileNode[] = [];
  const files: AgentFileNode[] = [];

  for (const entry of entries) {
    if (isExcluded(entry.name)) continue;

    const childAbs = path.join(abs, entry.name);
    const relPath = path.relative(root, childAbs);

    if (entry.isDirectory()) {
      const children = walk(childAbs, root);
      if (children.length > 0) {
        dirs.push({ kind: 'dir', name: entry.name, relPath, children });
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!VISIBLE_EXTENSIONS.has(ext)) continue;

    const stat = fs.statSync(childAbs);
    files.push({ kind: 'file', name: entry.name, relPath, mtimeMs: stat.mtimeMs });
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

/**
 * Resolve a requested relative path to an absolute path, guaranteed to stay
 * inside agentRoot and never resolve to an excluded (credential-pattern) file.
 * Returns null on any traversal attempt or excluded-name match.
 */
export function resolveAgentFilePath(agentRoot: string, relPath: string): string | null {
  const cleaned = relPath.replace(/^\/+/, '');
  if (cleaned.includes('..')) return null;
  if (cleaned.split('/').some((part) => isExcluded(part))) return null;

  const abs = path.resolve(agentRoot, cleaned);
  if (!abs.startsWith(path.resolve(agentRoot) + path.sep)) return null;
  return abs;
}
