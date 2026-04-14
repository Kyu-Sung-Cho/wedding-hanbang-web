"use client";

import { useState } from "react";
import { Plus, Trash2, Calculator, Users, TrendingUp, Loader2 } from "lucide-react";

type Relation = "family" | "relative" | "friend" | "coworker" | "boss" | "acquaintance";
type Side = "bride" | "groom";

interface GuestGroup {
  id: number;
  relation: Relation;
  count: number;
  side: Side;
}

interface BreakdownItem {
  relation: string;
  label: string;
  count: number;
  averagePerPerson: number;
  subtotal: number;
  side: string;
}

interface PredictResult {
  total_guests: number;
  predicted_total: number;
  breakdown: BreakdownItem[];
  side_totals: { bride: number; groom: number };
  range: { min: number; max: number };
  tips: string[];
}

const RELATION_OPTIONS: { value: Relation; label: string }[] = [
  { value: "family", label: "가족" },
  { value: "relative", label: "친척" },
  { value: "friend", label: "친구" },
  { value: "coworker", label: "직장동료" },
  { value: "boss", label: "직장상사" },
  { value: "acquaintance", label: "지인" },
];

// 금액 포맷 (만원 단위)
function formatKRW(amount: number): string {
  if (amount >= 10000) {
    const man = Math.floor(amount / 10000);
    const rest = amount % 10000;
    if (rest === 0) return `${man.toLocaleString()}만원`;
    return `${man.toLocaleString()}만 ${rest.toLocaleString()}원`;
  }
  return `${amount.toLocaleString()}원`;
}

let nextId = 1;

export default function MoneyPredictPage() {
  const [guests, setGuests] = useState<GuestGroup[]>([
    { id: nextId++, relation: "family", count: 10, side: "bride" },
    { id: nextId++, relation: "friend", count: 30, side: "bride" },
    { id: nextId++, relation: "coworker", count: 20, side: "groom" },
  ]);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addGroup() {
    setGuests((prev) => [
      ...prev,
      { id: nextId++, relation: "friend", count: 1, side: "bride" },
    ]);
  }

  function removeGroup(id: number) {
    setGuests((prev) => prev.filter((g) => g.id !== id));
  }

  function updateGroup(id: number, field: keyof GuestGroup, value: string | number) {
    setGuests((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [field]: value } : g))
    );
  }

  async function handlePredict() {
    if (guests.length === 0) {
      setError("하객 그룹을 최소 1개 추가해주세요");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/predict-money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guests: guests.map(({ relation, count, side }) => ({ relation, count, side })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "예측에 실패했습니다");
      }

      const data: PredictResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-noir-800 tracking-tight">
          축의금 예측기
        </h1>
        <p className="mt-1 text-[14px] text-taupe-500">
          하객 구성을 입력하면 예상 축의금 총액을 계산해드려요
        </p>
      </div>

      {/* 하객 그룹 입력 */}
      <div className="bg-white rounded-2xl border border-ivory-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-medium text-noir-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-rose-500" />
            하객 그룹
          </h2>
          <button
            onClick={addGroup}
            className="flex items-center gap-1 text-[13px] text-rose-500 hover:text-rose-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            그룹 추가
          </button>
        </div>

        <div className="space-y-3">
          {guests.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50 border border-ivory-200"
            >
              {/* 관계 선택 */}
              <select
                value={group.relation}
                onChange={(e) => updateGroup(group.id, "relation", e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white border border-ivory-200 text-[13px] text-noir-800 focus:outline-none focus:border-rose-500 transition-colors"
              >
                {RELATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* 인원 입력 */}
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={group.count}
                  onChange={(e) =>
                    updateGroup(group.id, "count", Math.max(0, parseInt(e.target.value) || 0))
                  }
                  className="w-16 px-2 py-2 rounded-lg bg-white border border-ivory-200 text-center text-[13px] text-noir-800 focus:outline-none focus:border-rose-500 transition-colors"
                />
                <span className="text-[12px] text-taupe-400">명</span>
              </div>

              {/* 신랑/신부측 토글 */}
              <div className="flex rounded-lg overflow-hidden border border-ivory-200">
                <button
                  onClick={() => updateGroup(group.id, "side", "bride")}
                  className={`px-3 py-1.5 text-[12px] transition-colors ${
                    group.side === "bride"
                      ? "bg-rose-500 text-white"
                      : "bg-white text-taupe-400 hover:bg-ivory-100"
                  }`}
                >
                  신부측
                </button>
                <button
                  onClick={() => updateGroup(group.id, "side", "groom")}
                  className={`px-3 py-1.5 text-[12px] transition-colors ${
                    group.side === "groom"
                      ? "bg-noir-800 text-white"
                      : "bg-white text-taupe-400 hover:bg-ivory-100"
                  }`}
                >
                  신랑측
                </button>
              </div>

              {/* 삭제 */}
              <button
                onClick={() => removeGroup(group.id)}
                className="p-1.5 rounded-lg text-taupe-400 hover:text-red-400 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

          {guests.length === 0 && (
            <div className="text-center py-8 text-taupe-400 text-[13px]">
              하객 그룹을 추가해주세요
            </div>
          )}
        </div>
      </div>

      {/* 예측 버튼 */}
      <button
        onClick={handlePredict}
        disabled={loading || guests.length === 0}
        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-rose-500 to-gold text-white text-[15px] font-medium flex items-center justify-center gap-2 hover:shadow-[0_4px_20px_rgba(196,150,126,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Calculator className="w-5 h-5" />
        )}
        {loading ? "계산 중..." : "예측하기"}
      </button>

      {/* 에러 */}
      {error && (
        <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[13px]">
          {error}
        </div>
      )}

      {/* 결과 */}
      {result && (
        <div className="mt-8 space-y-6">
          {/* 총액 카드 */}
          <div className="bg-gradient-to-br from-noir-800 to-noir-900 rounded-2xl p-6 text-white">
            <p className="text-[13px] text-taupe-400 mb-1">예상 축의금 총액</p>
            <p className="text-3xl font-light tracking-tight font-cormorant">
              {formatKRW(result.predicted_total)}
            </p>
            <div className="mt-4 flex items-center gap-4 text-[13px]">
              <span className="text-taupe-400">
                총 하객 <span className="text-white font-medium">{result.total_guests}명</span>
              </span>
              <span className="text-taupe-400">
                예상 범위{" "}
                <span className="text-white font-medium">
                  {formatKRW(result.range.min)} ~ {formatKRW(result.range.max)}
                </span>
              </span>
            </div>
          </div>

          {/* 신랑/신부 측 비교 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-ivory-200 p-5">
              <p className="text-[12px] text-taupe-400 mb-1">신부측 예상</p>
              <p className="text-xl font-medium text-rose-500 font-cormorant">
                {formatKRW(result.side_totals.bride)}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-ivory-200 p-5">
              <p className="text-[12px] text-taupe-400 mb-1">신랑측 예상</p>
              <p className="text-xl font-medium text-noir-800 font-cormorant">
                {formatKRW(result.side_totals.groom)}
              </p>
            </div>
          </div>

          {/* 상세 내역 */}
          <div className="bg-white rounded-2xl border border-ivory-200 p-6">
            <h3 className="text-[15px] font-medium text-noir-800 flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-rose-500" />
              관계별 상세 내역
            </h3>
            <div className="space-y-3">
              {result.breakdown.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 border-b border-ivory-100 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        item.side === "bride" ? "bg-rose-500" : "bg-noir-800"
                      }`}
                    />
                    <div>
                      <p className="text-[14px] text-noir-800">{item.label}</p>
                      <p className="text-[12px] text-taupe-400">
                        {item.count}명 x {formatKRW(item.averagePerPerson)}
                      </p>
                    </div>
                  </div>
                  <p className="text-[14px] font-medium text-noir-800">
                    {formatKRW(item.subtotal)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* 팁 */}
          <div className="bg-ivory-100 rounded-2xl p-6">
            <h3 className="text-[14px] font-medium text-noir-800 mb-3">
              알아두면 좋은 팁
            </h3>
            <ul className="space-y-2">
              {result.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-taupe-500">
                  <span className="text-gold mt-0.5">&#8226;</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
