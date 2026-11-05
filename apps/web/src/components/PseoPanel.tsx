import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon, MessageSquareIcon } from "lucide-react";
import { scopeThreadRef } from "@fdcode/client-runtime/environment";
import { AuthOrchestrationOperateScope } from "@fdcode/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { usePrimaryEnvironmentId } from "../state/environments";
import { waitForThreadShell } from "../state/entities";
import { useEnvironmentScope } from "../state/session";
import { openPseoChat } from "../rpc/pseo";
import { ArtsiePanel } from "./ArtsiePanel";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import { Button } from "./ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { buildPseoAgentPrompt } from "./pseo/agentHandoff";
import { openPseoWorkspace } from "./pseo/panelEvents";
import { usePseoWorkspace } from "./pseo/usePseoWorkspace";
import { usePseoWorkspaceLayout } from "./pseo/workspaceContext";

const PseoApp = lazy(() => import("./pseo/App").then((module) => ({ default: module.App })));

const CHAT_GUIDANCE = [
  "Work with me in the native pSEO workspace. Use t3_pseo_workspace to read its current articles and t3_pseo_article to read an article in full.",
  "Use the t3_pseo_create_article, t3_pseo_update_article, t3_pseo_add_evidence, t3_pseo_move_stage and t3_pseo_run_checks tools to save work directly into the workspace. Discover the exact tool schemas before calling them.",
  "Start with a brief. Only the user can approve it using Approve brief in pSEO. After approval, gather primary sources, attach evidence, move to writing and save a Markdown draft. Do not invent research, SEO metrics or checks, or publish anything.",
  "For media, discover the existing ARTsie tools and use them when useful. Preserve originals and verify exported files.",
].join("\n\n");

function PseoWorkspace() {
  const { workspace, onChange, error, saving, reloadServer } = usePseoWorkspace();
  const { chatRef, setChatRef, setChatMount } = usePseoWorkspaceLayout();
  const environmentId = usePrimaryEnvironmentId();
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const navigate = useNavigate();
  const [chatError, setChatError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const openChat = useStableCallback(async (fresh: boolean = false) => {
    if (!environmentId || !canOperate || openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setChatError(null);
    try {
      const result = await openPseoChat(fresh);
      const ref = scopeThreadRef(environmentId, result.threadId);
      const ready = await waitForThreadShell(ref);
      if (!ready) throw new Error("Chat was created but has not loaded yet. Try again.");
      if (!mounted.current) return;
      const store = useComposerDraftStore.getState();
      if (!store.getComposerDraft(ref)?.prompt.trim()) store.setPrompt(ref, CHAT_GUIDANCE);
      setChatRef(null);
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.threadId },
      });
      if (mounted.current) setChatRef(ref);
    } catch (cause) {
      if (mounted.current)
        setChatError(cause instanceof Error ? cause.message : "Could not open pSEO chat.");
    } finally {
      openingRef.current = false;
      if (mounted.current) setOpening(false);
    }
  });

  useEffect(() => {
    if (environmentId && canOperate && !chatRef && !openingRef.current && !chatError)
      void openChat();
  }, [environmentId, canOperate, chatRef, chatError, openChat]);

  const article =
    workspace?.articles.find((candidate) => candidate.id === workspace.selectedId) ??
    workspace?.articles[0];
  const attachArticle = () => {
    if (!workspace || !article || !chatRef) return;
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(chatRef)?.prompt ?? "";
    const context = `${CHAT_GUIDANCE}\n\n${buildPseoAgentPrompt(workspace, article)}`;
    store.setPrompt(chatRef, existing.trim() ? `${existing}\n\n${context}` : context);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,3fr)_minmax(25rem,2fr)] lg:overflow-hidden">
      <div className="min-h-[32rem] min-w-0 overflow-auto [container-name:pseo-editor] [container-type:inline-size] lg:min-h-0">
        {error && (
          <div className="flex flex-wrap items-center gap-2 p-3" role="alert">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="compact" onClick={() => void reloadServer()}>
              Reload saved workspace
            </Button>
          </div>
        )}
        {workspace ? (
          <Suspense fallback={<p className="p-6 text-sm">Opening pSEO workspace…</p>}>
            <PseoApp
              workspace={workspace}
              onChange={onChange}
              storageError={error}
              hostActions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="compact"
                    disabled={!article || !chatRef || !canOperate}
                    onClick={attachArticle}
                  >
                    <MessageSquareIcon /> Add article to chat
                  </Button>
                  <ArtsiePanel />
                  <span className="text-xs text-muted-foreground" role="status">
                    {saving ? "Saving…" : "Shared with your agents"}
                  </span>
                </div>
              }
            />
          </Suspense>
        ) : (
          <p className="p-6 text-sm">
            {error ? "Reconnect to load your saved workspace." : "Loading your workspace…"}
          </p>
        )}
      </div>
      <section
        className="flex h-[40rem] min-h-0 min-w-0 flex-col border-t bg-background text-foreground lg:h-auto lg:border-l lg:border-t-0"
        aria-label="pSEO agent chat"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-medium">pSEO chat</span>
          <Button
            variant="ghost"
            size="compact"
            disabled={opening || !canOperate}
            onClick={() => void openChat(true)}
          >
            New chat
          </Button>
        </div>
        {chatError && (
          <div className="p-3" role="alert">
            <p className="text-sm text-destructive">{chatError}</p>
            <Button variant="outline" size="compact" onClick={() => void openChat()}>
              Retry chat
            </Button>
          </div>
        )}
        {!chatRef && !chatError && (
          <p className="p-3 text-sm text-muted-foreground">
            {canOperate
              ? "Opening FD CODE chat…"
              : "Connect with permission to operate threads to chat."}
          </p>
        )}
        <div ref={setChatMount} className="min-h-0 flex-1" />
      </section>
    </div>
  );
}

export function PseoPanel() {
  return (
    <Button
      variant="ghost"
      size="compact"
      onClick={openPseoWorkspace}
      aria-label="Open pSEO content workspace"
    >
      <FileTextIcon /> pSEO
    </Button>
  );
}

export function PseoWorkspaceHost() {
  const { open, setOpen } = usePseoWorkspaceLayout();
  if (!open) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        // The routed chat's popovers portal outside this dialog's React ancestry.
        if (details.reason !== "outside-press") setOpen(next);
      }}
      modal={false}
    >
      <DialogPopup className="flex h-[min(94dvh,70rem)] w-[min(98vw,110rem)] max-w-none flex-col overflow-hidden">
        <div className="shrink-0 pb-3 pr-8">
          <DialogHeader>
            <DialogTitle>pSEO content workspace</DialogTitle>
            <DialogDescription>
              Plan, research and write with your FD CODE agents. Approve the brief before drafting,
              then review the result before publishing.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <RenderErrorBoundary
            fallback={
              <p className="p-6 text-sm" role="alert">
                pSEO could not load. Reopen the workspace to try again.
              </p>
            }
          >
            <PseoWorkspace />
          </RenderErrorBoundary>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
