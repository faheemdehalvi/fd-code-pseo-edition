import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe } from "vite-plus/test";

import { loadOpenCode2Catalog } from "./openCode2Catalog.ts";
import * as OpenCode2Client from "./v2/OpenCode2Client.ts";

const MODELS_BODY = `{"location":{"directory":"/project"},"data":[{"id":"step-5-preview-free","modelID":"step-5-preview-free","providerID":"opencode-go","name":"Step 5 Preview Free","compatibility":{"reasoningField":"reasoning_content"},"package":"@opencode/ai/providers/openai-compatible","settings":{"apiKey":"sk-demo-not-real","baseURL":"http://127.0.0.1:48990/v1","provider":"opencode-go"},"capabilities":{"tools":true,"input":["text","image","video"],"output":["text"]},"variants":[{"id":"low","settings":{"reasoningEffort":"low"}},{"id":"medium","settings":{"reasoningEffort":"medium"}},{"id":"high","settings":{"reasoningEffort":"high"}}],"time":{"released":1789516800000},"cost":[{"input":0,"output":0,"cache":{"read":0,"write":0}}],"status":"active","enabled":true,"limit":{"context":1000000,"input":1000000,"output":65536}},{"id":"step-5-preview-free","modelID":"step-5-preview-free","providerID":"opencode","name":"Step 5 Preview Free","compatibility":{"reasoningField":"reasoning_content"},"package":"@opencode/ai/providers/openai-compatible","settings":{"apiKey":"public","baseURL":"https://opencode.ai/zen/v1","provider":"opencode"},"capabilities":{"tools":true,"input":["text","image","video"],"output":["text"]},"variants":[{"id":"low","settings":{"reasoningEffort":"low"}},{"id":"medium","settings":{"reasoningEffort":"medium"}},{"id":"high","settings":{"reasoningEffort":"high"}}],"time":{"released":1789516800000},"cost":[{"input":0,"output":0,"cache":{"read":0,"write":0}}],"status":"active","enabled":true,"limit":{"context":1000000,"input":1000000,"output":65536}}]}`;

const PROVIDERS_BODY = `{"location":{"directory":"/project"},"data":[{"id":"opencode-go","integrationID":"opencode-go","name":"OpenCode Go","activation":"enabled","package":"@opencode/ai/providers/openai-compatible","settings":{"apiKey":"sk-demo-not-real","baseURL":"http://127.0.0.1:48990/v1","provider":"opencode-go"}},{"id":"opencode","integrationID":"opencode","name":"OpenCode Zen","activation":"enabled","package":"@opencode/ai/providers/openai-compatible","settings":{"apiKey":"public","baseURL":"https://opencode.ai/zen/v1"}}]}`;

const layerServerReplying = (
  bodies: Readonly<Record<string, string>>,
  hanging: ReadonlyArray<string> = [],
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.suspend(() => {
        const path = new URL(request.url).pathname;
        if (hanging.includes(path)) {
          return Effect.never;
        }
        const body = bodies[path];
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(body ?? '{"_tag":"NotFoundError","message":"not recorded"}', {
              status: body === undefined ? 404 : 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        );
      }),
    ),
  );

const readCatalog = (
  bodies: Readonly<Record<string, string>>,
  hanging: ReadonlyArray<string> = [],
) =>
  Effect.gen(function* () {
    const opencode = yield* OpenCode2Client.OpenCode2Client;
    const { client } = yield* opencode.connect({
      baseUrl: "http://127.0.0.1:4096",
      password: "secret",
    });
    return yield* loadOpenCode2Catalog(client, "/project");
  }).pipe(
    Effect.provide(OpenCode2Client.layer.pipe(Layer.provide(layerServerReplying(bodies, hanging)))),
  );

const withModelReplies = (
  replies: Array<{ readonly status: number; readonly body: string }>,
  onRequest: () => void,
) =>
  OpenCode2Client.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            const isModelRequest = new URL(request.url).pathname === "/api/model";
            if (isModelRequest) onRequest();
            const reply = isModelRequest
              ? replies.length > 1
                ? replies.shift()!
                : replies[0]!
              : { status: 200, body: PROVIDERS_BODY };
            return HttpClientResponse.fromWeb(
              request,
              new Response(reply.body, {
                status: reply.status,
                headers: { "content-type": "application/json" },
              }),
            );
          }),
        ),
      ),
    ),
  );

const readConnectedCatalog = Effect.gen(function* () {
  const opencode = yield* OpenCode2Client.OpenCode2Client;
  const { client } = yield* opencode.connect({
    baseUrl: "http://127.0.0.1:4096",
    password: "secret",
  });
  return yield* loadOpenCode2Catalog(client, "/project");
});

const pluginsStarting = {
  status: 503,
  body: '{"_tag":"ServiceUnavailableError","message":"Location plugins did not finish activating"}',
};

describe("loadOpenCode2Catalog", () => {
  it.effect("recovers when location plugins finish activating after the server starts", () =>
    Effect.gen(function* () {
      let requests = 0;
      const reading = yield* readConnectedCatalog.pipe(
        Effect.provide(
          withModelReplies(
            [
              ...Array.from({ length: 10 }, () => pluginsStarting),
              { status: 200, body: MODELS_BODY },
            ],
            () => requests++,
          ),
        ),
        Effect.forkChild,
      );
      yield* TestClock.adjust("6 seconds");
      assert.strictEqual((yield* Fiber.join(reading)).length, 2);
      assert.strictEqual(requests, 11);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("bounds retries when location plugins never become ready", () =>
    Effect.gen(function* () {
      let requests = 0;
      const reading = yield* readConnectedCatalog.pipe(
        Effect.provide(withModelReplies([pluginsStarting], () => requests++)),
        Effect.flip,
        Effect.forkChild,
      );
      yield* TestClock.adjust("20 seconds");
      assert.strictEqual((yield* Fiber.join(reading)).operation, "model.list");
      assert.strictEqual(requests, 40);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("does not retry a rejected server password", () =>
    Effect.gen(function* () {
      let requests = 0;
      const error = yield* readConnectedCatalog.pipe(
        Effect.provide(
          withModelReplies(
            [{ status: 401, body: '{"_tag":"UnauthorizedError","message":"Unauthorized"}' }],
            () => requests++,
          ),
        ),
        Effect.flip,
      );
      assert.strictEqual(error.operation, "model.list");
      assert.strictEqual(requests, 1);
    }),
  );

  it.effect("names the provider each listed model came from", () =>
    Effect.gen(function* () {
      const models = yield* readCatalog({
        "/api/model": MODELS_BODY,
        "/api/provider": PROVIDERS_BODY,
      });

      assert.deepStrictEqual(
        models.map((model) => [`${model.providerID}/${model.id}`, model.providerName]),
        [
          ["opencode-go/step-5-preview-free", "OpenCode Go"],
          ["opencode/step-5-preview-free", "OpenCode Zen"],
        ],
      );
    }),
  );

  it.effect("keeps the variants a model advertised", () =>
    Effect.gen(function* () {
      const models = yield* readCatalog({
        "/api/model": MODELS_BODY,
        "/api/provider": PROVIDERS_BODY,
      });

      assert.deepStrictEqual(
        models.map((model) => model.variants),
        [
          [{ id: "low" }, { id: "medium" }, { id: "high" }],
          [{ id: "low" }, { id: "medium" }, { id: "high" }],
        ],
      );
    }),
  );

  it.effect("leaves a model unnamed when the provider list fails", () =>
    Effect.gen(function* () {
      const models = yield* readCatalog({ "/api/model": MODELS_BODY });

      assert.deepStrictEqual(
        models.map((model) => [`${model.providerID}/${model.id}`, model.providerName]),
        [
          ["opencode-go/step-5-preview-free", undefined],
          ["opencode/step-5-preview-free", undefined],
        ],
      );
    }),
  );

  it.effect("keeps reading models while a provider list stays pending", () =>
    Effect.gen(function* () {
      const reading = yield* readCatalog({ "/api/model": MODELS_BODY }, ["/api/provider"]).pipe(
        Effect.forkChild,
      );
      yield* TestClock.adjust("5 seconds");
      const models = yield* Fiber.join(reading);

      assert.deepStrictEqual(
        models.map((model) => [`${model.providerID}/${model.id}`, model.providerName]),
        [
          ["opencode-go/step-5-preview-free", undefined],
          ["opencode/step-5-preview-free", undefined],
        ],
      );
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("fails the read when the model list fails", () =>
    Effect.gen(function* () {
      const error = yield* readCatalog({
        "/api/model": '{"_tag":"InternalServerError","message":"catalog unavailable"}',
        "/api/provider": PROVIDERS_BODY,
      }).pipe(Effect.flip);

      assert.strictEqual(error.operation, "model.list");
      assert.match(error.detail, /could not list its models/i);
    }),
  );
});
