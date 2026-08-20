import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { getAllAgents } from '@/lib/config';
import { resolveAgentRoot, resolveAgentFilePath } from '@/lib/agent-files';

export const dynamic = 'force-dynamic';

// Read-only, and capped — this serves a browser tab, not a file transfer tool.
const MAX_BYTES = 2 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const org = url.searchParams.get('org');
  const agent = url.searchParams.get('agent');
  const relPath = url.searchParams.get('path');

  if (!org || !agent || !relPath) {
    return Response.json({ error: 'org, agent, and path query params are required' }, { status: 400 });
  }

  const known = getAllAgents().some((a) => a.name === agent && a.org === org);
  if (!known) {
    return Response.json({ error: `Unknown agent "${agent}" in org "${org}"` }, { status: 404 });
  }

  const root = resolveAgentRoot(agent, org);
  if (!root) {
    return Response.json({ error: `Agent directory not found for "${agent}"` }, { status: 404 });
  }

  const abs = resolveAgentFilePath(root, relPath);
  if (!abs) {
    return Response.json({ error: 'Path must be inside the agent directory and not match an excluded pattern' }, { status: 400 });
  }

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = fs.statSync(abs);
  if (stat.size > MAX_BYTES) {
    return Response.json({ error: `File too large to preview (${Math.round(stat.size / 1024)}KB)` }, { status: 413 });
  }

  const content = fs.readFileSync(abs, 'utf-8');
  return Response.json({
    relPath,
    content,
    ext: path.extname(abs).toLowerCase(),
    mtimeMs: stat.mtimeMs,
    sizeBytes: stat.size,
  });
}
