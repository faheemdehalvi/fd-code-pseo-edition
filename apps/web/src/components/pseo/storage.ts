import { createWorkspace, parseWorkspace, type Workspace } from "@fdcode/shared/pseo";

export { parseWorkspace } from "@fdcode/shared/pseo";

// The pre-server copy of the workspace. Kept as a recovery source and migrated once.
export const STORAGE_KEY = "fdcode:pseo:workspace:v1";
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function loadWorkspace(storage: Storage): Workspace {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? createWorkspace() : parseWorkspace(raw);
}

export function saveWorkspace(storage: Storage, workspace: Workspace): void {
  const raw = JSON.stringify(workspace);
  parseWorkspace(raw);
  storage.setItem(STORAGE_KEY, raw);
}
