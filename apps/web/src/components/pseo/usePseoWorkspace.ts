import { useEffect, useRef, useState } from "react";
import type { Workspace } from "@fdcode/shared/pseo";
import { readPseoWorkspace, savePseoWorkspace } from "../../rpc/pseo";
import { createPseoWorkspaceSync } from "./workspaceSync";

export function usePseoWorkspace() {
  const [state, setState] = useState<{
    workspace: Workspace | null;
    error: string | null;
    saving: boolean;
  }>({ workspace: null, error: null, saving: false });
  const sync = useRef<ReturnType<typeof createPseoWorkspaceSync> | null>(null);
  useEffect(() => {
    const current = createPseoWorkspaceSync({
      read: readPseoWorkspace,
      save: savePseoWorkspace,
      storage: {
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
      },
      changed: setState,
    });
    sync.current = current;
    void current.load();
    const interval = setInterval(() => void current.refresh(), 2000);
    return () => {
      clearInterval(interval);
      sync.current = null;
      current.stop();
    };
  }, []);
  const onChange = (workspace: Workspace) => sync.current?.onChange(workspace);
  const reloadServer = async () => sync.current?.reloadServer();
  return {
    ...state,
    onChange,
    reloadServer,
  };
}
