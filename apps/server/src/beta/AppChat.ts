import {
  BETA_APP_CHAT_PROJECT_ID,
  BETA_APP_CHAT_THREAD_PREFIX,
  BetaAppChatError,
  type BetaAppChatInput,
  CommandId,
  DEFAULT_MODEL,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@fdcode/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";

const APP_TITLES = { pseo: "pSEO", artsie: "ARTsie" } as const;

/**
 * Chats started from an app panel. They are ordinary threads in the app's own
 * project, so the same conversation is open in the panel and in the sidebar.
 */
export class AppChat extends Context.Service<
  AppChat,
  {
    readonly open: (
      input: BetaAppChatInput,
    ) => Effect.Effect<
      { readonly threadId: ThreadId; readonly projectId: ProjectId },
      BetaAppChatError
    >;
  }
>()("fd-code/beta/AppChat") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* Threads.ThreadManagementService;
  const settings = yield* ServerSettingsService;
  const lock = yield* Semaphore.make(1);

  const open = (input: BetaAppChatInput) =>
    Effect.gen(function* () {
      const title = APP_TITLES[input.app];
      const prefix = BETA_APP_CHAT_THREAD_PREFIX[input.app];
      const project = yield* projects.bootstrap({
        commandId: CommandId.make(`app-chat:${input.app}:project`),
        projectId: ProjectId.make(BETA_APP_CHAT_PROJECT_ID[input.app]),
        title,
        workspaceRoot: path.join(config.baseDir, `${input.app}-chat`),
        createWorkspaceRootIfMissing: true,
      });
      const projectId = project.project.id;
      if (!input.fresh) {
        const snapshot = yield* threads.getShellSnapshot();
        const latest = snapshot.threads
          .filter((thread) => thread.projectId === projectId && thread.id.startsWith(prefix))
          .toSorted(
            (left, right) =>
              DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
          )[0];
        if (latest) return { threadId: latest.id, projectId };
      }
      const threadId = ThreadId.make(`${prefix}${yield* crypto.randomUUIDv4()}`);
      const current = yield* settings.getSettings;
      yield* threads.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`app-chat-create:${threadId}`),
        threadId,
        projectId,
        title: `${title} chat`,
        modelSelection: current.defaultModelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        runtimeMode: current.defaultRuntimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      return { threadId, projectId };
    }).pipe(
      lock.withPermits(1),
      Effect.mapError((cause) => new BetaAppChatError({ cause })),
    );

  return AppChat.of({ open });
});

export const layer = Layer.effect(AppChat, make);
