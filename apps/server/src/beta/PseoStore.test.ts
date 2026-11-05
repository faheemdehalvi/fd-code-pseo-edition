import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { approveBrief } from "@fdcode/shared/pseo";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { ServerConfig } from "../config.ts";
import * as PseoStore from "./PseoStore.ts";

const dependencies = ServerConfig.layerTest(process.cwd(), { prefix: "fd-pseo-store-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

it.effect("persists agent changes and rejects a stale panel save", () =>
  Effect.gen(function* () {
    const store = yield* PseoStore.make;
    const panel = yield* store.get;
    const article = yield* store.createArticle({
      title: "Evidence-led blogs",
      keyword: "blog workflow",
      format: "General Blog",
    });
    yield* store.updateArticle(article.id, {
      brief: "Explain how to prepare and approve a brief.",
    });
    const staleSave = yield* Effect.result(
      store.save({ workspace: panel.workspace, baseRevision: panel.revision }),
    );
    expect(Result.isFailure(staleSave)).toBe(true);
    if (Result.isFailure(staleSave)) expect(staleSave.failure.reason).toBe("conflict");
    const reopened = yield* PseoStore.make;
    expect((yield* reopened.article(article.id)).brief).toBe(
      "Explain how to prepare and approve a brief.",
    );
    expect((yield* reopened.get).revision).toBe(2);
  }).pipe(Effect.provide(dependencies)),
);

it.effect("allows one concurrent save per revision and preserves the winning content", () =>
  Effect.gen(function* () {
    const store = yield* PseoStore.make;
    const initial = yield* store.get;
    const saves = yield* Effect.all(
      ["First editor", "Second editor"].map((name) =>
        Effect.result(
          store.save({
            baseRevision: initial.revision,
            workspace: { ...initial.workspace, client: { ...initial.workspace.client, name } },
          }),
        ),
      ),
      { concurrency: "unbounded" },
    );
    expect(saves.filter(Result.isSuccess)).toHaveLength(1);
    expect(saves.filter(Result.isFailure)).toHaveLength(1);
    const winner = saves.find(Result.isSuccess);
    expect((yield* store.get).workspace).toEqual(winner?.success.workspace);
    expect((yield* store.get).revision).toBe(1);
  }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "requires human brief approval before an agent can write and persists a complete draft",
  () =>
    Effect.gen(function* () {
      const store = yield* PseoStore.make;
      const article = yield* store.createArticle({
        title: "How to write an evidence-led blog",
        keyword: "evidence-led blog",
        format: "General Blog",
      });
      yield* store.updateArticle(article.id, {
        brief: "Explain brief approval, sources and editorial review.",
      });
      const blocked = yield* Effect.result(
        store.updateArticle(article.id, { body: "Premature draft" }),
      );
      expect(Result.isFailure(blocked)).toBe(true);
      expect((yield* store.article(article.id)).body).toBe("");
      const panel = yield* store.get;
      yield* store.save({
        workspace: { ...panel.workspace, articles: panel.workspace.articles.map(approveBrief) },
        baseRevision: panel.revision,
      });
      yield* store.addEvidence(article.id, {
        url: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
        title: "Google Search Central",
        note: "Primary guidance; verification requires source review.",
      });
      yield* store.moveStage(article.id, "writing");
      const draft =
        "## Start with a brief\n\nDefine the reader and their question.\n\n## Keep evidence beside each claim\n\nRecord a source before drafting.\n\n## Review before publishing\n\nAn editor must check the finished article.";
      yield* store.updateArticle(article.id, { body: draft });
      yield* store.moveStage(article.id, "review");
      yield* store.runChecks(article.id);
      const reopened = yield* PseoStore.make;
      const saved = yield* reopened.article(article.id);
      expect(saved.body).toBe(draft);
      expect(saved.stage).toBe("review");
      expect(saved.checks?.body).toBe(draft);
      expect(saved.evidence).toHaveLength(1);
      yield* store.updateArticle(article.id, { brief: "A different audience and purpose" });
      expect((yield* store.article(article.id)).approvedBrief).toBeNull();
    }).pipe(Effect.provide(dependencies)),
);

it.effect("does not change storage when an article mutation fails", () =>
  Effect.gen(function* () {
    const store = yield* PseoStore.make;
    const initial = yield* store.get;
    const missing = yield* Effect.result(store.updateArticle("missing", { brief: "No article" }));
    expect(Result.isFailure(missing)).toBe(true);
    expect(yield* store.get).toEqual(initial);
  }).pipe(Effect.provide(dependencies)),
);

it.effect("refuses corrupt revision metadata without overwriting it", () =>
  Effect.gen(function* () {
    const store = yield* PseoStore.make;
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.join(config.stateDir, "pseo", "workspace.json");
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    const raw = JSON.stringify({ workspace: (yield* store.get).workspace, revision: -1 });
    yield* fs.writeFileString(filePath, raw);
    const result = yield* Effect.result(store.get);
    expect(Result.isFailure(result)).toBe(true);
    expect(yield* fs.readFileString(filePath)).toBe(raw);
  }).pipe(Effect.provide(dependencies)),
);
