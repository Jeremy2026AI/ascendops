export const dynamic = 'force-dynamic';

import { getOrgs, getAgentsForOrg } from '@/lib/config';
import { AgentFilesShell } from '@/components/agent-files/agent-files-shell';

interface PageProps {
  searchParams: Promise<{ org?: string }>;
}

export default async function AgentFilesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const orgs = getOrgs();
  const org = params.org && orgs.includes(params.org) ? params.org : orgs[0];

  if (!org) {
    return (
      <div className="border rounded-xl bg-card min-h-[60vh] grid place-items-center p-8">
        <p className="text-sm text-muted-foreground">No org configured.</p>
      </div>
    );
  }

  const agents = getAgentsForOrg(org).sort((a, b) => a.localeCompare(b));

  return <AgentFilesShell org={org} agents={agents} />;
}
