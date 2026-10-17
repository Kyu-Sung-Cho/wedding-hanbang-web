import { describe, expect, it, vi } from "vitest";
import { createCohortMessageSendController } from "../cohortMessageRequest";

const input = { actorId: "actor-a", roomId: "room-a", content: "QA 합성 메시지", threadTopic: "chat" as const };

describe("cohort logical message request", () => {
  it("sends the API's UUID header and repeats the same key after an unknown result", async () => {
    const rows = new Map<string, string>();
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const key = new Headers(init?.headers).get("idempotency-key")!;
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      rows.set(key, String(init?.body));
      if (fetcher.mock.calls.length === 1) throw new TypeError("synthetic response lost");
      return Response.json({ message: { id: "saved-message" } });
    });
    const createKey = vi.fn().mockReturnValueOnce("10000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("10000000-0000-4000-8000-000000000002");
    const controller = createCohortMessageSendController({ fetcher, createKey });
    const first = controller.begin(input)!;
    expect(controller.begin(input)).toBeNull();
    await expect(controller.send(first)).rejects.toThrow("response lost");
    controller.finish(first, false);
    const retry = controller.begin(input)!;
    expect(retry.key).toBe(first.key);
    expect((await controller.send(retry)).ok).toBe(true);
    controller.finish(retry, true);
    expect(rows.size).toBe(1);
    const intentionalRepeat = controller.begin(input)!;
    expect(intentionalRepeat.key).not.toBe(first.key);
    expect(createKey).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ content: input.content, thread_topic: "chat" });
  });

  it("does not reuse an attempt across changed content, actor, room, or a reset", () => {
    let next = 0;
    const controller = createCohortMessageSendController({ createKey: () => `key-${++next}` });
    let previous = controller.begin(input)!;
    for (const changed of [
      { ...input, content: "다른 내용" }, { ...input, actorId: "actor-b" },
      { ...input, roomId: "room-b" }, { ...input, threadTopic: "price" as const },
    ]) {
      controller.finish(previous, false);
      const attempt = controller.begin(changed)!;
      expect(attempt.key).not.toBe(previous.key);
      expect(controller.isCurrent(previous)).toBe(false);
      previous = attempt;
    }
    controller.reset();
    expect(controller.isCurrent(previous)).toBe(false);
    const current = controller.begin(input)!;
    controller.finish(previous, true);
    expect(controller.isCurrent(current)).toBe(true);
    expect(controller.begin(input)).toBeNull();
  });
  it("does not dispatch an old actor/room attempt after its scope was reset", async () => {
    const fetcher = vi.fn();
    const controller = createCohortMessageSendController({ fetcher, createKey: () => "10000000-0000-4000-8000-000000000001" });
    const old = controller.begin(input)!;
    controller.reset();
    controller.begin({ ...input, actorId: "actor-b", roomId: "room-b" });
    await expect(controller.send(old)).rejects.toThrow("SCOPE_CHANGED");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
