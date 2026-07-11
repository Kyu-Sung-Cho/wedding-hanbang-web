import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CongratulatoryMoney } from "@/types/money.types";
import { useMoneyStore } from "../moneyStore";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const savedMoney: CongratulatoryMoney = {
  id: "money-1",
  couple_id: "couple-1",
  guest_name: "김하객",
  amount: 100_000,
  side: "groom",
  relation: "친구",
  method: "transfer",
  memo: null,
  received_at: "2026-07-11",
  created_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:00:00.000Z",
};

const newMoney = {
  guest_name: "이하객",
  amount: 50_000,
  side: "bride" as const,
  relation: "친구",
  method: "cash" as const,
  memo: null,
  received_at: "2026-07-11",
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("useMoneyStore persistence failures", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useMoneyStore.getState().reset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not turn an authenticated ledger into demo data after an auth failure", async () => {
    useMoneyStore.setState({
      moneyList: [savedMoney],
      moneyCoupleId: "couple-1",
      moneyLocalMode: false,
    });
    mockFetch.mockResolvedValue(jsonResponse(401, { error: "인증 필요" }));

    await expect(useMoneyStore.getState().loadMoney("couple-1")).rejects.toThrow(
      "로그인이 만료되었거나 접근 권한이 없습니다"
    );

    const state = useMoneyStore.getState();
    expect(state.moneyList).toEqual([savedMoney]);
    expect(state.moneyLocalMode).toBe(false);
    expect(state.errorOperation).toBe("load");
    expect(state.moneyLoading).toBe(false);
  });

  it("clears the previous couple's ledger before loading a different couple", async () => {
    useMoneyStore.setState({
      moneyList: [savedMoney],
      moneyCoupleId: "couple-1",
      moneyLocalMode: false,
    });
    mockFetch.mockResolvedValue(jsonResponse(503, { error: "internal detail" }));

    await expect(useMoneyStore.getState().loadMoney("couple-2")).rejects.toThrow(
      "축의금 내역을 불러오지 못했습니다"
    );

    expect(useMoneyStore.getState().moneyList).toEqual([]);
    expect(useMoneyStore.getState().moneyCoupleId).toBe("couple-2");
  });

  it("rejects a failed add without inserting a fake local record", async () => {
    useMoneyStore.setState({
      moneyList: [savedMoney],
      moneyCoupleId: "couple-1",
      moneyLocalMode: false,
    });
    mockFetch.mockResolvedValue(jsonResponse(500, { error: "database detail" }));

    await expect(useMoneyStore.getState().addMoney(newMoney)).rejects.toThrow(
      "입력한 내용은 그대로 유지됩니다"
    );

    const state = useMoneyStore.getState();
    expect(state.moneyList).toEqual([savedMoney]);
    expect(state.moneyLocalMode).toBe(false);
    expect(state.errorOperation).toBe("add");
  });

  it("keeps the original record when update fails", async () => {
    useMoneyStore.setState({
      moneyList: [savedMoney],
      moneyCoupleId: "couple-1",
      moneyLocalMode: false,
    });
    mockFetch.mockResolvedValue(jsonResponse(503, {}));

    await expect(
      useMoneyStore.getState().updateMoney(savedMoney.id, { amount: 200_000 })
    ).rejects.toThrow("입력한 내용은 그대로 유지됩니다");

    expect(useMoneyStore.getState().moneyList).toEqual([savedMoney]);
    expect(useMoneyStore.getState().errorOperation).toBe("update");
  });

  it("keeps the original record and exposes a retryable error when delete fails", async () => {
    useMoneyStore.setState({
      moneyList: [savedMoney],
      moneyCoupleId: "couple-1",
      moneyLocalMode: false,
    });
    mockFetch.mockRejectedValue(new Error("offline"));

    await expect(useMoneyStore.getState().deleteMoney(savedMoney.id)).rejects.toThrow(
      "축의금 내역을 삭제하지 못했습니다"
    );

    expect(useMoneyStore.getState().moneyList).toEqual([savedMoney]);
    expect(useMoneyStore.getState().errorOperation).toBe("delete");
  });

  it("uses in-memory writes only for the explicit demo couple", async () => {
    await useMoneyStore.getState().loadMoney("demo-couple");
    await useMoneyStore.getState().addMoney(newMoney);

    const state = useMoneyStore.getState();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(state.moneyLocalMode).toBe(true);
    expect(state.moneyList).toHaveLength(1);
    expect(state.moneyList[0]).toMatchObject({
      couple_id: "demo-couple",
      guest_name: newMoney.guest_name,
      amount: newMoney.amount,
    });
    expect(state.error).toBeNull();
  });

  it("accepts a valid server record and clears the previous error", async () => {
    useMoneyStore.setState({
      moneyCoupleId: "couple-1",
      error: "이전 오류",
      errorOperation: "add",
    });
    const created = { ...savedMoney, id: "money-2", guest_name: newMoney.guest_name };
    mockFetch.mockResolvedValue(jsonResponse(201, { money: created }));

    await useMoneyStore.getState().addMoney(newMoney);

    const state = useMoneyStore.getState();
    expect(state.moneyList).toEqual([created]);
    expect(state.error).toBeNull();
    expect(state.errorOperation).toBeNull();
  });
});
