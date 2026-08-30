"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Users, Sparkles, ArrowRight, Loader2, CalendarCheck, MessageCircle, ShieldCheck } from "lucide-react";
import { weddingPath } from "@/lib/weddingPaths";
import {
  FLEX_COHORT_MONTH,
  FLEX_COHORT_SHORT_LABEL,
  FLEX_COHORT_YEAR,
  quarterToMonth,
} from "@/utils/quarter";

type Status = "loading" | "unauth" | "need-date" | "error";
type SelectedCohort = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  month: number;
  label?: string;
  timing?: "flexible";
} | null;

function LoadingState() {
  return (
    <div className="min-h-[68vh] bg-[linear-gradient(180deg,#fffdf8_0%,#fbf8f2_52%,#f6efe5_100%)] px-4 py-8 sm:px-6 lg:py-12">
      <section className="mx-auto grid max-w-[1080px] overflow-hidden rounded-[24px] border border-[var(--hb-hairline)] bg-white shadow-[var(--shadow-overlay)] md:grid-cols-[1.05fr_0.95fr]">
        <div className="relative min-h-[280px] bg-[url('/images/amora-hero-bouquet-custom.webp')] bg-cover bg-[position:center_45%] md:order-2">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,253,248,0.04)_0%,rgba(255,253,248,0.78)_100%)] md:bg-[linear-gradient(90deg,rgba(255,253,248,0.72)_0%,rgba(255,253,248,0.05)_100%)]" />
        </div>

        <div className="p-6 sm:p-8 lg:p-10">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#EEF4F1] px-3 py-1.5 text-xs font-semibold text-[var(--hb-text-strong)]">
            <Users className="h-4 w-4" />
            Wedding Cohort Lounge
          </div>
          <h1 className="font-serif-kr text-[30px] font-medium leading-[1.25] text-[var(--hb-text-strong)] sm:text-[38px]">
            같은 시기 예비부부와
            <br />
            함께 준비하는 방
          </h1>
          <p className="mt-4 text-[14px] font-medium leading-[1.8] text-[var(--hb-text-body)] sm:text-[15px]">
            결혼 예정월 기준으로 같은 시기 예비부부와 자동 매칭됩니다. 방을 확인하는 동안에도 커뮤니티 흐름을 바로 볼 수 있어요.
          </p>

          <div className="mt-6 grid gap-3">
            {[
              { icon: MessageCircle, label: "가격·후기·고민을 주제별로 대화" },
              { icon: CalendarCheck, label: "같은 분기 커플의 준비 흐름 참고" },
              { icon: ShieldCheck, label: "실명 없이 필요한 정보만 안전하게 공유" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 rounded-[14px] border border-[var(--hb-hairline)] bg-[#fffdf8] px-4 py-3">
                <item.icon className="h-4 w-4 text-[var(--hb-text-strong)]" />
                <span className="text-sm font-semibold text-[var(--hb-text-strong)]">{item.label}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white opacity-80 shadow-[var(--shadow-raised)]"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            입장 준비 중
          </button>

          <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-[var(--hb-text-muted)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--hb-text-strong)]" />
            내 동기방을 바로 연결하고 있어요
          </p>
        </div>
      </section>
    </div>
  );
}

function parseSelectedCohort(searchParams: URLSearchParams): SelectedCohort {
  if (searchParams.get("timing") === "later") {
    return {
      year: FLEX_COHORT_YEAR,
      quarter: 4,
      month: FLEX_COHORT_MONTH,
      label: FLEX_COHORT_SHORT_LABEL,
      timing: "flexible",
    };
  }

  const year = Number(searchParams.get("year"));
  const quarter = Number(searchParams.get("quarter"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (![1, 2, 3, 4].includes(quarter)) return null;
  return {
    year,
    quarter: quarter as 1 | 2 | 3 | 4,
    month: quarterToMonth(quarter as 1 | 2 | 3 | 4),
  };
}

export default function CohortIndexPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CohortIndexInner />
    </Suspense>
  );
}

function CohortIndexInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedCohort = useMemo(() => parseSelectedCohort(new URLSearchParams(searchParams.toString())), [searchParams]);
  const redirectPath = selectedCohort
    ? selectedCohort.timing === "flexible"
      ? weddingPath("/community/cohort?timing=later")
      : weddingPath(`/community/cohort?year=${selectedCohort.year}&quarter=${selectedCohort.quarter}`)
    : weddingPath("/community/cohort");
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (selectedCohort) {
          const assignRes = await fetch("/api/community/cohort", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year: selectedCohort.year, month: selectedCohort.month }),
          });
          const assignData = await assignRes.json().catch(() => ({}));
          if (cancelled) return;

          if (assignRes.status === 401) {
            setStatus("unauth");
            return;
          }

          if (assignData?.room_id) {
            router.replace(weddingPath(`/community/cohort/${assignData.room_id}`));
            return;
          }

          setStatus("error");
          setErrorMsg(assignData?.error ?? "선택한 동기방을 열 수 없어요.");
          return;
        }

        const assignRes = await fetch("/api/community/cohort/auto-assign", {
          method: "POST",
          credentials: "include",
        });
        const assignData = await assignRes.json().catch(() => ({}));
        if (cancelled) return;

        if (assignData?.room_id) {
          router.replace(weddingPath(`/community/cohort/${assignData.room_id}`));
          return;
        }

        if (assignData?.reason === "unauthenticated") {
          setStatus("unauth");
          return;
        }

        if (
          assignData?.reason === "no_wedding_date" ||
          assignData?.reason === "no_journey" ||
          assignData?.reason === "no_couple"
        ) {
          setStatus("need-date");
          return;
        }

        setStatus("error");
        setErrorMsg(assignData?.error ?? "동기방을 찾을 수 없어요.");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, selectedCohort]);

  if (status === "loading") {
    return <LoadingState />;
  }

  const selectedLabel = selectedCohort
    ? selectedCohort.label ?? `${selectedCohort.year}년 ${selectedCohort.quarter}분기`
    : null;
  const content = {
    unauth: {
      title: "로그인하면 동기방으로 바로 연결돼요",
      desc: selectedLabel
        ? `${selectedLabel} 동기방에 입장하려면 먼저 로그인해주세요. 로그인 후 선택한 분기 방으로 이어집니다.`
        : "결혼 예정월 기준으로 같은 시기 예비부부와 자동 매칭됩니다. 먼저 로그인해주세요.",
      href: `/login?redirect=${encodeURIComponent(redirectPath)}`,
      cta: "로그인하고 입장",
    },
    "need-date": {
      title: "날짜 미정 방으로 안내할게요",
      desc: "예정일이 아직 없거나 1년보다 멀면 날짜 미정·1년 이후 방에서 먼저 준비 흐름을 잡을 수 있어요.",
      href: weddingPath("/community/cohort?timing=later"),
      cta: "미정 방으로 입장",
    },
    error: {
      title: "잠시 동기방을 열 수 없어요",
      desc: errorMsg ?? "잠시 후 다시 시도해주세요.",
      href: weddingPath(),
      cta: "커뮤니티로 돌아가기",
    },
  }[status];

  return (
    <div className="min-h-[68vh] bg-[linear-gradient(180deg,#fffdf8_0%,#fbf8f2_52%,#f6efe5_100%)] px-4 py-8 sm:px-6 lg:py-12">
      <section className="mx-auto grid max-w-[1080px] overflow-hidden rounded-[24px] border border-[var(--hb-hairline)] bg-white shadow-[var(--shadow-overlay)] md:grid-cols-[1.05fr_0.95fr]">
        <div className="relative min-h-[280px] bg-[url('/images/amora-hero-bouquet-custom.webp')] bg-cover bg-[position:center_45%] md:order-2">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,253,248,0.04)_0%,rgba(255,253,248,0.78)_100%)] md:bg-[linear-gradient(90deg,rgba(255,253,248,0.72)_0%,rgba(255,253,248,0.05)_100%)]" />
        </div>

        <div className="p-6 sm:p-8 lg:p-10">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#EEF4F1] px-3 py-1.5 text-xs font-semibold text-[var(--hb-text-strong)]">
            <Users className="h-4 w-4" />
            {selectedLabel ?? "Wedding Cohort Lounge"}
          </div>
          <h1 className="font-serif-kr text-[30px] font-medium leading-[1.25] text-[var(--hb-text-strong)] sm:text-[38px]">
            같은 시기 예비부부와
            <br />
            함께 준비하는 방
          </h1>
          <p className="mt-4 text-[14px] font-medium leading-[1.8] text-[var(--hb-text-body)] sm:text-[15px]">
            {content.desc}
          </p>

          <div className="mt-6 grid gap-3">
            {[
              { icon: MessageCircle, label: "가격·후기·고민을 주제별로 대화" },
              { icon: CalendarCheck, label: "같은 분기 커플의 준비 흐름 참고" },
              { icon: ShieldCheck, label: "실명 없이 필요한 정보만 안전하게 공유" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 rounded-[14px] border border-[var(--hb-hairline)] bg-[#fffdf8] px-4 py-3">
                <item.icon className="h-4 w-4 text-[var(--hb-text-strong)]" />
                <span className="text-sm font-semibold text-[var(--hb-text-strong)]">{item.label}</span>
              </div>
            ))}
          </div>

          <Link
            href={content.href}
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white shadow-[var(--shadow-raised)] transition-colors hover:bg-[var(--hb-primary-hover)]"
          >
            {content.cta}
            <ArrowRight className="h-4 w-4" />
          </Link>

          <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-[var(--hb-text-muted)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--hb-text-strong)]" />
            {content.title}
          </p>
        </div>
      </section>
    </div>
  );
}
