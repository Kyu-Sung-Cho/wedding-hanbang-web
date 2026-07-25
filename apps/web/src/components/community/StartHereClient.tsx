"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { weddingLinkProps } from "@/lib/weddingPaths";

// 예식일 하나만 받아 "지금 열어야 하는 항목"을 보여준다.
// 로그인·가입 없이 첫 가치를 주는 것이 목적이라 아무것도 저장하지 않는다.

type Preset = "standard" | "small";

// 작은 결혼식·재혼 등에서 흔히 생략하는 항목. 정답이 아니라 기본값 제안일 뿐이라
// 화면에서 언제든 되돌릴 수 있게 한다(제품 원칙: 관습을 정답처럼 가정하지 않기).
const OFTEN_SKIPPED = new Set(["ham", "pyebaek", "yedan", "hanbok"]);

function daysUntil(dateText: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const [year, month, day] = dateText.split("-").map(Number);
  const target = new Date(year, month - 1, day);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function StartHereClient() {
  const [dateText, setDateText] = useState("");
  const [preset, setPreset] = useState<Preset>("standard");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const dday = useMemo(() => daysUntil(dateText), [dateText]);

  const applyPreset = (next: Preset) => {
    setPreset(next);
    setSkipped(next === "small" ? new Set(OFTEN_SKIPPED) : new Set());
  };

  const toggleSkip = (key: string) => {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 지금 "열려 있는" 항목: 시작 권장일이 지났고 마감 권장일이 아직 남은 것.
  const openNow = useMemo(() => {
    if (dday === null) return [];
    return CATEGORY_CHECKLISTS
      .filter((category) => !skipped.has(category.key))
      .map((category) => ({
        key: category.key,
        label: category.label,
        tip: category.tip,
        firstSteps: category.items.slice(0, 3).map((item) => item.label),
        daysUntilDeadline: dday - category.ddayDeadline,
        started: dday <= category.ddayStart,
      }))
      .filter((category) => category.started)
      .sort((left, right) => left.daysUntilDeadline - right.daysUntilDeadline)
      .slice(0, 3);
  }, [dday, skipped]);

  const skippable = CATEGORY_CHECKLISTS.filter((category) => OFTEN_SKIPPED.has(category.key));

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold tracking-[0.13em] text-[#8F6662]">로그인 없이 · 저장하지 않아요</p>
      <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-[#243832] sm:text-4xl">
        지금 뭐부터 하면 되나요?
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#243832]/70">
        예식일만 알려주시면, 지금 열어야 하는 항목 세 가지와 첫 걸음을 정리해 드려요.
        아직 날짜가 없어도 대략만 넣어보세요 — 언제든 바꿀 수 있어요.
      </p>

      <label className="mt-6 flex min-h-14 items-center gap-3 rounded-2xl border border-[#243832]/12 bg-white px-4 focus-within:border-[#36534E]/45">
        <CalendarDays aria-hidden="true" className="size-5 shrink-0 text-[#8F6662]" />
        <span className="sr-only">예식 예정일</span>
        <input
          type="date"
          value={dateText}
          onChange={(event) => setDateText(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base text-[#243832] outline-none"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        {([
          ["standard", "일반적인 준비"],
          ["small", "작은 결혼식으로"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => applyPreset(value)}
            aria-pressed={preset === value}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
              preset === value
                ? "border-[#243832] bg-[#36534E] text-white"
                : "border-[#243832]/15 bg-white text-[#243832] hover:bg-[#F5ECE4]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {dday !== null && dday < 0 ? (
        <p className="mt-6 rounded-2xl bg-[#F5ECE4] px-5 py-4 text-sm leading-6 text-[#7C5754]">
          이미 지난 날짜예요. 결혼식을 마치셨다면 축하드려요! 다른 날짜로 바꿔서 보실 수도 있어요.
        </p>
      ) : null}

      {openNow.length > 0 ? (
        <section className="mt-8" aria-label="지금 열어야 하는 항목">
          <h2 className="text-lg font-bold tracking-[-0.02em] text-[#243832]">
            예식까지 {dday}일 — 지금은 이것부터
          </h2>
          <ul className="mt-4 space-y-3">
            {openNow.map((category) => (
              <li key={category.key} className="rounded-[20px] border border-[#243832]/12 bg-white px-5 py-5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-base font-bold text-[#243832]">{category.label}</span>
                  <span className={`text-sm font-semibold ${category.daysUntilDeadline < 0 ? "text-[#B4524A]" : "text-[#8F6662]"}`}>
                    {category.daysUntilDeadline < 0
                      ? `권장 마감보다 ${Math.abs(category.daysUntilDeadline)}일 지남`
                      : `권장 마감까지 ${category.daysUntilDeadline}일`}
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {category.firstSteps.map((step) => (
                    <li key={step} className="flex gap-2 text-sm leading-6 text-[#243832]/75">
                      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[#B89785]" />
                      {step}
                    </li>
                  ))}
                </ul>
                {category.tip ? (
                  <p className="mt-3 rounded-xl bg-[#FBF8F2] px-4 py-3 text-[13px] leading-6 text-[#243832]/65">
                    {category.tip}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-[20px] bg-[#36534E] px-5 py-5 text-white">
            <p className="text-sm font-bold">이 목록을 계속 관리하고 싶다면</p>
            <p className="mt-1 text-sm leading-6 text-white/75">
              가입하면 체크한 내용이 저장되고, 고비마다 아모라가 먼저 챙겨드려요.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/login?mode=signup"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-bold text-[#243832]"
              >
                내 목록으로 저장하기
              </Link>
              <Link
                href="/demo"
                prefetch={false}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-white/35 px-5 text-sm font-semibold text-white"
              >
                가입 없이 먼저 둘러보기
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {dday !== null && dday >= 0 && openNow.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-[#243832]/12 bg-white px-5 py-5 text-sm leading-6 text-[#243832]/70">
          아직 서둘러 시작할 항목이 없어요. 지금은 두 사람의 예산 기준과 원하는 분위기를 이야기해 두면 충분해요.
        </p>
      ) : null}

      <section className="mt-10" aria-label="우리는 안 하는 항목">
        <h2 className="text-base font-bold text-[#243832]">우리는 안 하는 것도 있어요</h2>
        <p className="mt-1 text-sm leading-6 text-[#243832]/65">
          가족·지역마다 하는 항목이 달라요. 안 하는 건 빼고 봐도 괜찮아요.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {skippable.map((category) => {
            const off = skipped.has(category.key);
            return (
              <button
                key={category.key}
                type="button"
                onClick={() => toggleSkip(category.key)}
                aria-pressed={off}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
                  off
                    ? "border-[#243832]/12 bg-[#f6f4f0] text-[#8b857c] line-through"
                    : "border-[#243832]/15 bg-white text-[#243832] hover:bg-[#F5ECE4]"
                }`}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-10 flex flex-wrap gap-3 text-sm font-semibold">
        <Link href="/price" prefetch={false} className="text-[#36534E] underline underline-offset-4">
          업체별 공시 가격 보기
        </Link>
        <Link
          {...weddingLinkProps("/community/quote-check")}
          prefetch={false}
          className="text-[#36534E] underline underline-offset-4"
        >
          받은 견적서 확인하기
        </Link>
      </div>
    </div>
  );
}
