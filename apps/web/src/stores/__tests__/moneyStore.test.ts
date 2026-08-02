import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMoneyStore } from "../moneyStore";

const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * 축의금은 하객 앞에서 받아 적는 값이라 다시 물어볼 수 없다.
 *
 * 2026-07-23 `1eb21b81`이 "저장 실패가 조용히 삼켜지고 폼만 비워졌다"를 고쳤지만
 * `addMoney`만 고쳤다. `updateMoney`·`deleteMoney`는 계속 catch에서 console.error만
 * 하고 삼켰다. 그 결과 화면의 에러 처리(`saveError`)는 편집 경로에서 **한 번도
 * 실행되지 않는 죽은 코드**였다 — 사용자는 금액을 고치고 저장을 눌렀는데 아무
 * 일도 일어나지 않고 이유도 못 봤다.
 */
function response(status: number, body: unknown = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const ROW = {
  id: "money-1",
  couple_id: "couple-1",
  guest_name: "김하객",
  amount: 100_000,
  side: "bride" as const,
  relation: null,
  method: "cash" as const,
  memo: null,
  received_at: "2026-07-27",
  created_at: "2026-07-27T00:00:00.000Z",
  updated_at: "2026-07-27T00:00:00.000Z",
};

describe("moneyStore 실패 전달", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useMoneyStore.getState().reset();
    useMoneyStore.setState({ moneyList: [ROW], moneyLocalMode: false });
  });

  it("수정 실패를 호출자에게 전달한다", async () => {
    mockFetch.mockResolvedValue(response(500, { error: "축의금을 수정하지 못했어요." }));

    await expect(
      useMoneyStore.getState().updateMoney("money-1", { amount: 200_000 }),
    ).rejects.toThrow(/수정/);

    // 실패했으면 목록을 고쳐 쓰지 않는다 — 저장된 것처럼 보이면 안 된다.
    expect(useMoneyStore.getState().moneyList[0].amount).toBe(100_000);
  });

  it("삭제 실패를 호출자에게 전달한다", async () => {
    mockFetch.mockResolvedValue(response(500, { error: "축의금을 삭제하지 못했어요." }));

    await expect(
      useMoneyStore.getState().deleteMoney("money-1"),
    ).rejects.toThrow(/삭제/);

    // 서버에 남아 있으므로 화면에서도 지우지 않는다.
    expect(useMoneyStore.getState().moneyList).toHaveLength(1);
  });

  it("성공하면 던지지 않고 목록에 반영한다", async () => {
    mockFetch.mockResolvedValue(response(200, { money: { ...ROW, amount: 200_000 } }));

    await expect(
      useMoneyStore.getState().updateMoney("money-1", { amount: 200_000 }),
    ).resolves.toBeUndefined();
    expect(useMoneyStore.getState().moneyList[0].amount).toBe(200_000);
  });

  it("401/403은 로컬 모드로 내려가고 던지지 않는다", async () => {
    // 비로그인·데모에서 입력을 잃지 않게 하는 기존 계약이다.
    mockFetch.mockResolvedValue(response(401));

    await expect(
      useMoneyStore.getState().updateMoney("money-1", { amount: 300_000 }),
    ).resolves.toBeUndefined();
    expect(useMoneyStore.getState().moneyLocalMode).toBe(true);
    expect(useMoneyStore.getState().moneyList[0].amount).toBe(300_000);
  });

  it("계정 reset 뒤 늦게 도착한 이전 축의금 목록을 복원하지 않는다", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    mockFetch.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const pending = useMoneyStore.getState().loadMoney("couple-a");
    useMoneyStore.getState().reset();
    resolveFetch?.(response(200, { moneyList: [{ ...ROW, guest_name: "A 계정 하객" }] }));
    await pending;

    expect(useMoneyStore.getState().moneyList).toEqual([]);
    expect(useMoneyStore.getState().moneyLoading).toBe(false);
    expect(useMoneyStore.getState().moneyLocalMode).toBe(false);
  });

  it("계정 reset 뒤 이전 추가 요청의 응답도 새 목록에 넣지 않는다", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    mockFetch.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const pending = useMoneyStore.getState().addMoney({
      guest_name: "A 계정 하객",
      amount: 100_000,
      side: "bride",
      relation: null,
      method: "cash",
      memo: null,
      received_at: "2026-07-27",
    });
    useMoneyStore.getState().reset();
    resolveFetch?.(response(200, { money: ROW }));
    await pending;

    expect(useMoneyStore.getState().moneyList).toEqual([]);
  });
});
