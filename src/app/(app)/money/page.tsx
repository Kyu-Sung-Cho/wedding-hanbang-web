"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useInvitationStore } from "@/stores/invitationStore";
import type { Side, Relation, MoneyMethod, CongratulatoryMoney } from "@/types/invitation.types";
import {
  Plus, Search, Download, Wallet, Users, TrendingUp,
  Edit3, Trash2, X, Check, Filter,
} from "lucide-react";

const RELATIONS: Relation[] = ["친구", "직장동료", "가족", "친척", "은사", "이웃", "기타"];
const METHODS: { key: MoneyMethod; label: string }[] = [
  { key: "cash", label: "현금" },
  { key: "transfer", label: "이체" },
  { key: "etc", label: "기타" },
];

export default function MoneyPage() {
  const { couple } = useAuthStore();
  const { moneyList, moneyLoading, loadMoney, addMoney, updateMoney, deleteMoney } = useInvitationStore();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterSide, setFilterSide] = useState<Side | "all">("all");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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
      received_at: new Date().toISOString().slice(0, 10),
    });
    setEditId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!form.guest_name.trim() || !form.amount) return;
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
    await deleteMoney(id);
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
    a.download = `축의금_내역_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatMoney = (n: number) => n.toLocaleString("ko-KR") + "원";

  return (
    <div className="max-w-[1250px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[35px] font-semibold text-noir-800">축의금 관리</h1>
          <p className="text-[25px] text-taupe-500 mt-1">축의금 내역을 기록하고 관리하세요</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            disabled={moneyList.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-black/[0.06] rounded-xl text-[25px] font-medium text-taupe-500 hover:bg-ivory-100 disabled:opacity-30 transition-colors"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-noir-800 text-white rounded-xl text-[25px] font-medium hover:bg-noir-900 transition-colors"
          >
            <Plus className="w-4 h-4" />
            추가
          </button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-black/[0.06] p-4">
          <Wallet className="w-5 h-5 text-rose-500 mb-2" />
          <div className="text-[23px] font-semibold text-noir-800">{formatMoney(stats.total)}</div>
          <div className="text-[23px] text-taupe-500">총 축의금</div>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.06] p-4">
          <Users className="w-5 h-5 text-blue-500 mb-2" />
          <div className="text-[23px] font-semibold text-noir-800">{stats.count}명</div>
          <div className="text-[23px] text-taupe-500">총 인원</div>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.06] p-4">
          <TrendingUp className="w-5 h-5 text-green-500 mb-2" />
          <div className="text-[23px] font-semibold text-noir-800">{formatMoney(stats.avg)}</div>
          <div className="text-[23px] text-taupe-500">평균</div>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.06] p-4">
          <div className="flex gap-2 mb-2">
            <span className="text-[23px] text-blue-500">신랑 {formatMoney(stats.groomTotal)}</span>
          </div>
          <span className="text-[23px] text-rose-500">신부 {formatMoney(stats.brideTotal)}</span>
        </div>
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-black/[0.06] p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[38px] font-medium text-noir-800">
              {editId ? "축의금 수정" : "축의금 추가"}
            </h2>
            <button onClick={resetForm} className="text-taupe-400 hover:text-noir-800">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={form.guest_name}
              onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
              placeholder="이름"
              className="px-3 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500"
            />
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="금액"
              className="px-3 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500"
            />
            <div className="flex gap-2">
              {(["groom", "bride"] as Side[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setForm({ ...form, side: s })}
                  className={`flex-1 py-2 rounded-lg text-[38px] font-medium transition-colors ${
                    form.side === s ? "bg-noir-800 text-white" : "bg-ivory-100 text-taupe-500"
                  }`}
                >
                  {s === "groom" ? "신랑측" : "신부측"}
                </button>
              ))}
            </div>
            <select
              value={form.relation}
              onChange={(e) => setForm({ ...form, relation: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 focus:outline-none focus:border-rose-500"
            >
              <option value="">관계 선택</option>
              {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="flex gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setForm({ ...form, method: m.key })}
                  className={`flex-1 py-2 rounded-lg text-[38px] font-medium transition-colors ${
                    form.method === m.key ? "bg-noir-800 text-white" : "bg-ivory-100 text-taupe-500"
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
              className="px-3 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 focus:outline-none focus:border-rose-500"
            />
          </div>
          <input
            type="text"
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
            placeholder="메모 (선택)"
            className="w-full mt-3 px-3 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500"
          />
          <button
            onClick={handleSubmit}
            disabled={!form.guest_name.trim() || !form.amount}
            className="w-full mt-4 py-3 bg-rose-500 text-white rounded-xl text-[23px] font-medium hover:bg-rose-600 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            {editId ? "수정 완료" : "추가"}
          </button>
        </div>
      )}

      {/* 검색 & 필터 */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-taupe-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 관계 검색..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-black/[0.06] text-[25px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500"
          />
        </div>
        <div className="flex gap-1">
          {([["all", "전체"], ["groom", "신랑"], ["bride", "신부"]] as [Side | "all", string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterSide(key)}
              className={`px-3 py-2 rounded-xl text-[38px] font-medium transition-colors ${
                filterSide === key ? "bg-noir-800 text-white" : "bg-ivory-100 text-taupe-500"
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
          <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-black/[0.06]">
          <Wallet className="w-12 h-12 text-taupe-400 mx-auto mb-4" />
          <p className="text-[23px] text-taupe-500">축의금 내역이 없습니다</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
          {filtered.map((money, i) => (
            <div
              key={money.id}
              className={`flex items-center gap-3 px-4 py-3 ${
                i > 0 ? "border-t border-black/[0.04]" : ""
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  money.side === "groom" ? "bg-blue-500" : "bg-rose-500"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[23px] font-medium text-noir-800">{money.guest_name}</span>
                  {money.relation && (
                    <span className="text-[23px] text-taupe-400 px-1.5 py-0.5 bg-ivory-100 rounded">
                      {money.relation}
                    </span>
                  )}
                </div>
                {money.memo && (
                  <p className="text-[23px] text-taupe-400 truncate">{money.memo}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[23px] font-semibold text-noir-800">
                  {formatMoney(money.amount)}
                </div>
                <div className="text-[25px] text-taupe-400">{money.received_at}</div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => handleEdit(money)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-ivory-100 text-taupe-400"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                {deleteConfirm === money.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-ivory-100 text-taupe-500 text-[25px]"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => handleDelete(money.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-500 text-white"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(money.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-taupe-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
