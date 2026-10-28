import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { Workspace } from "./model";
import { loadWorkspace, parseWorkspace, STORAGE_KEY, saveWorkspace } from "./storage";

function load(): { workspace: Workspace | null; error: string | null } {
  try {
    return { workspace: loadWorkspace(window.localStorage), error: null };
  } catch (error) {
    return {
      workspace: null,
      error: error instanceof Error ? error.message : "Unable to read browser storage.",
    };
  }
}

function Root() {
  const [initial] = useState(load);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [storageError, setStorageError] = useState<string | null>(null);
  if (!workspace)
    return (
      <main style={{ maxWidth: 640, margin: "12vh auto", padding: 32, fontFamily: "system-ui" }}>
        <h1>Your saved workspace needs attention</h1>
        <p role="alert">{initial.error}</p>
        <p>
          The saved data has been left untouched. Download a recovery copy before starting a fresh
          workspace. If browser storage is disabled, enable it and reload.
        </p>
        <button
          onClick={() => {
            try {
              const raw = window.localStorage.getItem(STORAGE_KEY);
              if (!raw) throw new Error("No saved data is available to download.");
              const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = "pseo-workspace-recovery.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) {
              setStorageError(String(error));
            }
          }}
        >
          Download recovery copy
        </button>
        <p>
          <label>
            Restore a workspace backup{" "}
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  const recovered = parseWorkspace(await file.text());
                  saveWorkspace(window.localStorage, recovered);
                  setWorkspace(recovered);
                  setStorageError(null);
                } catch (error) {
                  setStorageError(
                    error instanceof Error ? error.message : "Unable to restore this backup.",
                  );
                }
              }}
            />
          </label>
        </p>
        <p>{storageError}</p>
      </main>
    );
  return (
    <App
      workspace={workspace}
      storageError={storageError}
      onChange={(next) => {
        setWorkspace(next);
        try {
          saveWorkspace(window.localStorage, next);
          setStorageError(null);
        } catch {
          setStorageError(
            "Changes are only in memory. Browser storage is unavailable or full. Export a workspace backup before closing this tab.",
          );
        }
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
