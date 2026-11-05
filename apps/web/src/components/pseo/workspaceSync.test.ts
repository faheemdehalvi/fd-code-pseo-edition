import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createWorkspace, type Workspace } from "@fdcode/shared/pseo";
import { createPseoWorkspaceSync } from "./workspaceSync";
import { STORAGE_KEY } from "./storage";

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<A>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const values = new Map<string, string>();
  const read = vi.fn(async () => ({ workspace: createWorkspace(), revision: 3 }));
  const save = vi.fn(async (input: { workspace: Workspace; baseRevision: number }) => ({
    workspace: input.workspace,
    revision: input.baseRevision + 1,
  }));
  const changed = vi.fn();
  const sync = createPseoWorkspaceSync({
    read,
    save,
    changed,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    },
  });
  const edit = (name: string) => ({
    ...createWorkspace(),
    client: { name, domain: "", audience: "" },
  });
  return { sync, values, read, save, changed, edit };
}

afterEach(() => vi.useRealTimers());

describe("pSEO shared workspace synchronization", () => {
  it("reports a failed migration recovery backup instead of leaving the workspace loading", async () => {
    const changed = vi.fn();
    const save = vi.fn();
    const sync = createPseoWorkspaceSync({
      read: async () => ({ workspace: createWorkspace(), revision: 0 }),
      save,
      changed,
      storage: {
        getItem: () => JSON.stringify(createWorkspace()),
        setItem: () => {
          throw new Error("Storage quota exceeded");
        },
      },
    });
    await sync.load();
    expect(changed.mock.lastCall?.[0].error).toContain("Storage quota exceeded");
    expect(changed.mock.lastCall?.[0].workspace).toBeNull();
    expect(save).not.toHaveBeenCalled();
    sync.stop();
  });

  it("does not republish unchanged polling revisions but explicit reload still discards edits", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.sync.load();
    const published = f.changed.mock.calls.length;
    await f.sync.refresh();
    expect(f.changed).toHaveBeenCalledTimes(published);
    f.sync.onChange(f.edit("Unsaved"));
    await f.sync.reloadServer();
    expect(f.changed.mock.lastCall?.[0].workspace).toEqual(createWorkspace());
    expect([...f.values.values()].map((raw) => JSON.parse(raw))).toContainEqual(f.edit("Unsaved"));
    f.sync.stop();
  });

  it("coalesces edits and serializes a later edit against the newly committed revision", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const first = deferred<{ workspace: Workspace; revision: number }>();
    f.save.mockImplementationOnce(() => first.promise);
    await f.sync.load();
    f.sync.onChange(f.edit("First"));
    f.sync.onChange(f.edit("Second"));
    await vi.advanceTimersByTimeAsync(350);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenLastCalledWith({ workspace: f.edit("Second"), baseRevision: 3 });
    f.sync.onChange(f.edit("Third"));
    await f.sync.refresh();
    expect(f.read).toHaveBeenCalledTimes(1);
    first.resolve({ workspace: f.edit("Second"), revision: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.save).toHaveBeenLastCalledWith({ workspace: f.edit("Third"), baseRevision: 4 });
    expect(f.changed.mock.lastCall?.[0].workspace).toEqual(f.edit("Third"));
    f.sync.stop();
  });

  it("keeps edits after a conflict and backs them up before an explicit server reload", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.sync.load();
    f.save.mockRejectedValueOnce(new Error("conflict"));
    f.sync.onChange(f.edit("Unsaved"));
    await vi.advanceTimersByTimeAsync(350);
    await f.sync.refresh();
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.changed.mock.lastCall?.[0].workspace).toEqual(f.edit("Unsaved"));
    expect(f.changed.mock.lastCall?.[0].error).toContain("Your edits remain here");
    f.read.mockResolvedValue({ workspace: f.edit("Agent version"), revision: 5 });
    await f.sync.reloadServer();
    expect([...f.values.values()].map((raw) => JSON.parse(raw))).toContainEqual(f.edit("Unsaved"));
    expect(f.changed.mock.lastCall?.[0].workspace).toEqual(f.edit("Agent version"));
    f.sync.stop();
  });

  it("migrates a legacy browser copy only into a pristine server and retains the original", async () => {
    const f = fixture();
    const original = JSON.stringify(f.edit("Browser copy"));
    f.values.set(STORAGE_KEY, original);
    f.read.mockResolvedValue({ workspace: createWorkspace(), revision: 0 });
    await f.sync.load();
    expect(f.save).toHaveBeenCalledWith({ workspace: f.edit("Browser copy"), baseRevision: 0 });
    expect(f.values.get(STORAGE_KEY)).toBe(original);
    expect(f.values.size).toBe(2);
    f.sync.stop();
    const existing = fixture();
    existing.values.set(STORAGE_KEY, original);
    await existing.sync.load();
    expect(existing.save).not.toHaveBeenCalled();
    existing.sync.stop();
  });

  it("ignores a polling response that races with a local edit and flushes on close", async () => {
    const f = fixture();
    await f.sync.load();
    const poll = deferred<{ workspace: Workspace; revision: number }>();
    f.read.mockImplementationOnce(() => poll.promise);
    const refreshing = f.sync.refresh();
    f.sync.onChange(f.edit("Local edit"));
    poll.resolve({ workspace: f.edit("Stale poll"), revision: 4 });
    await refreshing;
    expect(f.changed.mock.lastCall?.[0].workspace).toEqual(f.edit("Local edit"));
    const count = f.changed.mock.calls.length;
    f.sync.stop();
    await Promise.resolve();
    expect(f.save).toHaveBeenCalledWith({ workspace: f.edit("Local edit"), baseRevision: 3 });
    expect(f.changed).toHaveBeenCalledTimes(count);
  });
});
