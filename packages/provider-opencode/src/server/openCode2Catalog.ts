import type { OpenCodeClient } from "@opencode/client/effect";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import type { OpenCode2Model } from "./status.ts";

/**
 * A server loads its provider list with the rest of its catalog, which takes a couple of seconds
 * on a cold start, and the model loader retries while the catalog is empty anyway.
 */
const PROVIDER_NAME_TIMEOUT = "3 seconds";

/**
 * The models carry the payload and the names are decoration, so a provider read is bounded as
 * well as optional: one that never answers must not hold the models back.
 */
export const loadOpenCode2Catalog = (
  client: OpenCodeClient,
  directory: string,
): Effect.Effect<ReadonlyArray<OpenCode2Model>, OpenCodeRuntime.OpenCodeRuntimeError> => {
  const location = { directory };
  return Effect.all(
    {
      // Plugin activation can outlast the listening announcement by several seconds.
      // The model loader's 20-second budget includes these retries and server startup.
      models: client.model.list({ location }).pipe(
        Effect.retry({
          times: 39,
          schedule: Schedule.spaced("500 millis"),
          while: (error) => error._tag === "ServiceUnavailableError",
        }),
      ),
      providers: client.provider
        .list({ location })
        .pipe(Effect.timeout(PROVIDER_NAME_TIMEOUT), Effect.option),
    },
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(({ models, providers }) => {
      const providerNames = new Map(
        (Option.getOrUndefined(providers)?.data ?? []).map((provider) => [
          provider.id,
          provider.name,
        ]),
      );
      return models.data.map((model) => {
        const providerName = providerNames.get(model.providerID);
        return {
          providerID: model.providerID,
          id: model.id,
          name: model.name,
          ...(providerName ? { providerName } : {}),
          variants: model.variants.map((variant) => ({ id: variant.id })),
        };
      });
    }),
    Effect.mapError(
      (cause) =>
        new OpenCodeRuntime.OpenCodeRuntimeError({
          operation: "model.list",
          detail: "The OpenCode server could not list its models.",
          cause,
        }),
    ),
  );
};
