import type {
  OrchestrationV2ContextHandoff,
  OrchestrationV2HistoricalMessage,
} from "@fdcode/contracts";

const USER_CHARS = 2_400;
const REPLY_CHARS = 1_600;
const FILE_NAMES = 30;

const clipped = (message: OrchestrationV2HistoricalMessage, limit: number) => {
  if (message.text.length <= limit) return message;
  const head = Math.floor((limit * 2) / 3);
  const read = JSON.stringify({
    threadId: message.threadId,
    itemId: message.itemId,
    textOffset: 0,
    maxCharsPerItem: 4000,
  });
  const prefix = message.text.slice(0, head).replace(/[\uD800-\uDBFF]$/, "");
  const suffix = message.text.slice(-(limit - head)).replace(/^[\uDC00-\uDFFF]/, "");
  return {
    ...message,
    text: `${prefix}\n[clipped ${message.text.length - prefix.length - suffix.length} UTF-16 units; ${message.role === "user" ? "read the full request before acting" : "retrieve full text if needed"}: t3_thread_read(${read}); page textOffset=nextTextOffset until null]\n${suffix}`,
  };
};

// A model switch carries a capsule, not the transcript: the goal, the latest exchange, the
// current plan and the files touched. Everything else stays in Brain, where the new model
// pulls it on demand, so a switch costs a few thousand tokens however long the thread is.
function capsule(messages: ReadonlyArray<OrchestrationV2HistoricalMessage>) {
  const users = messages.filter((message) => message.kind === "user_message");
  const keep = new Map<string, OrchestrationV2HistoricalMessage>();
  for (const message of [users[0], ...users.slice(-2)])
    if (message !== undefined) keep.set(message.itemId, clipped(message, USER_CHARS));
  for (const kind of ["assistant_message", "proposed_plan"]) {
    const latest = messages.findLast((message) => message.kind === kind);
    if (latest !== undefined) keep.set(latest.itemId, clipped(latest, REPLY_CHARS));
  }
  // Short conversations keep every request, including corrections between the goal and tail.
  for (const message of users.toReversed()) {
    if (keep.has(message.itemId)) continue;
    const candidate = clipped(message, USER_CHARS);
    if (Buffer.byteLength(JSON.stringify([...keep.values(), candidate])) <= 12_000)
      keep.set(message.itemId, candidate);
  }
  const files = [
    ...new Set(
      messages
        .filter((message) => message.kind === "file_change")
        .map((message) => message.text.replace(/^File change: /, "")),
    ),
  ];
  return {
    messages: messages.flatMap((message) => keep.get(message.itemId) ?? []),
    files:
      files.length <= FILE_NAMES
        ? files
        : [...files.slice(-FILE_NAMES), `and ${files.length - FILE_NAMES} more`],
  };
}

export function retrievableHistory(history: NonNullable<OrchestrationV2ContextHandoff["history"]>) {
  // Delivery may recheck a prepared capsule against a smaller provider budget.
  if (history.coverage.includes("Compact capsule:")) return history;
  const { messages, files } = capsule(history.messages);
  const included = new Set(messages.map((message) => message.itemId));
  const omitted = history.messages.filter((message) => !included.has(message.itemId));
  const omittedRequests = omitted.filter((message) => message.kind === "user_message");
  return {
    ...history,
    coverage: [
      history.coverage,
      "Compact capsule: first goal, latest requests, latest reply and plan. Earlier turns and tool output remain in durable FD CODE history. Retrieve missing decisions or constraints before relying on them; assistant statements are not user approvals. Read any clipped user request in full before acting.",
      ...(omittedRequests.length === 0
        ? []
        : [
            `${omittedRequests.length} earlier user requests are omitted and may contain constraints. Before acting, inspect user history with t3_thread_read({threadId:${JSON.stringify(omittedRequests[0]!.threadId)},view:"messages",limit:20,maxCharsPerItem:4000}); paginate afterPosition=nextPosition. Omitted user item range: ${omittedRequests[0]!.itemId} through ${omittedRequests.at(-1)!.itemId}.`,
          ]),
      ...(files.length === 0 ? [] : [`Files touched: ${files.join(", ")}`]),
    ].join("\n"),
    messages,
    omittedItems: history.omittedItems + omitted.length,
    omittedItemIds: [
      ...new Set([...(history.omittedItemIds ?? []), ...omitted.map((message) => message.itemId)]),
    ],
  };
}

export function retrievableHandoffs(handoffs: ReadonlyArray<OrchestrationV2ContextHandoff>) {
  return handoffs.map((handoff) =>
    handoff.history === undefined
      ? handoff
      : {
          ...handoff,
          history: retrievableHistory(handoff.history),
        },
  );
}
