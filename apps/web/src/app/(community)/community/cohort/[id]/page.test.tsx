import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), channels: [] as Array<{ name: string; table?: string; deliver?: (payload: unknown) => Promise<void> }>,
  activeRoom: "room-first", error: vi.fn(),
}));

function room(id: string) { return { id, year: 2026, month: 10, room_number: 1, member_count: 2, is_flexible: false }; }
function message(roomId: string, content = `QA ${roomId} 기록`) {
  return { id: `${roomId}-${content}`, room_id: roomId, author_id: "qa-other", content,
    thread_topic: "chat", images: [], reply_to: null, is_deleted: false, created_at: "2026-10-17T01:00:00Z",
    author: { user_id: "qa-other", nickname: "QA 작성자" } };
}

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getUser: mocks.getUser, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
  from: (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "gte", "not"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
    query.maybeSingle = async () => ({ data: table === "cohort_rooms" ? room(mocks.activeRoom) : { user_id: "qa-other", nickname: "QA 작성자" }, error: null });
    query.single = query.maybeSingle;
    return query;
  },
  channel: (name: string) => {
    const channel = { name, on: (_event: string, filter: { table: string }, deliver: (payload: unknown) => Promise<void>) => {
      Object.assign(channel, { table: filter.table, deliver }); return channel;
    }, subscribe: () => channel };
    mocks.channels.push(channel);
    return channel;
  },
  removeChannel: vi.fn(),
}) }));
vi.mock("@/components/community/Toast", () => ({ useToast: () => ({ toast: { error: mocks.error, success: vi.fn() } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import CohortPage from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => void> = [];
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); });
  vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.channels.length = 0;
  document.body.replaceChildren();
});

function params(id: string) { return Promise.resolve({ id }); }
async function flush() { await new Promise((resolve) => setTimeout(resolve, 0)); }

describe("cohort room lifecycle", () => {
  it("sends a UUID from the actual composer, reuses it after a lost response, and creates a new key for an intentional repeat", async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    mocks.activeRoom = "room-first";
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "actor-a" } } });
    const saved = new Map<string, ReturnType<typeof message>>();
    const keys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const key = new Headers(init.headers).get("idempotency-key")!;
        expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        keys.push(key);
        const body = JSON.parse(String(init.body));
        if (!saved.has(key)) saved.set(key, { ...message("room-first", body.content), id: key, author_id: "actor-a" });
        if (keys.length === 1) throw new TypeError("synthetic response lost");
        return Response.json({ message: saved.get(key) });
      }
      if (path === "/api/community/cohort") return Response.json({ room: room("room-first") });
      if (path.endsWith("/messages")) return Response.json({ messages: [] });
      if (path.includes("/digest?")) return Response.json({ topicBreakdown: [], empty: true });
      return Response.json({});
    }));
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); cleanups.push(() => root.unmount());
    await act(async () => { root.render(<CohortPage params={params("room-first")} />); await flush(); await flush(); });
    const enter = async () => { await act(async () => {
      const input = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "QA 응답 유실 시험");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }); };
    const send = async () => { await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="메시지 전송"]')?.click();
      await flush();
    }); };
    await enter(); await send();
    expect(container.querySelector("textarea")?.value).toBe("QA 응답 유실 시험");
    expect(mocks.error).toHaveBeenCalledWith("네트워크 오류");
    await send();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(saved.size).toBe(1);
    expect(container.querySelectorAll('[id^="cohort-message-"]')).toHaveLength(1);
    await enter(); await send();
    expect(keys[2]).not.toBe(keys[0]);
    expect(saved.size).toBe(2);
    expect(container.querySelectorAll('[id^="cohort-message-"]')).toHaveLength(2);
  });

  it("loads and receives realtime in the next room for the same actor after a delayed auth lookup", async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    mocks.activeRoom = "room-first";
    let finishNextAuth!: (value: { data: { user: { id: string } } }) => void;
    const nextAuth = new Promise<{ data: { user: { id: string } } }>((resolve) => { finishNextAuth = resolve; });
    mocks.getUser.mockReset().mockResolvedValueOnce({ data: { user: { id: "actor-a" } } })
      .mockResolvedValueOnce({ data: { user: { id: "actor-a" } } }).mockImplementation(() => nextAuth);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === "/api/community/cohort") return Response.json({ room: room(mocks.activeRoom) });
      if (path.endsWith("/messages")) return Response.json({ messages: [message(path.includes("room-second") ? "room-second" : "room-first")] });
      if (path.includes("/digest?")) return Response.json({ topicBreakdown: [], subtopics: [], highlights: [], questions: [], nextActions: [], empty: true });
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetcher);
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); cleanups.push(() => root.unmount());
    await act(async () => { root.render(<CohortPage params={params("room-first")} />); await flush(); await flush(); });
    expect(container.textContent).toContain("QA room-first 기록");
    const firstInput = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(firstInput, "QA 이전 방 초안");
      firstInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.activeRoom = "room-second";
    await act(async () => { root.render(<CohortPage params={params("room-second")} />); await flush(); });
    await act(async () => { finishNextAuth({ data: { user: { id: "actor-a" } } }); await flush(); await flush(); });
    expect(container.textContent).toContain("QA room-second 기록");
    expect(container.textContent).not.toContain("QA room-first 기록");
    expect(container.querySelector("textarea")?.value).toBe("");
    const channel = mocks.channels.filter((candidate) => candidate.name === "cohort:room-second" && candidate.table === "cohort_messages").at(-1);
    expect(channel?.deliver).toBeTypeOf("function");
    await act(async () => { await channel?.deliver?.({ new: message("room-second", "QA 새 방 실시간") }); await flush(); });
    expect(container.textContent).toContain("QA 새 방 실시간");
    expect(fetcher.mock.calls.some(([path]) => String(path).includes("room-second/messages"))).toBe(true);
  });
});
