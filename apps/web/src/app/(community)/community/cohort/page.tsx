"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Sparkles, ArrowRight, Loader2 } from "lucide-react";

/**
 * 동기방 인덱스 페이지.
 * - 로그인 + 가입된 방 있음 → 해당 방으로 즉시 이동
 * - 로그인 + 미가입 → auto-assign 시도 후 이동, 실패 시 안내 화면
 * - 비로그인 → 로그인 유도
 */
export default function CohortIndexPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "unauth" | "need-date" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1. 가입된 방 조회
        const res = await fetch("/api/community/cohort", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setStatus("error");
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        if (data?.room?.id) {
          router.replace(`/community/cohort/${data.room.id}`);
          return;
        }

        // 2. 미가입 → auto-assign 시도
        const assignRes = await fetch("/api/community/cohort/auto-assign", {
          method: "POST",
          credentials: "include",
        });
        const assignData = await assignRes.json().catch(() => ({}));
        if (cancelled) return;

        if (assignData?.room_id) {
          router.replace(`/community/cohort/${assignData.room_id}`);
          return;
        }

        if (assignData?.reason === "unauthenticated") {
          setStatus("unauth");
          return;
        }

        if (assignData?.reason === "no_wedding_date" || assignData?.reason === "no_journey") {
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
  }, [router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#fffdf7] text-sm text-[#928980]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        동기방으로 이동 중...
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] bg-[#fffdf7] px-4 py-12 sm:px-6 lg:py-16">
      <div className="mx-auto max-w-xl rounded-2xl border border-[#eadfc9] bg-white p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="mb-3 flex items-center gap-2 text-[#9d6f36]">
          <Users className="h-5 w-5" />
          <span className="text-xs font-medium uppercase tracking-widest">동기방</span>
        </div>
        <h1 className="font-serif-kr text-2xl text-[#071629] sm:text-3xl">
          같은 시기 예비부부와 함께
        </h1>

        {status === "unauth" && (
          <>
            <p className="mt-3 text-sm leading-6 text-[#5d6879]">
              동기방은 로그인 후 결혼 예정월 기준으로 자동 매칭돼요. 먼저 로그인해주세요.
            </p>
            <Link
              href="/login?redirect=/community/cohort"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#9d6f36] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#102a4d]"
            >
              로그인하기
              <ArrowRight className="h-4 w-4" />
            </Link>
          </>
        )}

        {status === "need-date" && (
          <>
            <p className="mt-3 text-sm leading-6 text-[#5d6879]">
              결혼 예정일을 등록하면 같은 시기 예비부부들과 자동으로 매칭돼요.
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-[#928980]">
              <Sparkles className="h-3.5 w-3.5 text-[#C9A96E]" />
              평균 가격·체크리스트도 우리 동기 데이터로 비교돼요
            </div>
            <Link
              href="/onboarding"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#9d6f36] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#102a4d]"
            >
              예정일 등록하기
              <ArrowRight className="h-4 w-4" />
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <p className="mt-3 text-sm leading-6 text-[#5d6879]">
              {errorMsg ?? "잠시 후 다시 시도해주세요."}
            </p>
            <Link
              href="/community"
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#eadfc9] bg-white px-4 py-2.5 text-sm font-medium text-[#9d6f36] transition-colors hover:bg-[#fff8ec]"
            >
              커뮤니티로 돌아가기
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
