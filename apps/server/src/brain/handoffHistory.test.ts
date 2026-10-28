import { expect, it } from "vite-plus/test";
import {
  ThreadId,
  TurnItemId,
  type OrchestrationV2ContextHandoff,
  type OrchestrationV2HistoricalMessage,
} from "@fdcode/contracts";
import { retrievableHandoffs } from "./handoffHistory.ts";

const threadId = ThreadId.make("handoff-brain");
const item = (
  kind: string,
  id: string,
  text: string,
): OrchestrationV2HistoricalMessage => ({
  role: kind === "user_message" ? "user" : "assistant",
  kind,
  text,
  threadId,
  runId: null,
  itemId: TurnItemId.make(id),
  providerThreadId: null,
  status: "completed",
});
const handoff = (messages: ReadonlyArray<OrchestrationV2HistoricalMessage>) =>
  ({
    history: {
      messages,
      coverage: "Thread handoff",
      omittedItems: 1,
      omittedItemIds: [TurnItemId.make("earlier-omission")],
    },
  }) as unknown as OrchestrationV2ContextHandoff;

it("hands over a capsule and leaves the rest of a long thread retrievable", () => {
  const messages = [
    item("user_message", "goal", "Keep the migration local."),
    item("assistant_message", "old-answer", "Old reasoning ".repeat(500)),
    item("command_execution", "command", "very large process output".repeat(1_000)),
    item("file_change", "edit-a", "File change: src/a.ts"),
    item("user_message", "middle", "Middle request."),
    item("proposed_plan", "plan", "1. Outbox\n2. Tests"),
    item("user_message", "previous", "Previous request."),
    item("file_change", "edit-b", "File change: src/b.ts"),
    item("user_message", "latest", "Latest request."),
    item("assistant_message", "answer", `Use the SQLite outbox. ${"detail ".repeat(1_000)}`),
  ];
  const saved = handoff(messages);
  const history = retrievableHandoffs([saved])[0]!.history!;

  expect(history.messages.map((message) => message.itemId)).toEqual([
    "goal",
    "plan",
    "previous",
    "latest",
    "answer",
  ]);
  const answer = history.messages.at(-1)!.text;
  expect(answer).toContain("Use the SQLite outbox.");
  expect(answer).toContain("t3_thread_read itemId=answer");
  expect(answer.length).toBeLessThan(2_200);
  expect(history.coverage).toContain("Files touched: src/a.ts, src/b.ts");
  expect(history.coverage).toContain("Compact capsule");
  expect(history.omittedItems).toBe(6);
  expect(history.omittedItemIds).toEqual(
    expect.arrayContaining(["earlier-omission", "old-answer", "command", "middle"]),
  );
  expect(saved.history!.messages).toHaveLength(messages.length);
});

it("keeps every message of a short thread", () => {
  const messages = [
    item("user_message", "question", "Keep the migration local."),
    item("assistant_message", "answer", "Use the SQLite outbox."),
  ];
  const history = retrievableHandoffs([handoff(messages)])[0]!.history!;
  expect(history.messages).toEqual(messages);
  expect(history.omittedItems).toBe(1);
});
