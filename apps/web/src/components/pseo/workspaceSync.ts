import { createWorkspace, parseWorkspace, type Workspace } from "@fdcode/shared/pseo";
import { STORAGE_KEY } from "./storage";

interface Snapshot {
  workspace: Workspace | null;
  error: string | null;
  saving: boolean;
}

interface Dependencies {
  read: () => Promise<{ workspace: unknown; revision: number }>;
  save: (input: { workspace: Workspace; baseRevision: number }) => Promise<{
    workspace: unknown;
    revision: number;
  }>;
  storage: Pick<Storage, "getItem" | "setItem">;
  changed: (snapshot: Snapshot) => void;
}

const decoded = (value: unknown) => parseWorkspace(JSON.stringify(value));

export function createPseoWorkspaceSync(deps: Dependencies) {
  let snapshot: Snapshot = { workspace: null, error: null, saving: false };
  let revision = 0;
  let pending: Workspace | null = null;
  let blocked = false;
  let active = true;
  let reading = false;
  let epoch = 0;
  let backupSequence = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  const publish = (patch: Partial<Snapshot>) => {
    snapshot = { ...snapshot, ...patch };
    if (active) deps.changed(snapshot);
  };
  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const backup = (workspace: Workspace) => {
    deps.storage.setItem(
      `${STORAGE_KEY}:recovery:${Date.now()}:${backupSequence++}`,
      JSON.stringify(workspace),
    );
  };
  const flush = (): Promise<void> => {
    cancelTimer();
    if (saving) return saving;
    if (!pending || blocked) return Promise.resolve();
    const sent = pending;
    pending = null;
    publish({ saving: true });
    saving = (async () => {
      try {
        const result = await deps.save({ workspace: sent, baseRevision: revision });
        const workspace = decoded(result.workspace);
        revision = result.revision;
        publish({ ...(pending === null ? { workspace } : {}), error: null });
      } catch {
        pending ??= sent;
        blocked = true;
        publish({
          error:
            "Could not save pSEO. An agent or another window may have changed it. Your edits remain here. Reload the server version to resolve this; your edits will be backed up first.",
        });
        if (!active && pending) {
          try {
            backup(pending);
          } catch {
            // The legacy browser workspace remains untouched if recovery storage is unavailable.
          }
        }
      } finally {
        saving = null;
        publish({ saving: false });
        if (pending && !blocked) void flush();
      }
    })();
    return saving;
  };

  const read = async (migrate: boolean, force = false) => {
    if (reading || saving || pending) return;
    reading = true;
    const requestEpoch = epoch;
    try {
      const result = await deps.read();
      if (!active || requestEpoch !== epoch || pending || saving) return;
      let workspace = decoded(result.workspace);
      if (!force && snapshot.workspace !== null && result.revision === revision) {
        if (snapshot.error !== null) publish({ error: null });
        return;
      }
      revision = result.revision;
      const legacy = migrate ? deps.storage.getItem(STORAGE_KEY) : null;
      if (
        legacy !== null &&
        result.revision === 0 &&
        JSON.stringify(workspace) === JSON.stringify(createWorkspace())
      ) {
        workspace = parseWorkspace(legacy);
        backup(workspace);
        pending = workspace;
        publish({ workspace, error: null });
        await flush();
      } else {
        publish({ workspace, error: null });
      }
    } catch (cause) {
      if (active && requestEpoch === epoch) {
        publish({
          error:
            cause instanceof Error
              ? `Could not load pSEO: ${cause.message}`
              : "Could not load pSEO. Check your connection and try reloading.",
        });
      }
    } finally {
      reading = false;
    }
  };

  return {
    load: () => read(true),
    refresh: () => (blocked ? Promise.resolve() : read(false)),
    onChange(workspace: Workspace) {
      if (!active || snapshot.workspace === null) return;
      pending = workspace;
      epoch++;
      publish({ workspace, saving: !blocked });
      cancelTimer();
      timer = setTimeout(() => void flush(), 350);
    },
    async reloadServer() {
      cancelTimer();
      let currentSave = saving;
      while (currentSave) {
        await currentSave;
        currentSave = saving;
      }
      if (!active) return;
      if (pending) {
        try {
          backup(pending);
        } catch {
          publish({
            error: "Could not back up your unsaved edits. Download a backup before reloading.",
            saving: false,
          });
          return;
        }
      }
      pending = null;
      blocked = false;
      publish({ saving: false });
      epoch++;
      // A request already in progress must finish before the explicit reload can replace it.
      if (reading) {
        publish({ error: "A workspace request is still finishing. Try reloading again." });
        return;
      }
      await read(false, true);
    },
    stop() {
      active = false;
      epoch++;
      cancelTimer();
      if (pending && blocked) {
        try {
          backup(pending);
        } catch {
          // The caller has already received the save error while this workspace was visible.
        }
      } else {
        void flush();
      }
    },
  };
}
