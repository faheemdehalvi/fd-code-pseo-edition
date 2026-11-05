import { useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardList,
  Download,
  FileText,
  Layers,
  Link2,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  addEvidence,
  parseWorkspace,
  approveBrief,
  createArticle,
  exportMarkdown,
  moveStage,
  removeEvidence,
  revokeApproval,
  runChecks,
  updateArticle,
  type Article,
  type Workspace,
} from "@fdcode/shared/pseo";
import styles from "./styles.module.css";

function classes(names: string): string {
  return names
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => styles[name] ?? name)
    .join(" ");
}

type Props = {
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
  storageError: string | null;
  hostActions?: ReactNode;
};
const stages: Article["stage"][] = ["brief", "research", "writing", "review", "handover"];
const formats: Article["format"][] = ["General Blog", "Comparison", "Alternatives", "Listicle"];
const stageNames = {
  brief: "Brief",
  research: "Research",
  writing: "Writing",
  review: "Review",
  handover: "Handover",
};

function Preview({ body }: { body: string }) {
  if (!body.trim())
    return (
      <div className={classes("empty-draft")}>
        <BookOpen size={32} />
        <h2>Your next useful article starts here.</h2>
        <p>
          Approve the brief, collect your evidence, then write a draft grounded in what you know.
        </p>
      </div>
    );
  return (
    <div className={classes("draft-preview")}>
      <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
    </div>
  );
}

export function App({ workspace, onChange, storageError, hostActions }: Props) {
  // oxlint-disable-next-line fd-code/no-rpc-permission-bypass -- Client profile data, not an RPC client.
  const clientProfile = workspace.client;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"brief" | "draft" | "preview">("brief");
  const [panel, setPanel] = useState<"evidence" | "checks" | "activity">("evidence");
  const [modal, setModalValue] = useState<"article" | "settings" | "connections" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceForm, setSourceForm] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [titleEdit, setTitleEdit] = useState<{ id: string; value: string } | null>(null);
  const article =
    workspace.articles.find((item) => item.id === workspace.selectedId) ?? workspace.articles[0];
  const titleDraft =
    titleEdit?.id === article?.id ? (titleEdit?.value ?? "") : (article?.title ?? "");
  const setTitleDraft = (value: string) => setTitleEdit(article ? { id: article.id, value } : null);
  const setModal = (next: typeof modal) => {
    setModalError(null);
    setModalValue(next);
  };
  const filtered = workspace.articles.filter((item) =>
    `${item.title} ${item.keyword}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pending = workspace.articles.filter((item) => item.stage === "brief").length;
  const patch = (transform: (article: Article) => Article) => {
    if (!article) return false;
    try {
      const next = transform(article);
      onChange({
        ...workspace,
        articles: workspace.articles.map((item) => (item.id === next.id ? next : item)),
      });
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "This action could not be completed.");
      return false;
    }
  };
  const change = (values: Parameters<typeof updateArticle>[1]) =>
    patch((current) => updateArticle(current, values));
  const download = () => {
    if (!article) return;
    const url = URL.createObjectURL(
      new Blob([exportMarkdown(article)], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${article.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "article"}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const backup = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "pseo-workspace-backup.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canWrite =
    article?.approvedBrief !== null && article?.stage !== "brief" && article?.stage !== "research";
  const wordCount = article?.body.trim().split(/\s+/).filter(Boolean).length ?? 0;

  return (
    <div className={classes(`pseo-app${hostActions ? " pseo-embedded" : ""}`)}>
      <aside className={classes("sidebar")}>
        <a className={classes("brand")} href="#">
          <span className={classes("brand-icon")}>
            <Layers size={21} />
          </span>
          <span>
            pSEO<span className={classes("brand-edition")}>STUDIO</span>
          </span>
          <span className={classes("beta")}>EARLY BUILD</span>
        </a>
        <button className={classes("workspace-switch")} onClick={() => setModal("settings")}>
          <span className={classes("client-avatar")}>
            {clientProfile.name.slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{clientProfile.name}</strong>
            <small>Client workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className={classes("side-section-label")}>WORKSPACE</div>
        <div className={classes("nav-selected")}>
          <ClipboardList size={17} />
          <span>Content queue</span>
          <span className={classes("nav-count")}>{workspace.articles.length}</span>
        </div>
        <button className={classes("side-link")} onClick={() => setModal("connections")}>
          <Link2 size={17} />
          <span>Connections</span>
          <span className={classes("connection-dot")} />
        </button>
        <div className={classes("queue-heading")}>
          <span>YOUR ARTICLES</span>
          <button
            className={classes("icon-button")}
            aria-label="New article"
            onClick={() => setModal("article")}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className={classes("queue-search")}>
          <Search size={14} />
          <input
            aria-label="Search articles"
            placeholder="Find an article…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>⌕</kbd>
        </div>
        <div className={classes("article-list")}>
          {filtered.map((item) => (
            <button
              key={item.id}
              className={classes(`article-item ${article?.id === item.id ? "active" : ""}`)}
              onClick={() => {
                onChange({ ...workspace, selectedId: item.id });
                setSourceForm(false);
                setTitleEdit(null);
                setError(null);
              }}
            >
              <FileText size={16} />
              <span>
                <strong>{item.title}</strong>
                <small>
                  <span className={classes(`stage-dot ${item.stage}`)} />
                  {stageNames[item.stage]}
                  <span className={classes("item-format")}>{item.format}</span>
                </small>
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className={classes("empty-queue")}>
              {search ? "No matching articles." : "Add your first article to get started."}
            </p>
          )}
        </div>
        <button className={classes("new-article")} onClick={() => setModal("article")}>
          <Plus size={16} /> New article
        </button>
        <div className={classes("sidebar-bottom")}>
          <div className={classes("local-note")}>
            <span className={classes("local-dot")} />
            <span>
              {hostActions ? "Shared workspace" : "Local workspace"}
              <small>{hostActions ? "Saved with FD CODE" : "Saved in this browser"}</small>
            </span>
          </div>
          <button
            className={classes("icon-button")}
            aria-label="Workspace settings"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </aside>

      <main className={classes("main-area")}>
        <header className={classes("topbar")}>
          <div className={classes("breadcrumb")}>
            Workspace <ChevronRight size={13} />
            <strong>Content studio</strong>
          </div>
          <div className={classes("topbar-right")}>
            {hostActions && <div className={classes("host-actions")}>{hostActions}</div>}
            <span className={classes("manual-badge")}>
              <Circle size={10} /> Manual workflow
            </span>
            <button className={classes("text-button")} onClick={backup}>
              <Download size={14} /> Backup
            </button>
            <button className={classes("text-button")} onClick={() => setModal("connections")}>
              <Link2 size={14} /> Connect tools
            </button>
          </div>
        </header>
        <div className={classes("workspace-heading")}>
          <div>
            <div className={classes("eyebrow")}>FROM OPPORTUNITY TO ORIGINAL CONTENT</div>
            <h1>
              Make every article <em>count.</em>
            </h1>
            <p>A focused workspace for briefs, evidence and content worth publishing.</p>
          </div>
          <div className={classes("queue-summary")}>
            <strong>{pending.toString().padStart(2, "0")}</strong>
            <span>
              briefs awaiting
              <br />
              your approval
            </span>
          </div>
        </div>
        {(storageError || error) && (
          <div className={classes("error-banner")} role="alert">
            {storageError || error}
            <button
              className={classes("icon-button")}
              aria-label="Dismiss action error"
              onClick={() => setError(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {article ? (
          <div className={classes("studio")}>
            <section className={classes("document-area")}>
              <div className={classes("document-header")}>
                <label className={classes("format-pill")}>
                  <FileText size={13} />
                  <select
                    aria-label="Article format"
                    value={article.format}
                    onChange={(e) => change({ format: e.target.value as Article["format"] })}
                  >
                    {formats.map((format) => (
                      <option key={format}>{format}</option>
                    ))}
                  </select>
                </label>
                <button className={classes("text-button")} onClick={download}>
                  <Download size={14} /> Export .md
                </button>
              </div>
              <input
                className={classes("article-title")}
                aria-label="Article title"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  if (!patch((current) => updateArticle(current, { title: titleDraft })))
                    setTitleDraft(article.title);
                }}
                placeholder="Untitled article"
              />
              <div className={classes("article-meta")}>
                <label>
                  Target query{" "}
                  <input
                    aria-label="Target query"
                    value={article.keyword}
                    placeholder="Add a target query"
                    onChange={(e) => change({ keyword: e.target.value })}
                  />
                </label>
                <span className={classes("unmeasured")}>SEO data not connected</span>
              </div>
              <div className={classes("pipeline")} aria-label="Article workflow">
                {stages.map((stage, index) => (
                  <button
                    key={stage}
                    className={classes(
                      `pipeline-step ${article.stage === stage ? "current" : ""} ${stages.indexOf(article.stage) > index ? "complete" : ""}`,
                    )}
                    onClick={() => patch((current) => moveStage(current, stage))}
                    aria-current={article.stage === stage ? "step" : undefined}
                  >
                    <span className={classes("step-circle")}>
                      {stages.indexOf(article.stage) > index ? <Check size={11} /> : index + 1}
                    </span>
                    {stageNames[stage]}
                    {index < stages.length - 1 && (
                      <ChevronRight className={classes("step-arrow")} size={12} />
                    )}
                  </button>
                ))}
              </div>
              <div className={classes("document-tabs")}>
                <div role="tablist" aria-label="Document view">
                  {(["brief", "draft", "preview"] as const).map((view) => (
                    <button
                      role="tab"
                      aria-selected={tab === view}
                      key={view}
                      className={classes(tab === view ? "selected" : "")}
                      onClick={() => setTab(view)}
                    >
                      {view === "brief" ? "Content brief" : view === "draft" ? "Draft" : "Preview"}
                      {view === "brief" && article.approvedBrief !== null && <Check size={12} />}
                    </button>
                  ))}
                </div>
                <span className={classes("document-save")}>
                  <span />
                  {storageError
                    ? "Save unavailable"
                    : hostActions
                      ? "Workspace autosave"
                      : "Local autosave"}
                </span>
              </div>
              <div className={classes("document-content")}>
                {article.stage === "handover" && (
                  <div className={classes("inline-notice")}>
                    Prepared for human editorial review. This article is not approved for
                    publication.
                  </div>
                )}
                {tab === "brief" && (
                  <>
                    <div
                      className={classes(
                        `approval-notice ${article.approvedBrief !== null ? "approved" : ""}`,
                      )}
                    >
                      <ShieldCheck size={19} />
                      <div>
                        <strong>
                          {article.approvedBrief !== null
                            ? "Brief approved"
                            : "Your sign-off comes first"}
                        </strong>
                        <p>
                          {article.approvedBrief !== null
                            ? "Research is unlocked. Add a source and move to Writing to edit the draft. Changing this brief requires a fresh approval."
                            : "Review the direction before moving into research or writing."}
                        </p>
                      </div>
                    </div>
                    <div className={classes("field-heading")}>
                      <label htmlFor="brief-editor">CONTENT DIRECTION</label>
                      <span>Markdown supported</span>
                    </div>
                    <textarea
                      id="brief-editor"
                      className={classes("brief-editor")}
                      value={article.brief}
                      onChange={(e) => change({ brief: e.target.value })}
                      placeholder={
                        "## Reader & problem\nWho is this for? What are they trying to solve?\n\n## Point of view\nWhat should they understand or do differently?\n\n## Structure\nOutline the questions this article will answer.\n\n## Evidence needed\nList the claims and sources to verify."
                      }
                    />
                    <div className={classes("approval-actions")}>
                      <span>
                        <ShieldCheck size={14} /> Human approval required
                      </span>
                      {article.approvedBrief !== null ? (
                        <button
                          className={classes("button secondary")}
                          onClick={() => patch(revokeApproval)}
                        >
                          Reopen brief
                        </button>
                      ) : (
                        <button
                          className={classes("button primary")}
                          onClick={() => patch(approveBrief)}
                        >
                          <CheckCheck size={16} /> Approve brief <ArrowRight size={15} />
                        </button>
                      )}
                    </div>
                  </>
                )}
                {tab === "draft" && (
                  <>
                    <div className={classes("field-heading")}>
                      <label htmlFor="draft-editor">ARTICLE DRAFT</label>
                      <span>Markdown</span>
                    </div>
                    {!canWrite && (
                      <div className={classes("inline-notice")}>
                        Approve the brief, add a research source, then select Writing in the
                        workflow to unlock editing.
                      </div>
                    )}
                    <textarea
                      id="draft-editor"
                      className={classes("body-editor")}
                      value={article.body}
                      disabled={!canWrite}
                      onChange={(e) => change({ body: e.target.value })}
                      placeholder="# Start with the reader’s problem\n\nWrite a direct answer, then build the case with verified evidence."
                    />
                  </>
                )}
                {tab === "preview" && <Preview body={article.body} />}
              </div>
              <footer className={classes("document-footer")}>
                <span>
                  {wordCount.toLocaleString()} words{" "}
                  <span className={classes("footer-divider")}>/</span> {article.evidence.length}{" "}
                  sources
                </span>
                <span>
                  {stageNames[article.stage]}{" "}
                  <span className={classes(`stage-dot ${article.stage}`)} />
                </span>
              </footer>
            </section>

            <aside className={classes("inspector")}>
              <div className={classes("inspector-heading")}>
                <span className={classes("inspector-icon")}>
                  <Sparkles size={16} />
                </span>
                <div>
                  <strong>Your working context</strong>
                  <small>Evidence before assertions.</small>
                </div>
              </div>
              <div className={classes("inspector-tabs")} role="tablist" aria-label="Context panel">
                {(["evidence", "checks", "activity"] as const).map((view) => (
                  <button
                    role="tab"
                    aria-selected={panel === view}
                    key={view}
                    className={classes(panel === view ? "selected" : "")}
                    onClick={() => setPanel(view)}
                  >
                    {view.charAt(0).toUpperCase() + view.slice(1)}
                  </button>
                ))}
              </div>
              <div className={classes("inspector-body")}>
                {panel === "evidence" && (
                  <>
                    <div className={classes("panel-label")}>
                      SOURCE LIBRARY{" "}
                      <span>{article.evidence.length.toString().padStart(2, "0")}</span>
                    </div>
                    <p className={classes("panel-description")}>
                      Keep the source and the claim together. Added links still need a human
                      fact-check.
                    </p>
                    {article.evidence.map((source) => (
                      <div className={classes("source-card")} key={source.id}>
                        <div className={classes("source-card-top")}>
                          <Link2 size={14} />
                          <span>{source.verified ? "Verified" : "Needs verification"}</span>
                          <button
                            className={classes("icon-button")}
                            aria-label={`Remove source ${source.title}`}
                            onClick={() => patch((current) => removeEvidence(current, source.id))}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {source.title || source.url}
                        </a>
                        <p>{source.note}</p>
                        <small>{new URL(source.url).hostname}</small>
                      </div>
                    ))}
                    {article.evidence.length === 0 && (
                      <div className={classes("evidence-empty")}>
                        <Link2 size={23} />
                        <strong>No sources yet</strong>
                        <p>
                          Add original research, client data or a primary source to support your
                          draft.
                        </p>
                      </div>
                    )}
                    {sourceForm ? (
                      <form
                        className={classes("source-form")}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          if (
                            patch((current) =>
                              addEvidence(current, {
                                url: String(data.get("url")),
                                title: String(data.get("title")),
                                note: String(data.get("note")),
                              }),
                            )
                          )
                            setSourceForm(false);
                        }}
                      >
                        <label>
                          Source title
                          <input name="title" required placeholder="Name the original source" />
                        </label>
                        <label>
                          URL
                          <input name="url" type="url" required placeholder="https://…" />
                        </label>
                        <label>
                          Claim or finding
                          <textarea
                            name="note"
                            required
                            placeholder="What does this source support?"
                          />
                        </label>
                        <div className={classes("form-actions")}>
                          <button
                            type="button"
                            className={classes("text-button")}
                            onClick={() => setSourceForm(false)}
                          >
                            Cancel
                          </button>
                          <button className={classes("button primary")} type="submit">
                            Add source
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button className={classes("add-source")} onClick={() => setSourceForm(true)}>
                        <Plus size={15} /> Add evidence
                      </button>
                    )}
                    <div className={classes("context-card")}>
                      <div className={classes("context-card-label")}>READER CONTEXT</div>
                      <strong>{clientProfile.audience || "Define your reader"}</strong>
                      <p>
                        Use workspace settings to keep every brief grounded in the right audience.
                      </p>
                    </div>
                  </>
                )}
                {panel === "checks" && (
                  <>
                    <div className={classes("panel-label")}>EDITORIAL PREFLIGHT</div>
                    <p className={classes("panel-description")}>
                      A focused set of local checks. This does not replace the full 34-item publish
                      gate or the quality audit out of 70.
                    </p>
                    <button
                      className={classes("button primary full-width")}
                      onClick={() => patch(runChecks)}
                    >
                      <ShieldCheck size={15} /> Run local checks
                    </button>
                    {article.checks && (
                      <div className={classes("check-results")}>
                        {article.checks.body !== article.body && (
                          <div className={classes("inline-notice")}>
                            Draft changed. Run checks again.
                          </div>
                        )}
                        {article.checks.issues.map((issue) => (
                          <div className={classes(`check-item ${issue.status}`)} key={issue.id}>
                            <span className={classes("check-status")}>
                              {issue.status === "pass" ? (
                                <Check size={14} />
                              ) : issue.status === "fail" ? (
                                <X size={14} />
                              ) : (
                                <Circle size={12} />
                              )}
                            </span>
                            <div>
                              <strong>{issue.label}</strong>
                              <p>{issue.detail}</p>
                              <small>
                                {issue.status === "manual"
                                  ? "Human review"
                                  : issue.status === "pass"
                                    ? "Passed"
                                    : "Needs attention"}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={classes("context-card")}>
                      <div className={classes("context-card-label")}>TWO SEPARATE STANDARDS</div>
                      <strong>Publish gate + quality audit</strong>
                      <p>
                        The format-specific pass/fail gate and the 70-point quality diagnostic will
                        be connected separately. No composite score or automatic publishing.
                      </p>
                    </div>
                  </>
                )}
                {panel === "activity" && (
                  <>
                    <div className={classes("panel-label")}>ARTICLE HISTORY</div>
                    <p className={classes("panel-description")}>
                      A local record of decisions and workflow changes.
                    </p>
                    <div className={classes("activity-list")}>
                      {article.activity.map((event) => (
                        <div className={classes("activity-item")} key={event.id}>
                          <span className={classes("activity-dot")} />
                          <div>
                            <strong>{event.message}</strong>
                            <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className={classes("inspector-footer")}>
                <span className={classes("small-orb")} />
                Built on FD CODE <span>pSEO v0.1</span>
              </div>
            </aside>
          </div>
        ) : (
          <div className={classes("welcome-empty")}>
            <Layers size={42} />
            <h2>A home for your next great article.</h2>
            <p>
              Create an article to begin with a brief, then bring your evidence and writing into one
              place.
            </p>
            <button className={classes("button primary")} onClick={() => setModal("article")}>
              <Plus size={16} /> Create first article
            </button>
          </div>
        )}
      </main>

      {modal && (
        <div
          className={classes("modal-backdrop")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={classes("modal")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setModal(null);
              if (e.key === "Tab") {
                const focusable = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button, input, select, textarea, a[href]",
                  ),
                ).filter((el) => !el.hasAttribute("disabled"));
                const first = focusable[0],
                  last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className={classes("modal-heading")}>
              <h2 id="modal-title">
                {modal === "article"
                  ? "A new article, a clear direction."
                  : modal === "settings"
                    ? "Workspace settings"
                    : "Connect your content stack"}
              </h2>
              <button
                className={classes("icon-button")}
                aria-label="Close dialog"
                onClick={() => setModal(null)}
              >
                <X size={19} />
              </button>
            </div>
            {modalError && (
              <div className={classes("inline-notice")} role="alert">
                {modalError}
              </div>
            )}
            {modal === "article" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  try {
                    const created = createArticle({
                      title: String(data.get("title")),
                      keyword: String(data.get("keyword")),
                      format: String(data.get("format")) as Article["format"],
                    });
                    onChange({
                      ...workspace,
                      articles: [...workspace.articles, created],
                      selectedId: created.id,
                    });
                    setModal(null);
                    setTab("brief");
                    setSourceForm(false);
                    setTitleEdit(null);
                  } catch (error) {
                    setModalError(
                      error instanceof Error ? error.message : "Could not create article.",
                    );
                  }
                }}
              >
                <p className={classes("modal-description")}>
                  Start with a target query. Nothing is generated or published automatically.
                </p>
                <label>
                  Working title
                  <input
                    name="title"
                    required
                    autoFocus
                    placeholder="What will this article help the reader do?"
                  />
                </label>
                <label>
                  Target query
                  <input name="keyword" required placeholder="e.g. B2B content strategy" />
                </label>
                <label>
                  Article format
                  <select name="format">
                    {formats.map((format) => (
                      <option key={format}>{format}</option>
                    ))}
                  </select>
                </label>
                <div className={classes("form-actions")}>
                  <button
                    type="button"
                    className={classes("button secondary")}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button className={classes("button primary")} type="submit">
                    Create article <ArrowRight size={15} />
                  </button>
                </div>
              </form>
            )}
            {modal === "settings" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  if (!String(data.get("name")).trim()) {
                    setModalError("Give the workspace a name.");
                    return;
                  }
                  onChange({
                    ...workspace,
                    client: {
                      name: String(data.get("name")).trim(),
                      domain: String(data.get("domain")),
                      audience: String(data.get("audience")),
                    },
                  });
                  setModal(null);
                }}
              >
                <p className={classes("modal-description")}>
                  This workspace is stored in this browser. It is not synced across devices.{" "}
                  <button type="button" className={classes("text-button")} onClick={backup}>
                    <Download size={13} /> Download backup
                  </button>
                </p>
                <label>
                  Restore workspace backup
                  <small>
                    Restoring replaces this workspace and first downloads a copy of the current one.
                  </small>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        const restored = parseWorkspace(await file.text());
                        backup();
                        onChange(restored);
                        setTitleEdit(null);
                        setSourceForm(false);
                        setSearch("");
                        setModal(null);
                      } catch (error) {
                        setModalError(
                          error instanceof Error ? error.message : "Could not restore this backup.",
                        );
                      }
                    }}
                  />
                </label>
                <label>
                  Client name
                  <input name="name" required autoFocus defaultValue={clientProfile.name} />
                </label>
                <label>
                  Website
                  <input
                    name="domain"
                    defaultValue={clientProfile.domain}
                    placeholder="example.com"
                  />
                </label>
                <label>
                  Primary audience
                  <textarea
                    name="audience"
                    defaultValue={clientProfile.audience}
                    placeholder="Who are we writing for?"
                  />
                </label>
                <div className={classes("form-actions")}>
                  <button
                    type="button"
                    className={classes("button secondary")}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button className={classes("button primary")} type="submit">
                    Save workspace
                  </button>
                </div>
              </form>
            )}
            {modal === "connections" && (
              <>
                <p className={classes("modal-description")}>
                  The workspace is ready for manual briefs and drafting. These data integrations are
                  planned and are not connected in this build.
                </p>
                {[
                  ...(!hostActions
                    ? [{ name: "FD CODE agents", detail: "Research, writing and review providers" }]
                    : []),
                  { name: "Google Search Console", detail: "Measured search performance" },
                  { name: "Ahrefs / DataForSEO", detail: "Keyword and SERP evidence" },
                  { name: "Webflow", detail: "Content inventory and editorial handover" },
                ].map((connection) => (
                  <div className={classes("integration-row")} key={connection.name}>
                    <span className={classes("integration-icon")}>
                      <Link2 size={18} />
                    </span>
                    <div>
                      <strong>{connection.name}</strong>
                      <small>{connection.detail}</small>
                    </div>
                    <span>Not connected</span>
                  </div>
                ))}
                <div className={classes("form-actions")}>
                  <button className={classes("button secondary")} onClick={() => setModal(null)}>
                    Back to workspace
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
