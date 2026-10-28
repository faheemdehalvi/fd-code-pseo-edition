import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { createWorkspace, createArticle } from "./model.ts";
import { loadWorkspace, saveWorkspace, parseWorkspace, STORAGE_KEY } from "./storage.ts";

NodeTest.test("empty storage starts without fabricated client or SEO data", () => {
  NodeAssert.deepEqual(
    loadWorkspace({ getItem: () => null, setItem: () => {} }),
    createWorkspace(),
  );
});

NodeTest.test("workspace survives a save/reload with independent article drafts", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const articles = [
    createArticle({ title: "First", keyword: "one", format: "Listicle" }),
    createArticle({ title: "Second", keyword: "two", format: "Comparison" }),
  ];
  const workspace = { ...createWorkspace(), articles, selectedId: articles[1]!.id };
  saveWorkspace(storage, workspace);
  NodeAssert.deepEqual(loadWorkspace(storage), workspace);
});

NodeTest.test("corrupt and unsupported storage is reported without being overwritten", () => {
  for (const raw of [
    "{broken",
    '{"version":2}',
    JSON.stringify({ ...createWorkspace(), selectedId: "missing" }),
  ]) {
    let writes = 0;
    NodeAssert.throws(() =>
      loadWorkspace({
        getItem: () => raw,
        setItem: () => {
          writes++;
        },
      }),
    );
    NodeAssert.equal(writes, 0);
  }
});

NodeTest.test("quota errors propagate so the interface can warn about unsaved changes", () => {
  NodeAssert.throws(
    () =>
      saveWorkspace(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("Quota exceeded");
          },
        },
        createWorkspace(),
      ),
    /Quota/,
  );
});

NodeTest.test("restored articles cannot bypass approval or introduce script URLs", () => {
  const article = createArticle({ title: "Title", keyword: "term", format: "General Blog" });
  const raw = (patch: object) =>
    JSON.stringify({
      ...createWorkspace(),
      articles: [{ ...article, ...patch }],
      selectedId: article.id,
    });
  NodeAssert.throws(() => parseWorkspace(raw({ stage: "writing" })), /approval/);
  NodeAssert.throws(
    () =>
      parseWorkspace(
        raw({
          evidence: [
            { id: "x", title: "x", url: "javascript:alert(1)", note: "", verified: false },
          ],
        }),
      ),
    /URL/,
  );
  NodeAssert.equal(STORAGE_KEY, "fdcode:pseo:workspace:v1");
});
