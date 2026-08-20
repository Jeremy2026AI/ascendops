'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WikiRenderer } from '@/components/wiki/wiki-renderer';
import { FolderTree, type TreeNode } from '@/components/wiki/folder-tree';

interface AgentFilesShellProps {
  org: string;
  agents: string[];
}

interface FileContent {
  relPath: string;
  content: string;
  ext: string;
  mtimeMs: number;
  sizeBytes: number;
}

const noopWikilink = () => {};

export function AgentFilesShell({ org, agents }: AgentFilesShellProps) {
  const [agent, setAgent] = useState(agents[0] ?? '');
  const [root, setRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const loadTree = useCallback(async (a: string) => {
    setTree(null);
    setTreeError(null);
    setSelected(null);
    setFile(null);
    try {
      const res = await fetch(`/api/agent-files/tree?org=${encodeURIComponent(org)}&agent=${encodeURIComponent(a)}`);
      const data = await res.json();
      if (!res.ok) {
        setTreeError(data.error ?? `Failed to load (${res.status})`);
        setTree([]);
        return;
      }
      setRoot(data.root);
      setTree(data.tree as TreeNode[]);
    } catch (e) {
      setTreeError(String(e));
      setTree([]);
    }
  }, [org]);

  useEffect(() => {
    if (agent) loadTree(agent);
  }, [agent, loadTree]);

  useEffect(() => {
    if (!selected) {
      setFile(null);
      return;
    }
    setLoadingFile(true);
    setFileError(null);
    setFile(null);
    fetch(`/api/agent-files/content?org=${encodeURIComponent(org)}&agent=${encodeURIComponent(agent)}&path=${encodeURIComponent(selected)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setFileError(data.error ?? `Failed to load (${res.status})`);
          return;
        }
        setFile(data as FileContent);
      })
      .catch((e) => setFileError(String(e)))
      .finally(() => setLoadingFile(false));
  }, [selected, org, agent]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agent Files</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {root ? (
              <>Read-only view of <code className="text-xs font-mono">{root}</code></>
            ) : (
              'Bootstrap files, knowledge, skills, memory, and scripts for each agent.'
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {agents.map((a) => (
          <Button
            key={a}
            type="button"
            size="sm"
            variant={a === agent ? 'default' : 'outline'}
            onClick={() => setAgent(a)}
          >
            {a}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-4 min-h-[60vh]">
        <div className="border rounded-xl bg-card overflow-hidden flex flex-col">
          <div className="p-3 border-b">
            <p className="text-[10px] text-muted-foreground">
              Bootstrap MD files, knowledge/, .claude/skills/, memory/, scripts/. Secrets and .env files are never shown.
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2">
              {tree === null ? (
                <div className="space-y-1 px-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-6 rounded bg-muted/30 animate-pulse" />
                  ))}
                </div>
              ) : treeError ? (
                <p className="text-sm text-destructive p-4">{treeError}</p>
              ) : (
                <FolderTree
                  nodes={tree}
                  selected={selected}
                  onSelectFile={setSelected}
                  storageKey={`agent-files:${org}:${agent}:expanded`}
                />
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="border rounded-xl bg-card overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 grid place-items-center p-8">
              <p className="text-sm text-muted-foreground">Select a file from the left to view it.</p>
            </div>
          ) : loadingFile ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : fileError ? (
            <div className="p-6 text-sm text-destructive">{fileError}</div>
          ) : file ? (
            <FileView file={file} onClose={() => setSelected(null)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FileView({ file, onClose }: { file: FileContent; onClose: () => void }) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <p className="text-[11px] font-mono text-muted-foreground truncate">{file.relPath}</p>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className="shrink-0" aria-label="Close file">
            Close
          </Button>
        </div>
        {file.ext === '.md' ? (
          <div className="prose prose-invert max-w-none">
            <WikiRenderer text={file.content} onWikilink={noopWikilink} />
          </div>
        ) : (
          <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {file.content}
          </pre>
        )}
      </div>
    </ScrollArea>
  );
}
