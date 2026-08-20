import { NextRequest } from 'next/server';
import { getAllAgents } from '@/lib/config';
import { resolveAgentRoot, buildAgentFileTree } from '@/lib/agent-files';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const org = url.searchParams.get('org');
  const agent = url.searchParams.get('agent');

  if (!org || !agent) {
    return Response.json({ error: 'org and agent query params are required' }, { status: 400 });
  }

  const known = getAllAgents().some((a) => a.name === agent && a.org === org);
  if (!known) {
    return Response.json({ error: `Unknown agent "${agent}" in org "${org}"` }, { status: 404 });
  }

  const root = resolveAgentRoot(agent, org);
  if (!root) {
    return Response.json({ error: `Agent directory not found for "${agent}"` }, { status: 404 });
  }

  return Response.json({ root, tree: buildAgentFileTree(root) });
}
