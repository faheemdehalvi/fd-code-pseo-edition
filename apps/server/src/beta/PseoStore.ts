import { BetaPseoError } from "@fdcode/contracts";
import { writeFileStringAtomically } from "@fdcode/shared/atomicWrite";
import {
  addEvidence,
  createArticle,
  createWorkspace,
  moveStage,
  parseWorkspace,
  removeEvidence,
  runChecks,
  updateArticle,
  type Article,
  type Workspace,
} from "@fdcode/shared/pseo";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../config.ts";

interface Stored {
  readonly workspace: Workspace;
  readonly revision: number;
}

/**
 * The pSEO workspace, shared by the panel and agent tools. Every write bumps the
 * revision so a panel holding an older copy is refused instead of overwriting an
 * agent's edit.
 */
export class PseoStore extends Context.Service<
  PseoStore,
  {
    readonly get: Effect.Effect<Stored, BetaPseoError>;
    readonly save: (input: {
      readonly workspace: unknown;
      readonly baseRevision: number;
    }) => Effect.Effect<Stored, BetaPseoError>;
    readonly article: (id: string) => Effect.Effect<Article, BetaPseoError>;
    readonly createArticle: (
      input: Pick<Article, "title" | "keyword" | "format">,
    ) => Effect.Effect<Article, BetaPseoError>;
    readonly updateArticle: (
      id: string,
      patch: Partial<Pick<Article, "title" | "keyword" | "format" | "brief" | "body">>,
    ) => Effect.Effect<Article, BetaPseoError>;
    readonly addEvidence: (
      id: string,
      source: { url: string; title: string; note: string },
    ) => Effect.Effect<Article, BetaPseoError>;
    readonly removeEvidence: (
      id: string,
      sourceId: string,
    ) => Effect.Effect<Article, BetaPseoError>;
    readonly runChecks: (id: string) => Effect.Effect<Article, BetaPseoError>;
    readonly moveStage: (
      id: string,
      stage: Article["stage"],
    ) => Effect.Effect<Article, BetaPseoError>;
    readonly update: (
      transform: (workspace: Workspace) => Workspace,
    ) => Effect.Effect<Stored, BetaPseoError>;
  }
>()("fd-code/beta/PseoStore") {}

const isPseoError = Schema.is(BetaPseoError);
const json = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeSync(json);
const encodeJson = Schema.encodeSync(json);

const invalid = (cause: unknown) =>
  new BetaPseoError({
    reason: "invalid",
    detail: cause instanceof Error ? cause.message : "This workspace is invalid.",
  });

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = path.join(config.stateDir, "pseo", "workspace.json");
  const lock = yield* Semaphore.make(1);
  const failed = (cause: unknown) => new BetaPseoError({ reason: "operation_failed", cause });

  const read: Effect.Effect<Stored, BetaPseoError> = Effect.gen(function* () {
    if (!(yield* fs.exists(filePath))) return { workspace: createWorkspace(), revision: 0 };
    const raw = yield* fs.readFileString(filePath);
    const stored: unknown = yield* Effect.try({ try: () => decodeJson(raw), catch: failed });
    if (
      typeof stored !== "object" ||
      stored === null ||
      !("revision" in stored) ||
      typeof stored.revision !== "number" ||
      !Number.isSafeInteger(stored.revision) ||
      stored.revision < 0 ||
      !("workspace" in stored)
    )
      return yield* failed(new Error("pSEO store file is malformed."));
    const workspace = yield* Effect.try({
      try: () => parseWorkspace(encodeJson(stored.workspace)),
      catch: failed,
    });
    return { workspace, revision: stored.revision };
  }).pipe(Effect.mapError((error) => (isPseoError(error) ? error : failed(error))));

  const write = (workspace: Workspace, revision: number) =>
    writeFileStringAtomically({
      filePath,
      contents: encodeJson({ revision, workspace }),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(failed),
      Effect.as({ workspace, revision }),
    );

  const save = (input: { readonly workspace: unknown; readonly baseRevision: number }) =>
    Effect.gen(function* () {
      const workspace = yield* Effect.try({
        try: () => parseWorkspace(encodeJson(input.workspace)),
        catch: invalid,
      });
      const current = yield* read;
      if (current.revision !== input.baseRevision)
        return yield* new BetaPseoError({ reason: "conflict" });
      return yield* write(workspace, current.revision + 1);
    }).pipe(lock.withPermits(1));

  const update = (transform: (workspace: Workspace) => Workspace) =>
    Effect.gen(function* () {
      const current = yield* read;
      const next = yield* Effect.try({
        try: () => parseWorkspace(encodeJson(transform(current.workspace))),
        catch: invalid,
      });
      return yield* write(next, current.revision + 1);
    }).pipe(lock.withPermits(1));

  const findArticle = (workspace: Workspace, id: string) => {
    const article = workspace.articles.find((candidate) => candidate.id === id);
    if (!article) throw new Error("This pSEO article does not exist. Refresh the workspace.");
    return article;
  };
  const article = (id: string) =>
    read.pipe(
      Effect.flatMap(({ workspace }) =>
        Effect.try({ try: () => findArticle(workspace, id), catch: invalid }),
      ),
    );
  const edit = (id: string, transform: (article: Article) => Article) =>
    update((workspace) => {
      const changed = transform(findArticle(workspace, id));
      return {
        ...workspace,
        articles: workspace.articles.map((candidate) =>
          candidate.id === id ? changed : candidate,
        ),
      };
    }).pipe(
      Effect.flatMap(({ workspace }) =>
        Effect.try({ try: () => findArticle(workspace, id), catch: invalid }),
      ),
    );
  const create = (input: Pick<Article, "title" | "keyword" | "format">) =>
    Effect.gen(function* () {
      const created = yield* Effect.try({ try: () => createArticle(input), catch: invalid });
      yield* update((workspace) => ({
        ...workspace,
        articles: [created, ...workspace.articles],
        selectedId: workspace.selectedId ?? created.id,
      }));
      return created;
    });

  return PseoStore.of({
    get: read,
    save,
    update,
    article,
    createArticle: create,
    updateArticle: (id, patch) => edit(id, (article) => updateArticle(article, patch)),
    addEvidence: (id, source) => edit(id, (article) => addEvidence(article, source)),
    removeEvidence: (id, sourceId) => edit(id, (article) => removeEvidence(article, sourceId)),
    runChecks: (id) => edit(id, runChecks),
    moveStage: (id, stage) => edit(id, (article) => moveStage(article, stage)),
  });
});

export const layer = Layer.effect(PseoStore, make);
