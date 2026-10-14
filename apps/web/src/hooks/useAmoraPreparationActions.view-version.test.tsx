import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: {
  user: { id: "11111111-1111-4111-8111-111111111111" },
  profile: { id: "11111111-1111-4111-8111-111111111111", couple_id: "22222222-2222-4222-8222-222222222222" },
  isDemo: false, isInitialized: true, journey: { progress: {} },
} }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: Object.assign(
  (selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth),
  { getState: () => mocks.auth, subscribe: () => () => undefined },
) }));
import { useAmoraPreparationActions } from "./useAmoraPreparationActions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const version = "2026-10-12T00:00:00.123456Z";
const action = { id: "act_view_test", title: "식사 포함 범위 확인", status: "open", source: "manual", priority: "medium",
  createdAt: "2026-10-01T00:00:00Z", updatedAt: version, viewVersion: version };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
let latest: ReturnType<typeof useAmoraPreparationActions>;
function Harness() {
  const result = useAmoraPreparationActions();
  useEffect(() => { latest = result; }, [result]);
  return <div>{result.actions.map(item => <p key={item.id}>{item.title}</p>)}</div>;
}

describe("shared action approval uses the viewed raw version", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  });

  it("preserves the server-provided microsecond view version on a mounted read", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    expect(latest.actions[0]?.viewVersion).toBe(version);
    expect(latest.actions[0]?.updatedAt).toBe(version);
  });

  it("sends the explicitly viewed raw version and verified account/couple pins", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    const nextVersion = "2026-10-12T00:00:00.123457Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "포함 메뉴 확인", updatedAt: nextVersion, viewVersion: nextVersion } }));
    await act(async () => {
      expect(await latest.update(action.id, { title: "포함 메뉴 확인" }, { version, ownerScope: latest.ownerScope })).toBe(true);
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      title: "포함 메뉴 확인", expectedUpdatedAt: version,
      expectedOwnerId: mocks.auth.user.id, expectedCoupleId: mocks.auth.profile.couple_id,
    });
    expect(latest.actions[0]?.viewVersion).toBe(nextVersion);
  });

  it("does not promote a display timestamp from an older server into edit authority", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [{ ...action, viewVersion: undefined }], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    expect(latest.actions[0]?.viewVersion).toBeNull();
    await act(async () => {
      expect(await latest.update(action.id, { title: "이전 화면 수정" }, { version, ownerScope: latest.ownerScope })).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not announce success for an unchanged microsecond receipt", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "응답만 바뀐 제목" } }));
    await act(async () => {
      expect(await latest.update(action.id, { title: "응답만 바뀐 제목" }, { version, ownerScope: latest.ownerScope })).toBe(false);
    });
    expect(latest.actions[0]?.title).toBe(action.title);
  });

  it("reads the current card after conflict without silently retrying the draft", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    const current = { ...action, title: "파트너가 확인한 범위", updatedAt: "2026-10-12T00:00:00.123457Z", viewVersion: "2026-10-12T00:00:00.123457Z" };
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ action: current }));
    await act(async () => {
      expect(await latest.update(action.id, { title: "내가 작성한 범위" }, { version, ownerScope: latest.ownerScope })).toBe(false);
    });
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "PATCH", "GET"]);
    expect(fetchMock.mock.calls[2][0]).toBe(`/api/amora/actions/${action.id}`);
    expect(latest).toHaveProperty(`updateIssues.${action.id}.kind`, "conflict");
    expect(latest).toHaveProperty(`updateIssues.${action.id}.latest.title`, current.title);
  });

  it.each([
    { listedStatus: "open", newerStatus: "done", initialOpen: 1, pageOpen: 0 },
    { listedStatus: "done", newerStatus: "open", initialOpen: 1, pageOpen: 2 },
  ])("bounds the display count when a newer page count coexists with an older retained card (%j)", async row => {
    const listed = { ...action, status: row.listedStatus };
    const currentVersion = "2026-10-12T00:00:00.123457Z";
    const current = { ...action, status: row.newerStatus, updatedAt: currentVersion, viewVersion: currentVersion };
    const second = { ...action, id: "act_view_page_two", title: "다른 페이지의 할 일", status: row.newerStatus };
    fetchMock.mockResolvedValueOnce(response({ actions: [listed], count: 2, open_count: row.initialOpen, next_cursor: "page-two" }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ actions: [second], count: 2, open_count: row.pageOpen }));
    await act(async () => latest.loadMore());
    expect(latest.actions.find(item => item.id === action.id)?.status).toBe(row.listedStatus);
    expect(latest.open_count).toBe(row.pageOpen);
    fetchMock.mockResolvedValueOnce(response({ action: current }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.actions.find(item => item.id === action.id)?.status).toBe(row.newerStatus);
    expect(latest.actions.find(item => item.id === action.id)?.viewVersion).toBe(currentVersion);
    expect(latest.open_count).toBe(row.pageOpen);
    expect(latest.count).toBe(2);
    expect(latest.actions.map(item => item.id)).toEqual([action.id, second.id]);
    expect(latest.nextCursor).toBeNull();
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "GET", "GET"]);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/amora/actions?status=all&limit=80&cursor=page-two");
    expect(fetchMock.mock.calls[2][0]).toBe(`/api/amora/actions/${action.id}`);
    fetchMock.mockResolvedValueOnce(response({ action: current }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.open_count).toBe(row.pageOpen);
    expect(latest.count).toBe(2);
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(0);
  });

  it("updates a newer microsecond read once and applies only its retained-card status difference", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    const doneVersion = "2026-10-12T00:00:00.123457Z";
    const done = { ...action, title: "현재 완료 기록", status: "done", updatedAt: doneVersion, viewVersion: doneVersion };
    fetchMock.mockResolvedValueOnce(response({ action: done }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.actions[0]).toMatchObject(done); expect(latest.open_count).toBe(0);
    fetchMock.mockResolvedValueOnce(response({ action: { ...done, title: "같은 버전의 다른 표시" } }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.actions[0]?.title).toBe(done.title); expect(latest.open_count).toBe(0);
    const openVersion = "2026-10-12T00:00:00.123458Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...done, status: "open", updatedAt: openVersion, viewVersion: openVersion } }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.actions[0]?.viewVersion).toBe(openVersion); expect(latest.open_count).toBe(1);
    expect(latest.count).toBe(1); expect(latest.actions).toHaveLength(1);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "GET", "GET", "GET"]);
  });

  it.each([
    { kind: "full", count: 3, pageOpen: 1, expectedOpen: 1 },
    { kind: "partial lower", count: 4, pageOpen: 1, expectedOpen: 1 },
    { kind: "partial upper", count: 4, pageOpen: 4, expectedOpen: 3 },
  ])("keeps a mixed-age read count consistent with the displayed open and closed cards (%j)", async row => {
    const upper = row.kind === "partial upper";
    const listed = { ...action, status: upper ? "done" : "open" };
    const otherOpen = { ...action, id: "act_view_visible_open", title: "화면에 남아 있는 진행 항목", status: "open" };
    const otherDone = { ...action, id: "act_view_visible_done", title: "화면에 남아 있는 완료 항목", status: "done" };
    const first = row.kind === "full" ? [listed] : upper ? [listed, otherDone] : [listed, otherOpen];
    const second = row.kind === "full" ? [otherOpen, otherDone] : upper ? [otherOpen] : [otherDone];
    fetchMock.mockResolvedValueOnce(response({ actions: first, count: row.count, open_count: 2, next_cursor: "mixed-age" }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ actions: second, count: row.count, open_count: row.pageOpen }));
    await act(async () => latest.loadMore());
    expect(latest.actions.find(item => item.id === action.id)?.status).toBe(listed.status);
    expect(latest.open_count).toBe(row.pageOpen);
    const currentVersion = "2026-10-12T00:00:00.123457Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...listed, status: upper ? "open" : "done", updatedAt: currentVersion, viewVersion: currentVersion } }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.actions.find(item => item.id === action.id)?.viewVersion).toBe(currentVersion);
    expect(latest.open_count).toBe(row.expectedOpen);
    const displayedOpen = latest.actions.filter(item => item.status === "open").length;
    const displayedClosed = latest.actions.length - displayedOpen;
    expect(latest.open_count).toBeGreaterThanOrEqual(displayedOpen);
    expect(latest.open_count).toBeLessThanOrEqual(latest.count - displayedClosed);
    expect(latest.count).toBe(row.count); expect(latest.actions).toHaveLength(3);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "GET", "GET"]);
  });

  it.each([
    "2026-10-12T00:00:00.123455Z", version, "2026-10-12T09:00:00.123456+09:00",
  ])("does not replace the canonical card with an older or equal-instant single read (%s)", async readVersion => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "되돌리지 않을 표시", status: "done", updatedAt: readVersion, viewVersion: readVersion } }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.actions[0]).toMatchObject(action); expect(latest.open_count).toBe(1);
    expect(latest.count).toBe(1); expect(latest.updateIssues[action.id]?.availability).toBe("current");
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(0);
  });

  it("does not promote a nonversioned listed card after a valid newer single read", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [{ ...action, viewVersion: null }], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    const currentVersion = "2026-10-12T00:00:00.123457Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "별도로 확인한 내용", updatedAt: currentVersion, viewVersion: currentVersion } }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.actions[0]?.title).toBe(action.title); expect(latest.actions[0]?.viewVersion).toBeNull();
    expect(latest.updateIssues[action.id]?.latest?.viewVersion).toBe(currentVersion);
    expect(latest.open_count).toBe(1); expect(latest.count).toBe(1);
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(0);
  });

  it.each([undefined, null, "not-a-version"])("does not update canonical display from a nonversioned single read (%s)", async viewVersion => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "승격하지 않을 조회", status: "done",
      updatedAt: "2026-10-12T00:00:00.123457Z", viewVersion } }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(true); });
    expect(latest.actions[0]).toMatchObject(action); expect(latest.open_count).toBe(1);
    expect(latest.count).toBe(1); expect(latest.actions).toHaveLength(1);
    expect(latest.updateIssues[action.id]?.latest?.viewVersion).toBeNull();
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(0);
  });

  it("does not replace or insert a different-id single read", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    const currentVersion = "2026-10-12T00:00:00.123457Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, id: "wrong_read_id", title: "다른 기록",
      updatedAt: currentVersion, viewVersion: currentVersion } }));
    await act(async () => { expect(await latest.inspectUpdate(action.id)).toBe(false); });
    expect(latest.actions).toHaveLength(1); expect(latest.actions[0]).toMatchObject(action);
    expect(latest.updateIssues[action.id]?.availability).toBe("unknown");
    expect(latest.updateIssues[action.id]?.latest).toBeUndefined();
    expect(latest.count).toBe(1); expect(latest.open_count).toBe(1);
  });

  it("does not treat a matching read after response loss as our successful write", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));
    const current = { ...action, title: "내 작성 내용", updatedAt: "2026-10-12T00:00:00.123457Z", viewVersion: "2026-10-12T00:00:00.123457Z" };
    fetchMock.mockResolvedValueOnce(response({ action: current }));
    await act(async () => {
      expect(await latest.update(action.id, { title: "내 작성 내용" }, { version, ownerScope: latest.ownerScope })).toBe(false);
    });
    expect(latest).toHaveProperty(`updateIssues.${action.id}.kind`, "uncertain");
    expect(latest).toHaveProperty(`updateIssues.${action.id}.latest.title`, "내 작성 내용");
    // 조회한 최신 내용은 표시하되 이번 요청의 저장 성공으로 승격하지 않는다.
    expect(latest.actions[0]?.title).toBe(current.title);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "PATCH", "GET"]);
  });

  it.each([404, 503])("does not infer deletion from the paginated list or an unavailable read (%s)", async status => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 80, open_count: 1, next_cursor: "next" }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ code: "AMORA_ACTION_CONFLICT" }, 409));
    fetchMock.mockResolvedValueOnce(response({ error: "read not available" }, status));
    await act(async () => {
      expect(await latest.update(action.id, { title: "편집 내용" }, { version, ownerScope: latest.ownerScope })).toBe(false);
    });
    expect(latest).toHaveProperty(`updateIssues.${action.id}.availability`, status === 404 ? "missing" : "unknown");
    expect(latest.actions[0]?.title).toBe(action.title);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "PATCH", "GET"]);
  });

  it.each([
    { updatedAt: "2026-10-12T00:00:00.123455Z", viewVersion: "2026-10-12T00:00:00.123455Z" },
    { updatedAt: "2026-10-12T00:00:00.123457Z", viewVersion: null },
    { updatedAt: "2026-10-12T00:00:00.123457Z", viewVersion: "2026-10-12T00:00:00.123458Z" },
  ])("rejects backward, missing or timestamp-inconsistent edit receipts (%j)", async receipt => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "확인되지 않은 변경", ...receipt } }));
    fetchMock.mockResolvedValueOnce(response({ action }));
    await act(async () => {
      expect(await latest.update(action.id, { title: "확인되지 않은 변경" }, { version, ownerScope: latest.ownerScope })).toBe(false);
    });
    expect(latest).toHaveProperty(`updateIssues.${action.id}.kind`, "uncertain");
    expect(latest.actions[0]?.title).toBe(action.title);
  });

  it.each([undefined, null, "not-a-date", "2026-02-30T00:00:00.123456Z", "2026-10-12T00:00:00.1234567Z"])("does not send an invalid viewed authority (%s)", async value => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    await act(async () => {
      expect(await latest.update(action.id, { title: "발송 금지" }, { version: value, ownerScope: latest.ownerScope })).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers an editing card omitted from the current page only through a real single read", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 81, open_count: 81, next_cursor: "more" }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ actions: [], count: 81, open_count: 81 }));
    await act(async () => latest.refresh());
    const currentVersion = "2026-10-12T00:00:00.123457Z";
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, updatedAt: currentVersion, viewVersion: currentVersion } }));
    await act(async () => latest.inspectUpdate(action.id));
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["GET", "GET", "GET"]);
    expect(latest).toHaveProperty(`updateIssues.${action.id}.availability`, "current");
    expect(latest.actions).toEqual([]); expect(latest.count).toBe(81); expect(latest.open_count).toBe(81);
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, title: "확인 후 수정", updatedAt: "2026-10-12T00:00:00.123458Z", viewVersion: "2026-10-12T00:00:00.123458Z" } }));
    await act(async () => {
      expect(await latest.update(action.id, { title: "확인 후 수정" }, { version: currentVersion, ownerScope: latest.ownerScope })).toBe(true);
    });
    expect(latest.open_count).toBe(81);
  });

  it("does not issue reapproval authority from an inconsistent single-read version", async () => {
    fetchMock.mockResolvedValueOnce(response({ actions: [action], count: 1, open_count: 1 }));
    await act(async () => root.render(<Harness />));
    fetchMock.mockResolvedValueOnce(response({ action: { ...action, updatedAt: "2026-10-12T00:00:00.123457Z" } }));
    await act(async () => latest.inspectUpdate(action.id));
    expect(latest).toHaveProperty(`updateIssues.${action.id}.availability`, "unknown");
    expect(latest.updateIssues[action.id]?.latest).toBeUndefined();
  });
});
