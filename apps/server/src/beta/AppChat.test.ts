import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { ProjectId, ProviderInstanceId, type OrchestrationV2ThreadShell } from "@fdcode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerConfig } from "../config.ts";
import * as Settings from "../serverSettings.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as AppChat from "./AppChat.ts";

it.effect(
  "reuses an app's ordinary thread, creates fresh chats on request, and preserves model defaults",
  () =>
    Effect.gen(function* () {
      const created: Extract<
        import("@fdcode/contracts").OrchestrationV2Command,
        { type: "thread.create" }
      >[] = [];
      const shells: OrchestrationV2ThreadShell[] = [];
      const modelSelection = {
        instanceId: ProviderInstanceId.make("claude"),
        model: "test-selected-model",
      };
      const at = DateTime.makeUnsafe("2026-10-30T00:00:00Z");
      const dependencies = Layer.mergeAll(
        Settings.layerTest({ defaultModelSelection: modelSelection }),
        Layer.mock(Projects.ProjectService)({
          bootstrap: (input) =>
            Effect.succeed({
              created: true,
              project: {
                id: input.projectId ?? ProjectId.make("unexpected"),
                title: input.title,
                workspaceRoot: input.workspaceRoot,
                defaultModelSelection: null,
                scripts: [],
                createdAt: DateTime.formatIso(at),
                updatedAt: DateTime.formatIso(at),
                deletedAt: null,
              },
            }),
        }),
        Layer.mock(Threads.ThreadManagementService)({
          getShellSnapshot: () =>
            Effect.succeed({
              schemaVersion: 1,
              threads: shells,
              archivedThreads: [],
              snapshotSequence: 0,
            }),
          dispatch: (command) =>
            Effect.sync(() => {
              if (command.type === "thread.create") {
                created.push(command);
                shells.push({
                  id: command.threadId,
                  projectId: command.projectId,
                  updatedAt: at,
                  archivedAt: null,
                  deletedAt: null,
                } as OrchestrationV2ThreadShell);
              }
              return { sequence: 0, storedEvents: [] };
            }),
        }),
      );
      const chat = yield* AppChat.make.pipe(Effect.provide(dependencies));
      const first = yield* chat.open({ app: "pseo", fresh: false });
      const same = yield* chat.open({ app: "pseo", fresh: false });
      expect(same).toEqual(first);
      expect(first.threadId).toMatch(/^pseo-chat-/);
      expect(created).toHaveLength(1);
      expect(created[0]?.modelSelection).toEqual(modelSelection);
      const fresh = yield* chat.open({ app: "pseo", fresh: true });
      expect(fresh.threadId).not.toBe(first.threadId);
      const artsie = yield* chat.open({ app: "artsie", fresh: false });
      expect(artsie.projectId).not.toBe(first.projectId);
      expect(artsie.threadId).toMatch(/^artsie-chat-/);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          NodeCrypto.layer,
          ServerConfig.layerTest(process.cwd(), { prefix: "fd-app-chat-" }).pipe(
            Layer.provide(NodeServices.layer),
          ),
        ),
      ),
    ),
);
