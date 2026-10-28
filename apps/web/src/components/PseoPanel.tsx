import { lazy, Suspense, useEffect, useState } from "react";
import { onOpenPseoWorkspace } from "./pseo/panelEvents";
import { FileTextIcon, MessageSquareIcon } from "lucide-react";
import { scopeProjectRef, scopedProjectKey } from "@fdcode/client-runtime/environment";

import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects } from "../state/entities";
import { ArtsiePanel } from "./ArtsiePanel";
import { Button } from "./ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { buildPseoAgentPrompt } from "./pseo/agentHandoff";
import { loadWorkspace, parseWorkspace, saveWorkspace, STORAGE_KEY } from "./pseo/storage";

const PseoApp = lazy(() => import("./pseo/App").then((module) => ({ default: module.App })));

function PseoWorkspace({ onClose }: { onClose: () => void }) {
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const [loaded] = useState(() => {
    try {
      return { workspace: loadWorkspace(window.localStorage), error: null };
    } catch (cause) {
      return {
        workspace: null,
        error:
          cause instanceof Error ? cause.message : "The saved pSEO workspace could not be read.",
      };
    }
  });
  const [workspace, setWorkspace] = useState(loaded.workspace);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState("");
  const [busy, setBusy] = useState(false);
  const visibleProjects = projects.filter((project) => project.isScratch !== true);
  const project = visibleProjects.find(
    (candidate) =>
      scopedProjectKey(scopeProjectRef(candidate.environmentId, candidate.id)) === projectKey,
  );
  const article =
    workspace?.articles.find((candidate) => candidate.id === workspace.selectedId) ??
    workspace?.articles[0];

  const prepareAgentDraft = async () => {
    if (!project || !workspace || !article || busy) return;
    setBusy(true);
    setHandoffError(null);
    try {
      const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id));
      if (!opened)
        throw new Error("The agent draft could not be opened. Choose the project and try again.");
      const store = useComposerDraftStore.getState();
      const existing = store.getComposerDraft(opened.draftId)?.prompt ?? "";
      const prompt = buildPseoAgentPrompt(workspace, article);
      store.setPrompt(opened.draftId, existing.trim() ? `${existing}\n\n${prompt}` : prompt);
      onClose();
    } catch (cause) {
      setHandoffError(
        cause instanceof Error ? cause.message : "The agent draft could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!workspace)
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold">Your saved pSEO workspace needs attention</h2>
        <p className="mt-2 text-sm" role="alert">
          {loaded.error}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          The saved data has been left untouched. Download it for recovery, or restore a valid
          workspace backup.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => {
              try {
                const raw = window.localStorage.getItem(STORAGE_KEY);
                if (raw === null) throw new Error("No saved workspace is available to download.");
                const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
                const link = document.createElement("a");
                link.href = url;
                link.download = "pseo-workspace-recovery.json";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (cause) {
                setStorageError(
                  cause instanceof Error ? cause.message : "Could not read saved data.",
                );
              }
            }}
          >
            Download recovery copy
          </Button>
        </div>
        <label className="mt-4 block text-sm">
          Restore a backup (replaces this saved workspace)
          <input
            type="file"
            accept=".json,application/json"
            className="mt-2 block"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const restored = parseWorkspace(await file.text());
                saveWorkspace(window.localStorage, restored);
                setWorkspace(restored);
                setStorageError(null);
              } catch (cause) {
                setStorageError(
                  cause instanceof Error ? cause.message : "Could not restore this backup.",
                );
              }
            }}
          />
        </label>
        {storageError && (
          <p className="mt-2 text-sm" role="alert">
            {storageError}
          </p>
        )}
      </div>
    );

  return (
    <Suspense fallback={<p className="p-6 text-sm">Opening pSEO workspace…</p>}>
      <PseoApp
        workspace={workspace}
        storageError={storageError ?? handoffError}
        onChange={(next) => {
          setWorkspace(next);
          try {
            saveWorkspace(window.localStorage, next);
            setStorageError(null);
          } catch {
            setStorageError(
              "Changes are only in memory. Download a workspace backup before closing pSEO.",
            );
          }
        }}
        hostActions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs">
              Agent project
              <select
                aria-label="Project for pSEO agent work"
                value={projectKey}
                onChange={(event) => setProjectKey(event.target.value)}
                className="max-w-48 rounded border border-input bg-background px-2 py-1 text-foreground"
              >
                <option value="">
                  {visibleProjects.length ? "Choose a project" : "Add a project first"}
                </option>
                {visibleProjects.map((candidate) => {
                  const key = scopedProjectKey(
                    scopeProjectRef(candidate.environmentId, candidate.id),
                  );
                  return (
                    <option key={key} value={key}>
                      {candidate.title} · {candidate.workspaceRoot}
                    </option>
                  );
                })}
              </select>
            </label>
            <Button
              variant="outline"
              size="compact"
              disabled={!project || !article || busy}
              onClick={() => void prepareAgentDraft()}
              aria-description="Prepare a prompt in the normal composer. Review it and choose your provider before sending."
            >
              <MessageSquareIcon />
              {busy ? "Preparing…" : "Work with agent"}
            </Button>
            <span>
              <ArtsiePanel />
              <span className="text-3xs text-muted-foreground">Primary host</span>
            </span>
          </div>
        }
      />
    </Suspense>
  );
}

export function PseoPanel() {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenPseoWorkspace(() => setOpen(true)), []);
  return (
    <>
      <Button
        variant="ghost"
        size="compact"
        onClick={() => setOpen(true)}
        aria-label="Open pSEO content workspace"
      >
        <FileTextIcon />
        pSEO
      </Button>
      {open && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogPopup className="flex h-[min(94dvh,70rem)] w-[min(98vw,100rem)] max-w-none flex-col overflow-hidden">
            <div className="shrink-0 pb-3 pr-8">
              <DialogHeader>
                <DialogTitle>pSEO content workspace</DialogTitle>
                <DialogDescription>
                  Briefs, evidence and writing, with your FD CODE agents and ARTsie media tools.
                  Agent work opens as a draft for you to review and send.
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <PseoWorkspace onClose={() => setOpen(false)} />
            </div>
          </DialogPopup>
        </Dialog>
      )}
    </>
  );
}
