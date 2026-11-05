import type { BetaPseoSaveInput } from "@fdcode/contracts";
import * as Effect from "effect/Effect";
import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";

export const openPseoChat = (fresh = false) =>
  runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.beta.appChat({ headers: {}, payload: { app: "pseo", fresh } }),
      ),
    ),
  );

export const readPseoWorkspace = () =>
  runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.beta.pseoWorkspace({ headers: {} })),
    ),
  );

export const savePseoWorkspace = (payload: BetaPseoSaveInput) =>
  runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.beta.pseoSave({ headers: {}, payload })),
    ),
  );
