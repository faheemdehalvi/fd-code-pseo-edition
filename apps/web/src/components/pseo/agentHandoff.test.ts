import { describe, expect, it } from "vite-plus/test";
import { buildPseoAgentPrompt } from "./agentHandoff";
import { createArticle, createWorkspace, approveBrief, updateArticle } from "@fdcode/shared/pseo";

describe("pSEO agent handoff", () => {
  it("preserves the unapproved brief gate even if a stale article stage says writing", () => {
    const article = {
      ...createArticle({
        title: "Partner selection",
        keyword: "content partner",
        format: "Comparison",
      }),
      stage: "writing" as const,
    };
    const prompt = buildPseoAgentPrompt(createWorkspace(), article);
    expect(prompt).toContain("Do not write the article before the user approves");
    expect(prompt).toContain("Brief approval: Not approved");
    expect(prompt).not.toContain("Help write this article from the approved brief");
  });

  it("includes the approved scope and manually supplied evidence without treating it as verified", () => {
    const article = approveBrief(
      updateArticle(
        createArticle({
          title: "Partner selection",
          keyword: "content partner",
          format: "Comparison",
        }),
        { brief: "Compare delivery models using dated evidence." },
      ),
    );
    const prompt = buildPseoAgentPrompt(createWorkspace(), {
      ...article,
      evidence: [
        {
          id: "source",
          title: "Research source",
          url: "https://example.com/research",
          note: "A claim to verify",
          verified: false,
        },
      ],
    });
    expect(prompt).toContain("Brief approval: Approved by user");
    expect(prompt).toContain("https://example.com/research");
    expect(prompt).toContain("Manually attached research (not live-verified)");
    expect(prompt).toContain("Do not invent SEO measurements");
  });

  it("routes optional media to discovered ARTsie tools and identifies host boundaries", () => {
    const prompt = buildPseoAgentPrompt(
      createWorkspace(),
      createArticle({ title: "Article", keyword: "query", format: "General Blog" }),
    );
    expect(prompt).toContain("If this article needs images");
    expect(prompt).toContain("Discover the available apps and exact native schemas first");
    expect(prompt).toContain("primary FD CODE host");
    expect(prompt).toContain("verify exported files before claiming completion");
    expect(prompt).toContain("save edits with the native t3_pseo tools");
    expect(prompt).toContain("Do not publish");
  });
});
