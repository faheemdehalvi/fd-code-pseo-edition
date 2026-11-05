import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@fdcode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { approveBrief } from "@fdcode/shared/pseo";
import { ServerConfig } from "../../../config.ts";
import * as PseoStore from "../../../beta/PseoStore.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as PseoHandlers from "./handlers.ts";
import { PseoToolkit } from "./tools.ts";

it.effect("MCP edits the same persisted article as the panel and enforces the brief gate", () =>
  Effect.gen(function* () {
    const store = yield* PseoStore.make;
    const providerInstanceId = ProviderInstanceId.make("codex");
    const threadId = ThreadId.make("pseo-chat-test");
    const caller = {
      id: threadId,
      providerInstanceId,
      archivedAt: null,
      deletedAt: null,
      activeRunId: "run",
      runtimeMode: "full-access",
      interactionMode: "default",
    } as OrchestrationV2ThreadShell;
    const dependencies = Layer.mergeAll(
      Layer.succeed(PseoStore.PseoStore, store),
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("test-environment"),
        requestNamespace: "pseo-test",
        issuedAt: 0,
        thread: { threadId, providerInstanceId, providerSessionId: "test-session" },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
      }),
      Layer.mock(Threads.ThreadManagementService)({ getThreadShell: () => Effect.succeed(caller) }),
    );
    const toolkit = yield* PseoToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(PseoHandlers.layer).pipe(Layer.provide(dependencies)),
      ),
    );
    yield* toolkit
      .handle("t3_pseo_create_article", {
        title: "A practical content workflow",
        keyword: "content workflow",
        format: "General Blog",
      })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    const initial = yield* store.get;
    const id = initial.workspace.articles[0]!.id;
    yield* toolkit
      .handle("t3_pseo_update_article", {
        id,
        brief: "Explain the workflow without unsupported claims.",
      })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    expect((yield* store.article(id)).brief).toBe(
      "Explain the workflow without unsupported claims.",
    );
    const rejected = yield* toolkit
      .handle("t3_pseo_update_article", { id, body: "Unapproved draft" })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    expect(rejected.at(-1)).toMatchObject({ isFailure: true });
    expect((yield* store.article(id)).body).toBe("");
    const panel = yield* store.get;
    yield* store.save({
      workspace: { ...panel.workspace, articles: panel.workspace.articles.map(approveBrief) },
      baseRevision: panel.revision,
    });
    yield* toolkit
      .handle("t3_pseo_add_evidence", {
        id,
        url: "https://example.com/source",
        title: "Source",
        note: "Fixture source",
      })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    yield* toolkit
      .handle("t3_pseo_move_stage", { id, stage: "writing" })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    yield* toolkit
      .handle("t3_pseo_update_article", {
        id,
        body: "## A practical workflow\n\nStart with a brief and review the evidence before writing.",
      })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    const reopened = yield* PseoStore.make;
    expect((yield* reopened.article(id)).body).toContain("Start with a brief");
    const listed = yield* toolkit
      .handle("t3_pseo_workspace", {})
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    expect(listed.at(-1)?.result).toMatchObject({
      ok: true,
      value: { articles: [{ id, stage: "writing", sources: 1, briefApproved: true }] },
    });
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "fd-pseo-mcp-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
