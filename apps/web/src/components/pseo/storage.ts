import { formats, stages, createWorkspace } from "./model.ts";
import type { Workspace } from "./model.ts";

export const STORAGE_KEY = "fdcode:pseo:workspace:v1";
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === "string");
}

export function parseWorkspace(raw: string): Workspace {
  const value: unknown = JSON.parse(raw);
  if (!object(value)) throw new Error("This saved workspace has an unsupported format.");
  // oxlint-disable-next-line fd-code/no-rpc-permission-bypass -- Saved client profile data, not an RPC client.
  const clientProfile = value.client;
  if (
    value.version !== 1 ||
    !object(clientProfile) ||
    !strings(clientProfile, ["name", "domain", "audience"]) ||
    !Array.isArray(value.articles) ||
    !(value.selectedId === null || typeof value.selectedId === "string")
  ) {
    throw new Error("This saved workspace has an unsupported format.");
  }
  const ids = new Set<string>();
  for (const article of value.articles) {
    if (
      !object(article) ||
      !strings(article, ["id", "title", "keyword", "brief", "body", "updatedAt"]) ||
      !formats.some((format) => format === article.format) ||
      !stages.some((stage) => stage === article.stage) ||
      !(article.approvedBrief === null || typeof article.approvedBrief === "string") ||
      !Array.isArray(article.evidence) ||
      !Array.isArray(article.activity)
    ) {
      throw new Error("A saved article is incomplete.");
    }
    const id = article.id as string;
    if (ids.has(id)) throw new Error("Saved articles have duplicate identifiers.");
    ids.add(id);
    if (
      article.stage !== "brief" &&
      (article.approvedBrief === null || article.approvedBrief !== article.brief)
    ) {
      throw new Error("A saved article has no valid brief approval.");
    }
    for (const evidence of article.evidence) {
      if (
        !object(evidence) ||
        !strings(evidence, ["id", "url", "title", "note"]) ||
        typeof evidence.verified !== "boolean"
      ) {
        throw new Error("A saved research source is incomplete.");
      }
      const url = new URL(evidence.url as string);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw new Error("A saved source has an invalid URL.");
    }
    if (
      !article.activity.every((entry) => object(entry) && strings(entry, ["id", "at", "message"]))
    ) {
      throw new Error("Saved activity has an unsupported format.");
    }
    if (article.checks !== null) {
      const checks = article.checks;
      if (
        !object(checks) ||
        !strings(checks, ["body", "at"]) ||
        !Array.isArray(checks.issues) ||
        !checks.issues.every(
          (issue) =>
            object(issue) &&
            strings(issue, ["id", "label", "detail"]) &&
            ["pass", "fail", "manual"].includes(String(issue.status)),
        )
      ) {
        throw new Error("Saved editorial checks have an unsupported format.");
      }
    }
  }
  if (value.selectedId !== null && !ids.has(value.selectedId as string))
    throw new Error("The selected article does not exist.");
  return value as Workspace;
}

export function loadWorkspace(storage: Storage): Workspace {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? createWorkspace() : parseWorkspace(raw);
}

export function saveWorkspace(storage: Storage, workspace: Workspace): void {
  const raw = JSON.stringify(workspace);
  parseWorkspace(raw);
  storage.setItem(STORAGE_KEY, raw);
}
