import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  state: { loading: false, busy: false, error: null, taskUnknown: false, taskSaved: true, snapshot: { completed: true, responses: [], actorId: "actor" } },
  load: vi.fn(), invalidate: vi.fn(), createTask: vi.fn(),
}));
vi.mock("@/stores/authStore", () => ({ useAuthStore: Object.assign((selector: () => unknown) => selector(), {
  getState: () => ({ isInitialized: true, isDemo: false, user: { id: "actor" }, profile: { id: "actor", couple_id: "couple" }, couple: { bride_id: "actor", groom_id: "partner" } }),
  subscribe: () => () => {},
}) }));
vi.mock("@hanbang/shared/mediation-responses", async importOriginal => ({
  ...await importOriginal<object>(),
  createMediationResponseSession: () => ({ subscribe: () => () => {}, getState: () => mocked.state, load: mocked.load, invalidate: mocked.invalidate, createTask: mocked.createTask }),
}));
vi.mock("next/link", () => ({ default: ({ children, href, className }: ComponentProps<"a">) => <a href={href} className={className}>{children}</a> }));
import MediationResponseControls from "./MediationResponseControls";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { mocked.state.taskSaved = true; mocked.state.taskUnknown = false; mocked.createTask.mockClear(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("shared task result navigation", () => {
  it.each([false, true])("opens the task panel after a saved or uncertain result: unknown=%s", async unknown => {
    mocked.state.taskUnknown = unknown;
    mocked.state.taskSaved = !unknown;
    await act(async () => root.render(<MediationResponseControls revision={{ messageId: "message", expectedProposalVersion: "version", expectedRosterFingerprint: "roster" }} />));
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/wedding/chat/board?view=tasks");
    expect(link?.textContent).toBe(unknown ? "공유 할 일에서 먼저 확인" : "공유 할 일 보기");
    expect(container.textContent?.includes("공유 할 일로 저장할 내용 확인")).toBe(false);
    expect(mocked.createTask).not.toHaveBeenCalled();
  });
});
