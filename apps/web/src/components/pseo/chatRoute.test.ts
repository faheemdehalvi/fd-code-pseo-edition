import { describe, expect, it } from "vite-plus/test";
import type { ScopedThreadRef } from "@fdcode/contracts";

import { resolvePseoChatRouteAction } from "./chatRoute";

const ref = (threadId: string) =>
  ({ environmentId: "env", threadId }) as unknown as ScopedThreadRef;
const chat = ref("pseo-chat-1");
const other = ref("thread-a");

describe("resolvePseoChatRouteAction", () => {
  it("keeps the workspace open while navigation to the chat is still committing", () => {
    expect(
      resolvePseoChatRouteAction({
        open: true,
        chatRef: chat,
        routeThreadRef: other,
        reachedChat: false,
      }),
    ).toBe("none");
  });

  it("closes once the user leaves a chat that was on screen", () => {
    expect(
      resolvePseoChatRouteAction({
        open: true,
        chatRef: chat,
        routeThreadRef: other,
        reachedChat: true,
      }),
    ).toBe("close");
  });

  it("adopts another pSEO chat instead of closing", () => {
    expect(
      resolvePseoChatRouteAction({
        open: true,
        chatRef: chat,
        routeThreadRef: ref("pseo-chat-2"),
        reachedChat: true,
      }),
    ).toBe("adopt");
  });
});
