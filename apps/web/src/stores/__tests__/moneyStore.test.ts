import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  setOwner: vi.fn<(userId: string | null, coupleId: string | null, isDemo?: boolean) => void>(),
}));
vi.mock("@/stores/authStore", async () => {
  const { create } = await import("zustand");
  const useAuthStore = create<{
    user: { id: string } | null; couple: { id: string } | null; isDemo: boolean;
  }>(() => ({ user: null, couple: null, isDemo: false }));
  auth.setOwner.mockImplementation((userId, coupleId, isDemo = false) => {
    useAuthStore.setState({
      user: userId ? { id: userId } : null,
      couple: coupleId ? { id: coupleId } : null, isDemo,
    });
  });
  return { useAuthStore };
});
import { useMoneyStore } from "../moneyStore";

const mockFetch = vi.fn();
const ROW = {
  id: "money-1", couple_id: "couple-1", guest_name: "가상 하객",
  amount: 100_000, side: "bride" as const, relation: null,
  method: "cash" as const, memo: null, received_at: "2026-10-17",
  created_at: "2026-10-17T00:00:00.000Z", updated_at: "2026-10-17T00:00:00.000Z",
};
const INPUT = {
  guest_name: ROW.guest_name, amount: ROW.amount, side: ROW.side,
  relation: ROW.relation, method: ROW.method, memo: ROW.memo, received_at: ROW.received_at,
};
function response(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("moneyStore 서버 저장과 계정 경계", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockReset();
    auth.setOwner("user-1", "couple-1");
    useMoneyStore.getState().reset();
    mockFetch.mockResolvedValueOnce(response(200, { moneyList: [ROW] }));
    await useMoneyStore.getState().loadMoney("couple-1");
    mockFetch.mockReset();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([401, 403, 500])("GET %s는 빈 목록/데모 성공으로 숨기지 않는다", async (status) => {
    mockFetch.mockResolvedValue(response(status));
    await expect(useMoneyStore.getState().loadMoney("couple-1")).rejects.toThrow();
    expect(useMoneyStore.getState().moneyLocalMode).toBe(false);
    expect(useMoneyStore.getState().error).toBeTruthy();
    expect(useMoneyStore.getState().moneyLoading).toBe(false);
  });
  it.each([401, 403, 500])("POST %s는 가짜 행을 만들지 않는다", async (status) => {
    mockFetch.mockResolvedValue(response(status));
    await expect(useMoneyStore.getState().addMoney(INPUT)).rejects.toThrow();
    expect(useMoneyStore.getState().moneyList).toEqual([ROW]);
    expect(useMoneyStore.getState().moneyLocalMode).toBe(false);
  });
  it.each([401, 403, 500])("PATCH %s는 원값을 덮어쓰지 않는다", async (status) => {
    mockFetch.mockResolvedValue(response(status));
    await expect(useMoneyStore.getState().updateMoney(ROW.id, { amount: 200_000 })).rejects.toThrow();
    expect(useMoneyStore.getState().moneyList).toEqual([ROW]);
    expect(useMoneyStore.getState().moneyLocalMode).toBe(false);
  });
  it.each([401, 403, 500])("DELETE %s는 서버에 남은 행을 지우지 않는다", async (status) => {
    mockFetch.mockResolvedValue(response(status));
    await expect(useMoneyStore.getState().deleteMoney(ROW.id)).rejects.toThrow();
    expect(useMoneyStore.getState().moneyList).toEqual([ROW]);
    expect(useMoneyStore.getState().moneyLocalMode).toBe(false);
  });
  it("조회 인증 실패 뒤의 저장도 API를 호출하고 실패한다", async () => {
    mockFetch.mockResolvedValue(response(401));
    await expect(useMoneyStore.getState().loadMoney("couple-1")).rejects.toThrow();
    await expect(useMoneyStore.getState().addMoney(INPUT)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
  });
  it("정상 추가·수정·삭제는 서버 결과를 반영한다", async () => {
    const created = { ...ROW, id: "money-2" };
    mockFetch.mockResolvedValueOnce(response(200, { money: created }));
    await useMoneyStore.getState().addMoney(INPUT);
    mockFetch.mockResolvedValueOnce(response(200, { money: { ...created, amount: 200_000 } }));
    await useMoneyStore.getState().updateMoney(created.id, { amount: 200_000 });
    expect(useMoneyStore.getState().moneyList[0].amount).toBe(200_000);
    mockFetch.mockResolvedValueOnce(response(200));
    await useMoneyStore.getState().deleteMoney(created.id);
    expect(useMoneyStore.getState().moneyList).toEqual([ROW]);
  });
  it("명시적 데모만 API 없이 임시 입력한다", async () => {
    auth.setOwner("demo", "demo-couple", true);
    await useMoneyStore.getState().loadMoney("demo-couple");
    await useMoneyStore.getState().addMoney(INPUT);
    const local = useMoneyStore.getState().moneyList[0];
    expect(local.couple_id).toBe("demo-couple");
    await useMoneyStore.getState().updateMoney(local.id, { amount: 200_000 });
    expect(useMoneyStore.getState().moneyList[0].amount).toBe(200_000);
    await useMoneyStore.getState().deleteMoney(local.id);
    expect(useMoneyStore.getState().moneyList).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("실계정은 demo-couple 문자열만으로 임시 모드를 열 수 없다", async () => {
    await expect(useMoneyStore.getState().loadMoney("demo-couple")).rejects.toThrow();
    expect(useMoneyStore.getState().moneyLocalMode).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    [null, null, false], ["user-2", "couple-1", false],
    ["user-1", "couple-2", false], ["demo", "demo-couple", true],
  ] as const)("계정/커플/데모 변경은 즉시 기존 목록을 비운다", (userId, coupleId, isDemo) => {
    auth.setOwner(userId, coupleId, isDemo);
    expect(useMoneyStore.getState().moneyList).toEqual([]);
    expect(useMoneyStore.getState().error).toBeNull();
  });
  it("옛 계정의 늦은 GET이 새 목록에 섞이지 않는다", async () => {
    const old = deferredResponse();
    mockFetch.mockReturnValueOnce(old.promise);
    const pending = useMoneyStore.getState().loadMoney("couple-1");
    auth.setOwner("user-2", "couple-2");
    const current = { ...ROW, id: "money-current", couple_id: "couple-2" };
    mockFetch.mockResolvedValueOnce(response(200, { moneyList: [current] }));
    await useMoneyStore.getState().loadMoney("couple-2");
    old.resolve(response(200, { moneyList: [ROW] }));
    await pending;
    expect(useMoneyStore.getState().moneyList).toEqual([current]);
  });
  it("reset 뒤의 늦은 GET도 목록을 복구하지 않는다", async () => {
    const old = deferredResponse();
    mockFetch.mockReturnValueOnce(old.promise);
    const pending = useMoneyStore.getState().loadMoney("couple-1");
    useMoneyStore.getState().reset();
    old.resolve(response(200, { moneyList: [ROW] }));
    await pending;
    expect(useMoneyStore.getState().moneyList).toEqual([]);
  });
  it("옛 GET 오류가 새 계정의 정상 조회를 덮지 않는다", async () => {
    const old = deferredResponse();
    mockFetch.mockReturnValueOnce(old.promise);
    const pending = useMoneyStore.getState().loadMoney("couple-1");
    auth.setOwner("user-2", "couple-2");
    mockFetch.mockResolvedValueOnce(response(200, { moneyList: [] }));
    await useMoneyStore.getState().loadMoney("couple-2");
    old.resolve(response(401));
    await pending;
    expect(useMoneyStore.getState().error).toBeNull();
    expect(useMoneyStore.getState().moneyLocalMode).toBe(false);
  });
  it("옛 계정의 늦은 저장 결과를 새 목록에 추가하지 않는다", async () => {
    const old = deferredResponse();
    mockFetch.mockReturnValueOnce(old.promise);
    const pending = useMoneyStore.getState().addMoney(INPUT);
    const rejected = expect(pending).rejects.toThrow(/계정|연결/);
    auth.setOwner("user-2", "couple-2");
    old.resolve(response(200, { money: ROW }));
    await rejected;
    expect(useMoneyStore.getState().moneyList).toEqual([]);
  });
});
