import { type BetaPseoError, OrchestratorMcpFailure } from "@fdcode/contracts";
import * as Effect from "effect/Effect";
import * as PseoStore from "../../../beta/PseoStore.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PseoToolkit } from "./tools.ts";

const invoke = <A>(
  operation: (store: PseoStore.PseoStore["Service"]) => Effect.Effect<A, BetaPseoError>,
) =>
  Effect.gen(function* () {
    const store = yield* PseoStore.PseoStore;
    const value = yield* operation(store).pipe(
      Effect.mapError(
        (error) =>
          new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
      ),
    );
    return { ok: true as const, value };
  });

const handlers = {
  t3_pseo_workspace: McpToolAccess.readsAsCaller(() =>
    invoke((store) =>
      store.get.pipe(
        Effect.map(({ workspace }) => ({
          client: workspace.client,
          articles: workspace.articles.map((article) => ({
            id: article.id,
            title: article.title,
            keyword: article.keyword,
            format: article.format,
            stage: article.stage,
            briefApproved:
              article.approvedBrief !== null && article.approvedBrief === article.brief,
            sources: article.evidence.length,
            updatedAt: article.updatedAt,
          })),
        })),
      ),
    ),
  ),
  t3_pseo_article: McpToolAccess.readsAsCaller((input) =>
    invoke((store) => store.article(input.id)),
  ),
  t3_pseo_create_article: McpToolAccess.actsAsCaller((input) =>
    invoke((store) => store.createArticle(input)),
  ),
  t3_pseo_update_article: McpToolAccess.actsAsCaller(({ id, ...patch }) =>
    invoke((store) =>
      store.updateArticle(id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.keyword !== undefined ? { keyword: patch.keyword } : {}),
        ...(patch.format !== undefined ? { format: patch.format } : {}),
        ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
      }),
    ),
  ),
  t3_pseo_add_evidence: McpToolAccess.actsAsCaller((input) =>
    invoke((store) =>
      store.addEvidence(input.id, {
        url: input.url,
        title: input.title,
        note: input.note ?? "",
      }),
    ),
  ),
  t3_pseo_remove_evidence: McpToolAccess.actsAsCaller((input) =>
    invoke((store) => store.removeEvidence(input.id, input.sourceId)),
  ),
  t3_pseo_run_checks: McpToolAccess.actsAsCaller((input) =>
    invoke((store) => store.runChecks(input.id)),
  ),
  t3_pseo_move_stage: McpToolAccess.actsAsCaller((input) =>
    invoke((store) => store.moveStage(input.id, input.stage)),
  ),
} satisfies McpToolAccess.Handlers<typeof PseoToolkit.tools>;

export const layer = McpToolAccess.toLayer(PseoToolkit, handlers);
