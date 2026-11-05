import { OrchestratorMcpFailure } from "@fdcode/contracts";
import { formats, stages } from "@fdcode/shared/pseo";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as PseoStore from "../../../beta/PseoStore.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";

// Workspace content is the user's own writing and sources: data for the model, never instructions.
const PseoResult = Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown });
const ArticleId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max));

const shared = {
  success: PseoResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    PseoStore.PseoStore,
  ],
};

const PseoWorkspaceTool = Tool.make("t3_pseo_workspace", {
  ...shared,
  description:
    "Read the pSEO content workspace: client profile and every article's id, title, keyword, format, workflow stage, whether its brief is approved, source count and last update. Start here.",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const PseoArticleTool = Tool.make("t3_pseo_article", {
  ...shared,
  description:
    "Read one pSEO article in full: brief, approved brief, Markdown draft, research sources, latest editorial check results and activity.",
  parameters: Schema.Struct({ id: ArticleId }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const PseoCreateArticleTool = Tool.make("t3_pseo_create_article", {
  ...shared,
  description: `Create a pSEO article in the brief stage. format is one of: ${formats.join(", ")}.`,
  parameters: Schema.Struct({
    title: Text(300).check(Schema.isMinLength(1)),
    keyword: Text(300),
    format: Schema.Literals(formats),
  }),
}).annotate(Tool.Destructive, false);

const PseoUpdateArticleTool = Tool.make("t3_pseo_update_article", {
  ...shared,
  description:
    "Edit a pSEO article's title, keyword, format, brief or Markdown body (use ## headings, no em dashes, write Intelligent Resourcing in full). The body is locked until the user approves the brief and the article is in the writing stage. Changing the title, keyword, format or brief revokes the user's approval.",
  parameters: Schema.Struct({
    id: ArticleId,
    title: Schema.optional(Text(300)),
    keyword: Schema.optional(Text(300)),
    format: Schema.optional(Schema.Literals(formats)),
    brief: Schema.optional(Text(50_000)),
    body: Schema.optional(Text(200_000)),
  }),
}).annotate(Tool.Destructive, true);

const PseoAddEvidenceTool = Tool.make("t3_pseo_add_evidence", {
  ...shared,
  description:
    "Attach a research source (http/https URL, title, note) to a pSEO article. Sources are marked unverified; say what you checked in the note.",
  parameters: Schema.Struct({
    id: ArticleId,
    url: Text(2048),
    title: Text(300),
    note: Schema.optional(Text(5_000)),
  }),
}).annotate(Tool.Destructive, false);

const PseoRemoveEvidenceTool = Tool.make("t3_pseo_remove_evidence", {
  ...shared,
  description: "Remove one research source from a pSEO article by its source id.",
  parameters: Schema.Struct({ id: ArticleId, sourceId: ArticleId }),
}).annotate(Tool.Destructive, true);

const PseoRunChecksTool = Tool.make("t3_pseo_run_checks", {
  ...shared,
  description:
    "Run the preliminary editorial checks on a pSEO article's draft and return the results. Manual items remain for a human editor.",
  parameters: Schema.Struct({ id: ArticleId }),
}).annotate(Tool.Destructive, false);

const PseoMoveStageTool = Tool.make("t3_pseo_move_stage", {
  ...shared,
  description: `Move a pSEO article to another workflow stage (${stages.join(", ")}). Forward moves need the user's brief approval, sources before writing, a draft before review, and passing checks before handover. Moving to brief revokes approval. Only the user can approve a brief or publish.`,
  parameters: Schema.Struct({ id: ArticleId, stage: Schema.Literals(stages) }),
}).annotate(Tool.Destructive, false);

export const PseoToolkit = Toolkit.make(
  PseoWorkspaceTool,
  PseoArticleTool,
  PseoCreateArticleTool,
  PseoUpdateArticleTool,
  PseoAddEvidenceTool,
  PseoRemoveEvidenceTool,
  PseoRunChecksTool,
  PseoMoveStageTool,
);
