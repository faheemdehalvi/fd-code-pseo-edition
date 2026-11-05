import { BETA_APP_CHAT_THREAD_PREFIX, type ScopedThreadRef } from "@fdcode/contracts";

export type PseoChatRouteAction = "none" | "adopt" | "close";

/**
 * Opening the chat sets its ref right after navigating, which can land before the route commits.
 * Only a route change after the chat was on screen means the user left it.
 */
export function resolvePseoChatRouteAction(input: {
  open: boolean;
  chatRef: ScopedThreadRef | null;
  routeThreadRef: ScopedThreadRef | null;
  reachedChat: boolean;
}): PseoChatRouteAction {
  const { open, chatRef, routeThreadRef, reachedChat } = input;
  if (!open || !chatRef) return "none";
  if (!routeThreadRef) return reachedChat ? "close" : "none";
  if (routeThreadRef.environmentId !== chatRef.environmentId) return reachedChat ? "close" : "none";
  if (routeThreadRef.threadId === chatRef.threadId) return "none";
  if (routeThreadRef.threadId.startsWith(BETA_APP_CHAT_THREAD_PREFIX.pseo)) return "adopt";
  return reachedChat ? "close" : "none";
}
