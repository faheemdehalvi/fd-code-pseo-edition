import { useStableCallback } from "../../hooks/useStableCallback";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ScopedThreadRef } from "@fdcode/contracts";
import { onOpenPseoWorkspace } from "./panelEvents";

function useWorkspaceState() {
  const [open, updateOpen] = useState(false);
  const [chatMount, setChatMount] = useState<HTMLDivElement | null>(null);
  const [chatRef, setChatRef] = useState<ScopedThreadRef | null>(null);
  const setOpen = useStableCallback((next: boolean) => {
    updateOpen(next);
    if (!next) setChatRef(null);
  });
  useEffect(() => onOpenPseoWorkspace(() => setOpen(true)), [setOpen]);
  return { open, setOpen, chatMount, setChatMount, chatRef, setChatRef };
}

const WorkspaceContext = createContext<ReturnType<typeof useWorkspaceState> | null>(null);

export function PseoWorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useWorkspaceState();
  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

export function usePseoWorkspaceLayout() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("pSEO workspace provider is missing");
  return context;
}
