import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { getAllAgents } from '@/lib/config';
import { resolveAgentRoot, resolveAgentFilePath, VISIBLE_EXTENSIONS } from '@/lib/agent-files';

export const dynamic = 'force-dynamic';

// Capped — this serves a browser tab, not a file transfer tool.
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

// Save an edit. Requires expectedMtimeMs (the mtime the client had loaded) so
// a write that raced against a live agent editing the same file — or against
// another browser tab — fails loud with 409 instead of silently clobbering
// whatever the agent just wrote. Only pre-existing files with an already
// on-disk directory are editable here; this isn't a file-creation tool.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const org = body?.org as string | undefined;
  const agent = body?.agent as string | undefined;
  const relPath = body?.path as string | undefined;
  const content = body?.content as string | undefined;
  const expectedMtimeMs = body?.expectedMtimeMs as number | undefined;

  if (!org || !agent || !relPath || content === undefined || expectedMtimeMs === undefined) {
    return Response.json(
      { error: 'org, agent, path, content, and expectedMtimeMs are all required' },
      { status: 400 },
    );
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

  if (!VISIBLE_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
    return Response.json({ error: 'This file type is not editable here' }, { status: 400 });
  }

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return Response.json({ error: 'File not found — this endpoint edits existing files only' }, { status: 404 });
  }

  if (Buffer.byteLength(content, 'utf-8') > MAX_BYTES) {
    return Response.json({ error: 'Content too large to save from this editor' }, { status: 413 });
  }

  const currentStat = fs.statSync(abs);
  if (currentStat.mtimeMs !== expectedMtimeMs) {
    return Response.json(
      { error: 'File changed on disk since you loaded it (likely a live agent write) — reload and reapply your edit before saving.' },
      { status: 409 },
    );
  }

  fs.writeFileSync(abs, content, 'utf-8');
  const newStat = fs.statSync(abs);
  return Response.json({
    relPath,
    content,
    ext: path.extname(abs).toLowerCase(),
    mtimeMs: newStat.mtimeMs,
    sizeBytes: newStat.size,
  });
}
