import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CodexSettings } from "@fdcode/contracts";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import type * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  checkCodexProviderStatus,
  probeCodexAppServerProvider,
  withCodexAppServerClient,
} from "./CodexProvider.ts";

/**
 * Stand-in for Codex 0.162's app-server catalog behavior:
 * - `model/list` answers from `CODEX_HOME/models_cache.json` while it is fresh.
 * - A startup refresh runs before `initialize`, so it uses the originator set
 *   at spawn (the override env var, else the plain CLI's `codex_cli_rs`).
 * - The backend grants Ultrafast only to entitled accounts on app originators.
 */
const FAKE_CODEX_APP_SERVER = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const cachePath = path.join(process.env.CODEX_HOME, "models_cache.json");
const originator = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ?? "codex_cli_rs";
const ultrafast = process.env.FAKE_ULTRAFAST_ENTITLED === "1" && originator !== "codex_cli_rs";
const model = (tiers) => ({
  id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1 Sol", description: "",
  hidden: false, isDefault: true, defaultReasoningEffort: "high",
  supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
  serviceTiers: tiers.map((id) => ({ id, name: id, description: "" })),
});
setTimeout(() => {
  const tiers = ultrafast ? ["priority", "ultrafast"] : ["priority"];
  fs.writeFileSync(cachePath, JSON.stringify({ fetched_at: new Date().toISOString(), models: [model(tiers)] }));
}, 300);
const write = (message) => process.stdout.write(JSON.stringify(message) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line);
  if (id === undefined) return;
  if (method === "initialize") {
    write({ id, result: { userAgent: "codex/0.162.0", codexHome: process.env.CODEX_HOME, platformFamily: "unix", platformOs: "macos" } });
  } else if (method === "account/read") {
    write({ id, result: { account: { type: "chatgpt", email: "test@example.com", planType: "promax" }, requiresOpenaiAuth: false } });
  } else if (method === "skills/list") {
    write({ id, result: { data: [] } });
  } else if (method === "model/list") {
    write({ id, result: { data: JSON.parse(fs.readFileSync(cachePath, "utf8")).models, nextCursor: null } });
  } else {
    write({ id, error: { code: -32601, message: "unsupported" } });
  }
});
`;

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const solServiceTiers = Effect.fn("solServiceTiers")(function* (ultrafastEntitled: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-catalog-" });
  const binaryPath = path.join(dir, "codex");
  yield* fs.writeFileString(binaryPath, FAKE_CODEX_APP_SERVER);
  yield* fs.chmod(binaryPath, 0o755);

  yield* fs.writeFileString(
    path.join(dir, "models_cache.json"),
    JSON.stringify({
      fetched_at: DateTime.formatIso(DateTime.subtract(yield* DateTime.now, { minutes: 1 })),
      models: [
        {
          id: "gpt-6.1-sol",
          model: "gpt-6.1-sol",
          displayName: "GPT-6.1 Sol",
          description: "",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
          serviceTiers: (ultrafastEntitled ? ["priority"] : ["priority", "ultrafast"]).map(
            (id) => ({ id, name: id, description: "" }),
          ),
        },
      ],
    }),
  );

  const { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: _ambient, ...environment } = process.env;
  const provider = yield* checkCodexProviderStatus(
    decodeCodexSettings({ binaryPath, homePath: dir }),
    undefined,
    { ...environment, FAKE_ULTRAFAST_ENTITLED: ultrafastEntitled ? "1" : "0" },
  );
  const serviceTier = provider.models
    .find((model) => model.slug === "gpt-6.1-sol")
    ?.capabilities?.optionDescriptors?.find((descriptor) => descriptor.id === "serviceTier");
  return serviceTier?.type === "select" ? serviceTier.options.map((option) => option.id) : [];
});

it.layer(NodeServices.layer, { excludeTestServices: true })("Codex catalog discovery", (it) => {
  it.effect("keeps Ultrafast when another Codex client wrote the shared catalog cache", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* solServiceTiers(true), ["default", "priority", "ultrafast"]);
    }).pipe(Effect.scoped),
  );

  it.effect("drops Ultrafast once the account is no longer entitled to it", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* solServiceTiers(false), ["default", "priority"]);
    }).pipe(Effect.scoped),
  );
});

const initialModel = {
  id: "gpt-6.1-sol",
  model: "gpt-6.1-sol",
  displayName: "GPT-6.1 Sol",
  description: "",
  hidden: false,
  isDefault: true,
  defaultReasoningEffort: "high",
  supportedReasoningEfforts: [],
};

it.layer(NodeServices.layer)("Codex optional discovery deadlines", (it) => {
  it.effect("retains a successful catalog when a late refresh and skill discovery stall", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-deadline-" });
      yield* fs.writeFileString(
        path.join(dir, "models_cache.json"),
        JSON.stringify({
          fetched_at: "2099-01-01T00:00:00Z",
        }),
      );
      const starting = yield* Deferred.make<void>();
      const initialized = yield* Deferred.make<void>();
      const refreshing = yield* Deferred.make<void>();
      const closing = yield* Deferred.make<void>();
      let lists = 0;
      const request = ((method: string) => {
        if (method === "account/read")
          return Effect.succeed({
            account: { type: "chatgpt", email: "test@example.com", planType: "promax" },
            requiresOpenaiAuth: false,
          });
        if (method === "model/list")
          return Effect.suspend(() =>
            ++lists === 1
              ? Effect.succeed({ data: [initialModel], nextCursor: null })
              : Deferred.succeed(refreshing, undefined).pipe(Effect.andThen(Effect.never)),
          );
        return Effect.never;
      }) as CodexClient.CodexAppServerClient["Service"]["request"];
      const connect: typeof withCodexAppServerClient = () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Deferred.succeed(closing, undefined).pipe(Effect.andThen(Effect.sleep("2 seconds"))),
          );
          yield* Deferred.succeed(starting, undefined);
          yield* Deferred.await(initialized);
          return {
            client: { request } as CodexClient.CodexAppServerClient["Service"],
            initialize: {
              userAgent: "codex/0.165.0",
              codexHome: dir,
              platformFamily: "unix",
              platformOs: "macos",
            },
          };
        });
      const status = yield* checkCodexProviderStatus(decodeCodexSettings({}), (input) =>
        probeCodexAppServerProvider(input, connect),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(starting);
      yield* TestClock.adjust("15 seconds");
      yield* Deferred.succeed(initialized, undefined);
      yield* Deferred.await(refreshing);
      yield* TestClock.adjust("2 seconds");
      yield* Deferred.await(closing);
      yield* TestClock.adjust("2 seconds");
      const provider = yield* Fiber.join(status);
      assert.strictEqual(provider.status, "ready");
      assert.strictEqual(provider.auth.status, "authenticated");
      assert.deepStrictEqual(
        provider.models.map((model) => model.slug),
        ["gpt-6.1-sol"],
      );
      assert.deepStrictEqual(provider.skills, []);
      assert.strictEqual(lists, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("does not turn a finished probe into a timeout during child shutdown", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const closing = yield* Deferred.make<void>();
      const status = yield* checkCodexProviderStatus(decodeCodexSettings({}), () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Deferred.succeed(closing, undefined).pipe(Effect.andThen(Effect.sleep("2 seconds"))),
          );
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(finish);
          return {
            account: {
              account: { type: "chatgpt", email: "test@example.com", planType: "promax" },
              requiresOpenaiAuth: false,
            },
            version: "0.165.0",
            models: [{ slug: "gpt-6.1-sol", name: "Sol", isCustom: false, capabilities: null }],
            skills: [],
          };
        }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("19 seconds");
      yield* Deferred.succeed(finish, undefined);
      yield* Deferred.await(closing);
      yield* TestClock.adjust("2 seconds");
      const provider = yield* Fiber.join(status);
      assert.strictEqual(provider.status, "ready");
      assert.strictEqual(provider.models[0]?.slug, "gpt-6.1-sol");
    }),
  );

  it.effect("keeps account failures visible instead of treating them as optional discovery", () =>
    Effect.gen(function* () {
      const request = (() =>
        Effect.fail(
          new CodexErrors.CodexAppServerRequestError({
            code: -32000,
            errorMessage: "Account unavailable",
          }),
        )) as CodexClient.CodexAppServerClient["Service"]["request"];
      const connect: typeof withCodexAppServerClient = () =>
        Effect.succeed({
          client: { request } as CodexClient.CodexAppServerClient["Service"],
          initialize: {
            userAgent: "codex/0.165.0",
            codexHome: "/unused",
            platformFamily: "unix",
            platformOs: "macos",
          },
        });
      const provider = yield* checkCodexProviderStatus(decodeCodexSettings({}), (input) =>
        probeCodexAppServerProvider(input, connect),
      );
      assert.strictEqual(provider.status, "error");
      assert.include(provider.message, "Account unavailable");
      assert.deepStrictEqual(provider.models, []);
    }),
  );
});
