"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useMoneyStore } from "@/stores/moneyStore";
import type { Side, Relation, MoneyMethod, CongratulatoryMoney } from "@/types/money.types";
import { todayYmdInKst } from "@hanbang/shared/utils";
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
  const { moneyList, moneyLoading, loadMoney, addMoney, updateMoney, deleteMoney } = useMoneyStore();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterSide, setFilterSide] = useState<Side | "all">("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 저장 중. 두 번 눌러 두 줄이 남는 것을 막고, 눌린 것을 화면에 보인다. */
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 폼 상태
  const [form, setForm] = useState({
    guest_name: "",
    amount: "",
    side: "groom" as Side,
    relation: "" as string,
    method: "cash" as MoneyMethod,
    memo: "",
    received_at: todayYmdInKst(),
  });

  useEffect(() => {
    if (couple?.id) loadMoney(couple.id);
  }, [couple?.id, loadMoney]);

  // 필터링된 목록
  const filtered = useMemo(() => {
    let result = moneyList;
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
  }, [moneyList, filterSide, search]);

  // 통계
  const stats = useMemo(() => {
    const total = moneyList.reduce((s, m) => s + m.amount, 0);
    const groomTotal = moneyList.filter((m) => m.side === "groom").reduce((s, m) => s + m.amount, 0);
    const brideTotal = moneyList.filter((m) => m.side === "bride").reduce((s, m) => s + m.amount, 0);
    const count = moneyList.length;
    const avg = count > 0 ? Math.round(total / count) : 0;
    return { total, groomTotal, brideTotal, count, avg };
  }, [moneyList]);

  const resetForm = () => {
    setForm({
      guest_name: "",
      amount: "",
      side: "groom",
      relation: "",
      method: "cash",
      memo: "",
      received_at: todayYmdInKst(),
    });
    setEditId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!form.guest_name.trim() || !form.amount) return;
    // 두 번 누르면 두 번 저장됐다. 예식장 로비처럼 회선이 느린 곳에서 실제로
    // 일어나는 일이고, 같은 하객이 두 줄로 남으면 정산이 어긋난다.
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
    if (editId) {
      await updateMoney(editId, {
        guest_name: form.guest_name,
        amount: parseInt(form.amount),
        side: form.side,
        relation: form.relation || null,
        method: form.method,
        memo: form.memo || null,
        received_at: form.received_at,
      });
    } else {
      await addMoney({
        guest_name: form.guest_name,
        amount: parseInt(form.amount),
        side: form.side,
        relation: form.relation || null,
        method: form.method,
        memo: form.memo || null,
        received_at: form.received_at,
      });
    }
    } catch (err) {
      // 저장에 실패했으면 폼을 비우지 않는다 — 하객 앞에서 다시 받아 적을 수는 없다.
      setSaveError(err instanceof Error ? err.message : "저장하지 못했어요. 다시 시도해 주세요.");
      return;
    } finally {
      setSaving(false);
    }
    resetForm();
  };

  const handleEdit = (money: CongratulatoryMoney) => {
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
    setDeleteError(null);
    try {
      await deleteMoney(id);
    } catch (err) {
      // 실패했으면 확인 창을 닫지 않는다 — 지워진 것처럼 보이면 안 된다.
      setDeleteError(err instanceof Error ? err.message : "삭제하지 못했어요. 다시 시도해 주세요.");
      return;
    }
    setDeleteConfirm(null);
  };

  // CSV 다운로드
  const handleExportCSV = () => {
    const header = "이름,금액,신랑/신부,관계,수단,메모,날짜\n";
    const rows = moneyList.map((m) =>
      [m.guest_name, m.amount, m.side === "groom" ? "신랑" : m.side === "bride" ? "신부" : "공통", m.relation ?? "", m.method, m.memo ?? "", m.received_at].join(",")
    ).join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `축의금_내역_${todayYmdInKst()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatMoney = (n: number) => n.toLocaleString("ko-KR") + "원";

  return (
    <div className="max-w-[800px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif-kr text-[var(--hb-text-strong)]">축의금 관리</h1>
          <p className="text-base text-[var(--hb-text-muted)] mt-2 font-light">축의금 내역을 기록하고 관리하세요</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            disabled={moneyList.length === 0}
            aria-label="축의금 CSV 다운로드"
            className="inline-flex items-center gap-1.5 px-5 py-3 bg-white rounded-[6px] text-base font-medium text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)] hover:text-[var(--hb-accent-hover)] shadow-[var(--shadow-raised)] disabled:opacity-30 transition-all"
          >
            <Download className="w-5 h-5" />
            CSV
          </button>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            aria-label="축의금 추가 폼 열기"
            className="inline-flex items-center gap-1.5 px-6 py-3 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-[6px] text-base font-medium shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] transition-all"
          >
            <Plus className="w-5 h-5" />
            추가
          </button>
        </div>
      </div>

      {/*
        카드 넷을 한 줄에 놓지 않는다. 이 페이지는 `max-w-[800px]` 안이라 4단이면
        칸이 59~143px 인데, 축의금은 **원 단위 원본**이라(예산 카드가 만원으로
        나누는 것과 다르다) 금액이 길다. 전역 `overflow-wrap: anywhere` 때문에
        넘치는 대신 **숫자 중간에서 줄이 바뀐다** — "1,250,000" 이 세 줄로 쪼개져
        다른 금액으로 읽힌다.

        2026-08-31 운영 CSS 로 폭을 사다리로 재서 얻은 값(숫자가 차지하는 줄 수):

          뷰포트   현재 4단        2단
          768     3줄 (칸 59px)   1줄 (칸 178px)
          1024    2줄 (칸 123px)  1줄 (칸 306px)
          1440    2줄 (칸 143px)  1줄 (칸 346px)

        1024px 에서는 10만원조차 두 줄로 쪼개졌다 — 평균 카드는 거의 늘 깨진다.
        모바일은 원래 2단이고 글자도 22px 로 줄어 영향이 없다.
      */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white rounded-[6px] shadow-[var(--shadow-raised)] p-6">
          <p className="text-sm text-[var(--hb-text-muted)] font-medium mb-2">총 축의금</p>
          <p className="font-serif-kr text-4xl font-light text-[var(--hb-text-strong)] leading-tight">
            {stats.total.toLocaleString()}
            <span className="text-base text-[var(--hb-text-muted)] ml-1">원</span>
          </p>
        </div>
        <div className="bg-white rounded-[6px] shadow-[var(--shadow-raised)] p-6">
          <p className="text-sm text-[var(--hb-text-muted)] font-medium mb-2">총 인원</p>
          <p className="font-serif-kr text-4xl font-light text-[var(--hb-text-strong)] leading-tight">
            {stats.count}
            <span className="text-base text-[var(--hb-text-muted)] ml-1">명</span>
          </p>
        </div>
        <div className="bg-white rounded-[6px] shadow-[var(--shadow-raised)] p-6">
          <p className="text-sm text-[var(--hb-text-muted)] font-medium mb-2">평균</p>
          <p className="font-serif-kr text-4xl font-light text-[var(--hb-text-strong)] leading-tight">
            {stats.avg.toLocaleString()}
            <span className="text-base text-[var(--hb-text-muted)] ml-1">원</span>
          </p>
        </div>
        <div className="bg-white rounded-[6px] shadow-[var(--shadow-raised)] p-6">
          <p className="text-sm text-[var(--hb-text-muted)] font-medium mb-2">신랑 / 신부</p>
          <p className="text-sm text-[var(--hb-text-body)] mt-1">신랑 <span className="font-medium text-[var(--hb-text-strong)]">{formatMoney(stats.groomTotal)}</span></p>
          <p className="text-sm text-[var(--hb-accent-hover)] mt-0.5">신부 <span className="font-medium">{formatMoney(stats.brideTotal)}</span></p>
        </div>
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <div className="bg-white rounded-[6px] shadow-[var(--shadow-raised)] p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif-kr text-[var(--hb-text-strong)]">
              {editId ? "축의금 수정" : "축의금 추가"}
            </h2>
            <button onClick={resetForm} className="text-[var(--hb-text-muted)] hover:text-[var(--hb-accent-hover)]">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={form.guest_name}
              onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
              placeholder="이름"
              className="px-4 py-3 rounded-[6px] bg-[var(--hb-surface-hover)] text-base text-[var(--hb-text-strong)] placeholder:text-[var(--hb-text-muted)] focus:outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]"
            />
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="금액"
              className="px-4 py-3 rounded-[6px] bg-[var(--hb-surface-hover)] text-base text-[var(--hb-text-strong)] placeholder:text-[var(--hb-text-muted)] focus:outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]"
            />
            <div className="flex gap-2">
              {(["groom", "bride"] as Side[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setForm({ ...form, side: s })}
                  className={`flex-1 py-2.5 rounded-[6px] text-sm font-medium transition-colors ${
                    form.side === s ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white" : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)]"
                  }`}
                >
                  {s === "groom" ? "예비 신랑 가족" : "예비 신부 가족"}
                </button>
              ))}
            </div>
            <select
              value={form.relation}
              onChange={(e) => setForm({ ...form, relation: e.target.value })}
              className="px-4 py-3 rounded-[6px] bg-[var(--hb-surface-hover)] text-base text-[var(--hb-text-strong)] focus:outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]"
            >
              <option value="">관계 선택</option>
              {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="flex gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setForm({ ...form, method: m.key })}
                  className={`flex-1 py-2.5 rounded-[6px] text-sm font-medium transition-colors ${
                    form.method === m.key ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white" : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)]"
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
              className="px-4 py-3 rounded-[6px] bg-[var(--hb-surface-hover)] text-base text-[var(--hb-text-strong)] focus:outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]"
            />
          </div>
          <input
            type="text"
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
            placeholder="메모 (선택)"
            className="w-full mt-3 px-4 py-3 rounded-[6px] bg-[var(--hb-surface-hover)] text-base text-[var(--hb-text-strong)] placeholder:text-[var(--hb-text-muted)] focus:outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]"
          />
          {saveError ? (
            <p role="alert" className="mt-3 rounded-[6px] bg-[#FCEDEA] px-4 py-3 text-sm leading-6 text-[#8A3D2E]">
              {saveError}
            </p>
          ) : null}
          <button
            onClick={handleSubmit}
            disabled={!form.guest_name.trim() || !form.amount || saving}
            aria-busy={saving}
            aria-label={editId ? "축의금 수정 저장" : "축의금 추가 저장"}
            className="w-full mt-4 py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-[6px] text-base font-medium shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            {saving ? "저장 중..." : editId ? "수정 완료" : "추가"}
          </button>
        </div>
      )}

      {/* 검색 & 필터 */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--hb-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 관계 검색..."
            className="w-full pl-10 pr-4 py-3 rounded-[6px] bg-white shadow-[var(--shadow-raised)] text-base text-[var(--hb-text-strong)] placeholder:text-[var(--hb-text-muted)] focus:outline-none focus:ring-2 ring-[rgba(54,83,78,0.30)]"
          />
        </div>
        <div className="flex gap-1">
          {([["all", "전체"], ["groom", "신랑"], ["bride", "신부"]] as [Side | "all", string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterSide(key)}
              className={`px-4 py-2.5 rounded-[6px] text-sm font-medium transition-colors ${
                filterSide === key
                  ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white"
                  : "bg-white text-[var(--hb-text-body)] hover:text-[var(--hb-accent-hover)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      {moneyLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[var(--hb-hairline)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-[6px] shadow-[var(--shadow-raised)]">
          <Wallet className="w-14 h-14 text-[var(--hb-text-muted)] mx-auto mb-4" />
          <p className="text-base text-[var(--hb-text-body)] font-light">축의금 내역이 없습니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-[6px] shadow-[var(--shadow-raised)] overflow-hidden">
          {filtered.map((money, i) => (
            <div
              key={money.id}
              className={`flex items-center gap-3 px-5 py-4 ${
                i > 0 ? "border-t border-[#F6F3F2]" : ""
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  money.side === "groom" ? "bg-[#504444]" : "bg-[var(--hb-primary)]"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[17px] font-medium text-[var(--hb-text-strong)]">{money.guest_name}</span>
                  {money.relation && (
                    <span className="text-sm text-[var(--hb-accent-hover)] px-2 py-0.5 bg-[var(--hb-surface-hover)] rounded-[6px]">
                      {money.relation}
                    </span>
                  )}
                </div>
                {money.memo && (
                  <p className="text-sm text-[var(--hb-text-muted)] truncate font-light">{money.memo}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-serif-kr text-xl font-light text-[var(--hb-text-strong)]">
                  {formatMoney(money.amount)}
                </div>
                <div className="text-sm text-[var(--hb-text-muted)]">{money.received_at}</div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => handleEdit(money)}
                  aria-label={`${money.guest_name} 축의금 수정`}
                  className="w-9 h-9 flex items-center justify-center rounded-[6px] hover:bg-[var(--hb-surface-hover)] text-[var(--hb-text-muted)] hover:text-[var(--hb-accent-hover)] transition-colors"
                >
                  <Edit3 className="w-5 h-5" />
                </button>
                {deleteConfirm === money.id ? (
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setDeleteConfirm(null); setDeleteError(null); }}
                        aria-label={`${money.guest_name} 축의금 삭제 취소`}
                        className="w-9 h-9 flex items-center justify-center rounded-[6px] bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)] text-sm"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => handleDelete(money.id)}
                        aria-label={`${money.guest_name} 축의금 삭제 확정`}
                        className="w-9 h-9 flex items-center justify-center rounded-[6px] bg-red-500 text-white"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {deleteError ? (
                      <p role="alert" className="max-w-[220px] text-right text-xs leading-5 text-[#8A3D2E]">
                        {deleteError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <button
                    onClick={() => { setDeleteConfirm(money.id); setDeleteError(null); }}
                    aria-label={`${money.guest_name} 축의금 삭제`}
                    className="w-9 h-9 flex items-center justify-center rounded-[6px] hover:bg-red-50 text-[var(--hb-text-muted)] hover:text-red-500 transition-colors"
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
