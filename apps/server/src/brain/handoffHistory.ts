import type {
  OrchestrationV2ContextHandoff,
  OrchestrationV2HistoricalMessage,
} from "@fdcode/contracts";

const USER_CHARS = 1_200;
const REPLY_CHARS = 2_000;
const FILE_NAMES = 30;

const clipped = (message: OrchestrationV2HistoricalMessage, limit: number) =>
  message.text.length <= limit
    ? message
    : {
        ...message,
        text: `${message.text.slice(0, limit)}\n[clipped ${message.text.length - limit} chars; full text: t3_thread_read itemId=${message.itemId}]`,
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

export function retrievableHandoffs(handoffs: ReadonlyArray<OrchestrationV2ContextHandoff>) {
  return handoffs.map((handoff) => {
    const history = handoff.history;
    if (history === undefined) return handoff;
    const { messages, files } = capsule(history.messages);
    const included = new Set(messages.map((message) => message.itemId));
    const omitted = history.messages.filter((message) => !included.has(message.itemId));
    return {
      ...handoff,
      history: {
        ...history,
        coverage: [
          history.coverage,
          "Compact capsule: first goal, latest requests, latest reply and plan. Earlier turns and tool output stay in Brain.",
          ...(files.length === 0 ? [] : [`Files touched: ${files.join(", ")}`]),
        ].join("\n"),
        messages,
        omittedItems: history.omittedItems + omitted.length,
        omittedItemIds: [
          ...new Set([
            ...(history.omittedItemIds ?? []),
            ...omitted.map((message) => message.itemId),
          ]),
        ],
      },
    };
  });
}
