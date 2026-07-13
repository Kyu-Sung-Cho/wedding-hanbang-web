"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useMoneyStore } from "@/stores/moneyStore";
import type { Side, Relation, MoneyMethod, CongratulatoryMoney } from "@/types/money.types";
import {
  Plus, Search, Download, Wallet,
  Edit3, Trash2, X, Check,
} from "lucide-react";

const RELATIONS: Relation[] = ["친구", "직장동료", "가족", "친척", "은사", "이웃", "기타"];
const METHODS: { key: MoneyMethod; label: string }[] = [
  { key: "cash", label: "현금" },
  { key: "transfer", label: "이체" },
  { key: "etc", label: "기타" },
];

export default function MoneyPage() {
  const { couple } = useAuthStore();
  const {
    moneyList,
    moneyLoading,
    moneyCoupleId,
    error,
    errorOperation,
    loadMoney,
    addMoney,
    updateMoney,
    deleteMoney,
    clearError,
  } = useMoneyStore();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterSide, setFilterSide] = useState<Side | "all">("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const visibleMoneyList = useMemo(
    () => (moneyCoupleId === couple?.id ? moneyList : []),
    [couple?.id, moneyCoupleId, moneyList]
  );
  const isLedgerLoading = Boolean(couple?.id) && (
    moneyLoading || moneyCoupleId !== couple?.id
  );

  // 폼 상태
  const [form, setForm] = useState({
    guest_name: "",
    amount: "",
    side: "groom" as Side,
    relation: "" as string,
    method: "cash" as MoneyMethod,
    memo: "",
    received_at: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    if (couple?.id) {
      void loadMoney(couple.id).catch(() => {
        // 스토어의 오류 상태를 화면에서 복구 가능한 형태로 표시한다.
      });
    }
  }, [couple?.id, loadMoney]);

  // 필터링된 목록
  const filtered = useMemo(() => {
    let result = visibleMoneyList;
    if (filterSide !== "all") {
      result = result.filter((m) => m.side === filterSide);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) => m.guest_name.toLowerCase().includes(q) || m.relation?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [visibleMoneyList, filterSide, search]);

  // 통계
  const stats = useMemo(() => {
    const total = visibleMoneyList.reduce((s, m) => s + m.amount, 0);
    const groomTotal = visibleMoneyList.filter((m) => m.side === "groom").reduce((s, m) => s + m.amount, 0);
    const brideTotal = visibleMoneyList.filter((m) => m.side === "bride").reduce((s, m) => s + m.amount, 0);
    const count = visibleMoneyList.length;
    const avg = count > 0 ? Math.round(total / count) : 0;
    return { total, groomTotal, brideTotal, count, avg };
  }, [visibleMoneyList]);

  const resetForm = () => {
    setForm({
      guest_name: "",
      amount: "",
      side: "groom",
      relation: "",
      method: "cash",
      memo: "",
      received_at: new Date().toISOString().slice(0, 10),
    });
    setFormError(null);
    setEditId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (isSaving || !form.guest_name.trim() || !form.amount) return;

    const amount = Number(form.amount);
    if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
      setFormError("금액을 0~1억원 사이의 정수로 입력해 주세요.");
      return;
    }

    setFormError(null);
    setIsSaving(true);
    try {
      const data = {
        guest_name: form.guest_name.trim(),
        amount,
        side: form.side,
        relation: form.relation || null,
        method: form.method,
        memo: form.memo || null,
        received_at: form.received_at,
      };
      if (editId) {
        await updateMoney(editId, data);
      } else {
        await addMoney(data);
      }
      resetForm();
    } catch {
      // 저장 실패 시 폼과 입력값을 그대로 두고 스토어의 오류를 표시한다.
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (money: CongratulatoryMoney) => {
    clearError();
    setFormError(null);
    setForm({
      guest_name: money.guest_name,
      amount: String(money.amount),
      side: money.side,
      relation: money.relation ?? "",
      method: money.method,
      memo: money.memo ?? "",
      received_at: money.received_at,
    });
    setEditId(money.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await deleteMoney(id);
      setDeleteConfirm(null);
    } catch {
      // 실패하면 확인 상태를 유지해 사용자가 바로 다시 시도할 수 있게 한다.
    } finally {
      setDeletingId(null);
    }
  };

  const handleReload = () => {
    if (!couple?.id || moneyLoading) return;
    void loadMoney(couple.id).catch(() => {
      // 오류 상태는 스토어에서 갱신한다.
    });
  };

  // CSV 다운로드
  const handleExportCSV = () => {
    const header = "이름,금액,신랑/신부,관계,수단,메모,날짜\n";
    const rows = visibleMoneyList.map((m) =>
      [m.guest_name, m.amount, m.side === "groom" ? "신랑" : m.side === "bride" ? "신부" : "공통", m.relation ?? "", m.method, m.memo ?? "", m.received_at].join(",")
    ).join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `축의금_내역_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatMoney = (n: number) => n.toLocaleString("ko-KR") + "원";

  return (
    <div className="max-w-[800px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif-kr text-4xl font-light text-[#1A1A1F] tracking-tight">축의금 관리</h1>
          <p className="text-base text-[#B5ADA3] mt-2 font-light">축의금 내역을 기록하고 관리하세요</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            disabled={visibleMoneyList.length === 0 || isLedgerLoading}
            aria-label="축의금 CSV 다운로드"
            className="inline-flex items-center gap-1.5 px-5 py-3 bg-white rounded-xl text-base font-medium text-[#504444] hover:bg-[#F6F3F2] hover:text-[#795252] shadow-[0_4px_14px_0_rgba(121,82,82,0.08)] disabled:opacity-30 transition-all"
          >
            <Download className="w-5 h-5" />
            CSV
          </button>
          <button
            onClick={() => { clearError(); resetForm(); setShowForm(true); }}
            disabled={isLedgerLoading}
            aria-label="축의금 추가 폼 열기"
            className="inline-flex items-center gap-1.5 px-6 py-3 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] disabled:opacity-40 transition-all"
          >
            <Plus className="w-5 h-5" />
            추가
          </button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <p className="text-sm text-[#B5ADA3] font-medium uppercase tracking-[0.12em] mb-2">총 축의금</p>
          <p className="font-serif-kr text-4xl font-light text-[#1A1A1F] leading-tight">
            {stats.total.toLocaleString()}
            <span className="text-base text-[#B5ADA3] ml-1">원</span>
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <p className="text-sm text-[#B5ADA3] font-medium uppercase tracking-[0.12em] mb-2">총 인원</p>
          <p className="font-serif-kr text-4xl font-light text-[#1A1A1F] leading-tight">
            {stats.count}
            <span className="text-base text-[#B5ADA3] ml-1">명</span>
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <p className="text-sm text-[#B5ADA3] font-medium uppercase tracking-[0.12em] mb-2">평균</p>
          <p className="font-serif-kr text-4xl font-light text-[#1A1A1F] leading-tight">
            {stats.avg.toLocaleString()}
            <span className="text-base text-[#B5ADA3] ml-1">원</span>
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
          <p className="text-sm text-[#B5ADA3] font-medium uppercase tracking-[0.12em] mb-2">신랑 / 신부</p>
          <p className="text-sm text-[#504444] mt-1">신랑 <span className="font-medium text-[#1A1A1F]">{formatMoney(stats.groomTotal)}</span></p>
          <p className="text-sm text-[#795252] mt-0.5">신부 <span className="font-medium">{formatMoney(stats.brideTotal)}</span></p>
        </div>
      </div>

      {error && (errorOperation !== "load" || visibleMoneyList.length > 0) && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800"
        >
          <div>
            <p className="text-sm font-semibold">
              {errorOperation === "load"
                ? "최신 내역을 불러오지 못했어요"
                : errorOperation === "delete"
                  ? "삭제되지 않았어요"
                  : "저장되지 않았어요"}
            </p>
            <p className="mt-0.5 text-sm">{error}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {errorOperation === "load" && (
              <button
                type="button"
                onClick={handleReload}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                다시 시도
              </button>
            )}
            <button
              type="button"
              onClick={clearError}
              aria-label="오류 메시지 닫기"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-red-600 hover:bg-red-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* 입력 폼 */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif-kr text-2xl font-light text-[#1A1A1F]">
              {editId ? "축의금 수정" : "축의금 추가"}
            </h2>
            <button
              type="button"
              onClick={() => { clearError(); resetForm(); }}
              disabled={isSaving}
              aria-label="축의금 입력 폼 닫기"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[#B5ADA3] hover:bg-[#F6F3F2] hover:text-[#795252] disabled:opacity-40"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={form.guest_name}
              onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
              placeholder="이름"
              className="px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:ring-2 focus:ring-[#795252]/30"
            />
            <input
              type="number"
              value={form.amount}
              onChange={(e) => {
                setForm({ ...form, amount: e.target.value });
                setFormError(null);
              }}
              min={0}
              max={100_000_000}
              step={1}
              placeholder="금액"
              className="px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:ring-2 focus:ring-[#795252]/30"
            />
            <div className="flex gap-2">
              {(["groom", "bride"] as Side[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setForm({ ...form, side: s })}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    form.side === s ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white" : "bg-[#F6F3F2] text-[#504444]"
                  }`}
                >
                  {s === "groom" ? "신랑측" : "신부측"}
                </button>
              ))}
            </div>
            <select
              value={form.relation}
              onChange={(e) => setForm({ ...form, relation: e.target.value })}
              className="px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:ring-2 focus:ring-[#795252]/30"
            >
              <option value="">관계 선택</option>
              {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="flex gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setForm({ ...form, method: m.key })}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    form.method === m.key ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white" : "bg-[#F6F3F2] text-[#504444]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={form.received_at}
              onChange={(e) => setForm({ ...form, received_at: e.target.value })}
              className="px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:ring-2 focus:ring-[#795252]/30"
            />
          </div>
          <input
            type="text"
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
            placeholder="메모 (선택)"
            className="w-full mt-3 px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:ring-2 focus:ring-[#795252]/30"
          />
          {formError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {formError}
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={!form.guest_name.trim() || !form.amount || isSaving}
            aria-busy={isSaving}
            aria-label={editId ? "축의금 수정 저장" : "축의금 추가 저장"}
            className="w-full mt-4 py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.25)] disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            {isSaving ? "저장 중..." : editId ? "수정 완료" : "추가"}
          </button>
        </div>
      )}

      {/* 검색 & 필터 */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B5ADA3]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 관계 검색..."
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-white shadow-[0_4px_14px_0_rgba(0,0,0,0.03)] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:ring-2 focus:ring-[#795252]/30"
          />
        </div>
        <div className="flex gap-1">
          {([["all", "전체"], ["groom", "신랑"], ["bride", "신부"]] as [Side | "all", string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterSide(key)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                filterSide === key
                  ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white"
                  : "bg-white text-[#504444] hover:text-[#795252]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      {isLedgerLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-label="축의금 내역 불러오는 중">
          <div className="w-8 h-8 border-2 border-[#795252] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error && errorOperation === "load" && visibleMoneyList.length === 0 ? (
        <div role="alert" className="text-center py-16 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <Wallet className="w-14 h-14 text-[#B5ADA3] mx-auto mb-4" />
          <p className="text-base font-medium text-[#504444]">축의금 내역을 표시할 수 없어요</p>
          <p className="mt-1 text-sm text-[#8D837A]">{error}</p>
          <button
            type="button"
            onClick={handleReload}
            className="mt-5 min-h-11 rounded-xl bg-[#795252] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#684646]"
          >
            다시 시도
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <Wallet className="w-14 h-14 text-[#B5ADA3] mx-auto mb-4" />
          <p className="text-base text-[#504444] font-light">축의금 내역이 없습니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          {filtered.map((money, i) => (
            <div
              key={money.id}
              className={`flex items-center gap-3 px-5 py-4 ${
                i > 0 ? "border-t border-[#F6F3F2]" : ""
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  money.side === "groom" ? "bg-[#504444]" : "bg-[#795252]"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[17px] font-medium text-[#1A1A1F]">{money.guest_name}</span>
                  {money.relation && (
                    <span className="text-sm text-[#795252] px-2 py-0.5 bg-[#F6F3F2] rounded">
                      {money.relation}
                    </span>
                  )}
                </div>
                {money.memo && (
                  <p className="text-sm text-[#B5ADA3] truncate font-light">{money.memo}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-serif-kr text-xl font-light text-[#1A1A1F]">
                  {formatMoney(money.amount)}
                </div>
                <div className="text-sm text-[#B5ADA3]">{money.received_at}</div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => handleEdit(money)}
                  disabled={deletingId === money.id}
                  aria-label={`${money.guest_name} 축의금 수정`}
                  className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[#F6F3F2] text-[#B5ADA3] hover:text-[#795252] disabled:opacity-40 transition-colors"
                >
                  <Edit3 className="w-5 h-5" />
                </button>
                {deleteConfirm === money.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => { clearError(); setDeleteConfirm(null); }}
                      disabled={deletingId === money.id}
                      aria-label={`${money.guest_name} 축의금 삭제 취소`}
                      className="h-11 px-3 flex items-center justify-center rounded-lg bg-[#F6F3F2] text-[#504444] text-sm disabled:opacity-40"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => handleDelete(money.id)}
                      disabled={deletingId === money.id}
                      aria-busy={deletingId === money.id}
                      aria-label={`${money.guest_name} 축의금 삭제 확정`}
                      className="w-11 h-11 flex items-center justify-center rounded-lg bg-red-500 text-white disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { clearError(); setDeleteConfirm(money.id); }}
                    aria-label={`${money.guest_name} 축의금 삭제`}
                    className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-red-50 text-[#B5ADA3] hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
