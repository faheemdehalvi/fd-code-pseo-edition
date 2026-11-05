export const formats = ["General Blog", "Comparison", "Alternatives", "Listicle"] as const;
export const stages = ["brief", "research", "writing", "review", "handover"] as const;
export type Evidence = { id: string; url: string; title: string; note: string; verified: boolean };
export type CheckRun = {
  body: string;
  issues: { id: string; label: string; status: "pass" | "fail" | "manual"; detail: string }[];
  at: string;
};
export type Article = {
  id: string;
  title: string;
  keyword: string;
  format: (typeof formats)[number];
  stage: (typeof stages)[number];
  brief: string;
  body: string;
  approvedBrief: string | null;
  evidence: Evidence[];
  checks: CheckRun | null;
  activity: { id: string; at: string; message: string }[];
  updatedAt: string;
};
export type Workspace = {
  version: 1;
  client: { name: string; domain: string; audience: string };
  articles: Article[];
  selectedId: string | null;
};

function newRecordId(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function record(article: Article, message: string): Article {
  const at = new Date().toISOString();
  return {
    ...article,
    updatedAt: at,
    activity: [{ id: newRecordId(), at, message }, ...article.activity],
  };
}

export function createArticle(input: {
  title: string;
  keyword: string;
  format: Article["format"];
}): Article {
  if (!input.title.trim()) throw new Error("Give the article a title.");
  if (!formats.includes(input.format)) throw new Error("Choose a supported article format.");
  return record(
    {
      id: newRecordId(),
      title: input.title.trim(),
      keyword: input.keyword.trim(),
      format: input.format,
      stage: "brief",
      brief: "",
      body: "",
      approvedBrief: null,
      evidence: [],
      checks: null,
      activity: [],
      updatedAt: "",
    },
    "Article created. Prepare a brief for approval.",
  );
}

export function createWorkspace(): Workspace {
  return {
    version: 1,
    client: { name: "My workspace", domain: "", audience: "" },
    articles: [],
    selectedId: null,
  };
}

export function updateArticle(
  article: Article,
  patch: Partial<Pick<Article, "title" | "keyword" | "format" | "brief" | "body">>,
): Article {
  if (patch.title !== undefined && !patch.title.trim())
    throw new Error("Article title cannot be empty.");
  if (patch.format !== undefined && !formats.includes(patch.format))
    throw new Error("Unsupported format.");
  const changed = Object.entries(patch).some(
    ([key, value]) => article[key as keyof Article] !== value,
  );
  if (!changed) return article;
  if (
    patch.body !== undefined &&
    patch.body !== article.body &&
    (article.approvedBrief === null ||
      article.approvedBrief !== article.brief ||
      article.stage === "brief" ||
      article.stage === "research")
  ) {
    throw new Error(
      "Approve the brief, add research and move to writing before editing the draft.",
    );
  }
  const briefChanged = (["title", "keyword", "format", "brief"] as const).some(
    (key) => patch[key] !== undefined && patch[key] !== article[key],
  );
  const next = { ...article, ...patch, checks: null, updatedAt: new Date().toISOString() };
  if (briefChanged && article.approvedBrief !== null) {
    return record(
      { ...next, approvedBrief: null, stage: "brief" },
      "Brief changed. Approval revoked; downstream work requires reapproval.",
    );
  }
  if (patch.body !== undefined && (article.stage === "review" || article.stage === "handover")) {
    return record({ ...next, stage: "writing" }, "Draft changed. Editorial checks must run again.");
  }
  return next;
}

export function approveBrief(article: Article): Article {
  if (!article.brief.trim() || !article.keyword.trim())
    throw new Error("Add a target keyword and brief before approving.");
  return record(
    { ...article, approvedBrief: article.brief, stage: "research", checks: null },
    "Brief approved by you. Research is unlocked.",
  );
}

export function revokeApproval(article: Article): Article {
  return record(
    { ...article, approvedBrief: null, stage: "brief", checks: null },
    "Brief approval revoked by you.",
  );
}

export function moveStage(article: Article, stage: Article["stage"]): Article {
  if (!stages.includes(stage)) throw new Error("Unknown workflow stage.");
  if (stage === "brief") return revokeApproval(article);
  if (article.approvedBrief === null || article.approvedBrief !== article.brief)
    throw new Error("Approve the current brief before continuing.");
  if (["writing", "review", "handover"].includes(stage) && article.evidence.length === 0) {
    throw new Error("Add a research source before writing.");
  }
  if (["review", "handover"].includes(stage) && !article.body.trim())
    throw new Error("Write a draft before editorial review.");
  if (stage === "handover") {
    if (!article.checks || article.checks.body !== article.body)
      throw new Error("Run draft checks before handover.");
    if (article.checks.issues.some((issue) => issue.status === "fail"))
      throw new Error("Resolve failed checks before handover.");
  }
  if (stage === article.stage) return article;
  return record(
    { ...article, stage },
    stage === "handover"
      ? "Prepared for human editorial review. This is not approval to publish."
      : `Moved to ${stage}.`,
  );
}

export function addEvidence(
  article: Article,
  input: { url: string; title: string; note: string },
): Article {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error("Enter a complete source URL.");
  }
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Sources must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("Do not include credentials in a source URL.");
  if (!input.title.trim()) throw new Error("Give the source a title.");
  return record(
    {
      ...article,
      checks: null,
      stage: article.stage === "handover" ? "review" : article.stage,
      evidence: [
        ...article.evidence,
        {
          id: newRecordId(),
          url: url.href,
          title: input.title.trim(),
          note: input.note.trim(),
          verified: false,
        },
      ],
    },
    "Research source added manually. Live verification is still required.",
  );
}

export function removeEvidence(article: Article, id: string): Article {
  const evidence = article.evidence.filter((item) => item.id !== id);
  if (evidence.length === article.evidence.length) return article;
  return record(
    {
      ...article,
      evidence,
      checks: null,
      stage:
        evidence.length === 0 && article.approvedBrief !== null
          ? "research"
          : article.stage === "handover"
            ? "review"
            : article.stage,
    },
    "Research source removed. Editorial checks invalidated.",
  );
}

export function runChecks(article: Article): Article {
  if (article.approvedBrief === null || article.approvedBrief !== article.brief)
    throw new Error("Approve the current brief before running checks.");
  if (!article.body.trim()) throw new Error("Add a draft before running checks.");
  const issues: CheckRun["issues"] = [];
  const check = (id: string, label: string, ok: boolean, detail: string) =>
    issues.push({ id, label, status: ok ? "pass" : "fail", detail });
  check(
    "evidence",
    "Research sources attached",
    article.evidence.length > 0,
    "Attached sources are manually supplied; their claims and links still need human verification.",
  );
  check(
    "dashes",
    "No em dashes",
    !article.body.includes("—"),
    "The writing playbook excludes em dashes.",
  );
  check(
    "brand",
    "Brand written in full",
    !/\bIR\b/.test(article.body),
    "Use “Intelligent Resourcing” in full.",
  );
  check(
    "sections",
    "Draft has section headings",
    /^##\s+\S/m.test(article.body),
    "Use Markdown H2 headings to organise the article.",
  );
  const comparison = ["Comparison", "Alternatives"].includes(article.format);
  issues.push({
    id: "publish-gate",
    label: comparison ? "34-item publish gate" : "Format-specific editorial review",
    status: "manual",
    detail: comparison
      ? "Not automated yet. All 27 checks and 7 judgment items require review; the checks above are only a preliminary subset."
      : "A human editor must check the draft against its format playbook.",
  });
  issues.push({
    id: "quality",
    label: "Content quality audit / 70",
    status: "manual",
    detail:
      "Not run. Readability, humaniser, AI writing tells and vocabulary require the full audit. No score is inferred.",
  });
  issues.push({
    id: "claims",
    label: "Claims and live links",
    status: "manual",
    detail:
      "Verify source contents, dates, statistics, competitor facts and every internal link before publication.",
  });
  return record(
    { ...article, checks: { body: article.body, issues, at: new Date().toISOString() } },
    "Preliminary draft checks run. Full publish gate and quality audit still require human review.",
  );
}

export function exportMarkdown(article: Article): string {
  return [
    `# ${article.title}`,
    "",
    `Target keyword: ${article.keyword}`,
    `Format: ${article.format}`,
    `Workflow stage: ${article.stage}`,
    "Status: Working draft for human review. Not approved for publication.",
    "",
    "## Content brief",
    "",
    article.brief,
    "",
    "---",
    "",
    article.body,
    "",
    "---",
    "",
    "## Research sources (manually supplied, not live-verified)",
    "",
    ...article.evidence.map((item) => `- ${item.title}: ${item.url}\n  ${item.note}`),
    "",
  ].join("\n");
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === "string");
}

export function parseWorkspace(raw: string): Workspace {
  const value: unknown = JSON.parse(raw);
  if (!object(value)) throw new Error("This saved workspace has an unsupported format.");
  // oxlint-disable-next-line fd-code/no-rpc-permission-bypass -- Saved client profile data, not an RPC client.
  const clientProfile = value.client;
  if (
    value.version !== 1 ||
    !object(clientProfile) ||
    !strings(clientProfile, ["name", "domain", "audience"]) ||
    !Array.isArray(value.articles) ||
    !(value.selectedId === null || typeof value.selectedId === "string")
  ) {
    throw new Error("This saved workspace has an unsupported format.");
  }
  const ids = new Set<string>();
  for (const article of value.articles) {
    if (
      !object(article) ||
      !strings(article, ["id", "title", "keyword", "brief", "body", "updatedAt"]) ||
      !formats.some((format) => format === article.format) ||
      !stages.some((stage) => stage === article.stage) ||
      !(article.approvedBrief === null || typeof article.approvedBrief === "string") ||
      !Array.isArray(article.evidence) ||
      !Array.isArray(article.activity)
    ) {
      throw new Error("A saved article is incomplete.");
    }
    const id = article.id as string;
    if (ids.has(id)) throw new Error("Saved articles have duplicate identifiers.");
    ids.add(id);
    if (
      article.stage !== "brief" &&
      (article.approvedBrief === null || article.approvedBrief !== article.brief)
    ) {
      throw new Error("A saved article has no valid brief approval.");
    }
    for (const evidence of article.evidence) {
      if (
        !object(evidence) ||
        !strings(evidence, ["id", "url", "title", "note"]) ||
        typeof evidence.verified !== "boolean"
      ) {
        throw new Error("A saved research source is incomplete.");
      }
      const url = new URL(evidence.url as string);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw new Error("A saved source has an invalid URL.");
    }
    if (
      !article.activity.every((entry) => object(entry) && strings(entry, ["id", "at", "message"]))
    ) {
      throw new Error("Saved activity has an unsupported format.");
    }
    if (article.checks !== null) {
      const checks = article.checks;
      if (
        !object(checks) ||
        !strings(checks, ["body", "at"]) ||
        !Array.isArray(checks.issues) ||
        !checks.issues.every(
          (issue) =>
            object(issue) &&
            strings(issue, ["id", "label", "detail"]) &&
            ["pass", "fail", "manual"].includes(String(issue.status)),
        )
      ) {
        throw new Error("Saved editorial checks have an unsupported format.");
      }
    }
  }
  if (value.selectedId !== null && !ids.has(value.selectedId as string))
    throw new Error("The selected article does not exist.");
  return value as Workspace;
}
