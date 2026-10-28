import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  createArticle,
  updateArticle,
  approveBrief,
  revokeApproval,
  moveStage,
  addEvidence,
  removeEvidence,
  runChecks,
  exportMarkdown,
} from "./model.ts";

function approved() {
  return approveBrief(
    updateArticle(
      createArticle({
        title: "Choosing a content partner",
        keyword: "content partner",
        format: "Comparison",
      }),
      {
        brief:
          "Compare delivery models using dated evidence. Audience: Australian B2B marketing leaders.",
      },
    ),
  );
}
function writing() {
  return moveStage(
    addEvidence(approved(), {
      title: "Source",
      url: "https://example.com/research",
      note: "Manual research note.",
    }),
    "writing",
  );
}
function drafted() {
  return updateArticle(writing(), {
    body: "## Evaluate the delivery model\n\nCheck who owns research, editing and measurement before choosing a partner.",
  });
}

NodeTest.test("brief approval is required before research, writing and draft changes", () => {
  const article = createArticle({ title: "Test", keyword: "", format: "General Blog" });
  NodeAssert.throws(() => approveBrief(article), /keyword and brief/);
  NodeAssert.throws(() => moveStage(article, "research"), /Approve/);
  NodeAssert.throws(() => updateArticle(article, { body: "Unapproved draft" }), /Approve/);
  NodeAssert.throws(() => moveStage(approved(), "writing"), /research source/);
});

NodeTest.test(
  "brief scope changes invalidate approval and retain downstream work for recovery",
  () => {
    const article = drafted();
    for (const patch of [
      { brief: "New scope" },
      { keyword: "new term" },
      { title: "New title" },
      { format: "Listicle" as const },
    ]) {
      const next = updateArticle(article, patch);
      NodeAssert.equal(next.approvedBrief, null);
      NodeAssert.equal(next.stage, "brief");
      NodeAssert.equal(next.body, article.body);
      NodeAssert.throws(() => moveStage(next, "review"), /Approve/);
    }
  },
);

NodeTest.test(
  "draft checks distinguish preliminary passes from unrun full editorial audits",
  () => {
    const article = runChecks(drafted());
    NodeAssert.ok(article.checks);
    NodeAssert.equal(article.checks.issues.filter((issue) => issue.status === "fail").length, 0);
    NodeAssert.equal(
      article.checks.issues.find((issue) => issue.id === "publish-gate")?.status,
      "manual",
    );
    NodeAssert.equal(
      article.checks.issues.find((issue) => issue.id === "quality")?.status,
      "manual",
    );
    NodeAssert.equal(moveStage(article, "handover").stage, "handover");
    NodeAssert.match(exportMarkdown(article), /Not approved for publication/);
  },
);

NodeTest.test("failed and stale checks cannot be used for handover", () => {
  const bad = runChecks(updateArticle(writing(), { body: "## Test\nIR uses em dashes — here." }));
  NodeAssert.throws(() => moveStage(bad, "handover"), /Resolve failed checks/);
  const handed = moveStage(runChecks(drafted()), "handover");
  const revised = updateArticle(handed, { body: "## Revised\nNew content." });
  NodeAssert.equal(revised.stage, "writing");
  NodeAssert.equal(revised.checks, null);
  NodeAssert.throws(() => moveStage(revised, "handover"), /Run draft checks/);
});

NodeTest.test(
  "research updates invalidate checks and removing the final source returns to research",
  () => {
    const article = moveStage(runChecks(drafted()), "handover");
    const next = removeEvidence(article, article.evidence[0]!.id);
    NodeAssert.equal(next.stage, "research");
    NodeAssert.equal(next.checks, null);
    NodeAssert.equal(next.body, article.body);
    NodeAssert.equal(revokeApproval(article).stage, "brief");
  },
);

NodeTest.test("source URLs are safe external links and never implied verified", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/test",
    "https://user:password@example.com",
    "not a URL",
  ]) {
    NodeAssert.throws(() => addEvidence(approved(), { url, title: "Source", note: "" }));
  }
  NodeAssert.equal(writing().evidence[0]?.verified, false);
});

NodeTest.test("format-specific gate is not incorrectly applied to all formats", () => {
  const article = updateArticle(drafted(), { format: "General Blog" });
  const checked = runChecks(approveBrief(article));
  NodeAssert.equal(
    checked.checks?.issues.find((issue) => issue.id === "publish-gate")?.label,
    "Format-specific editorial review",
  );
});
