"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function CustomerSurveyPage() {
  useEffect(() => {
    try {
      localStorage.removeItem("wedding_survey_draft");
    } catch {
      // Legacy browser cleanup is best-effort. The server API is permanently closed.
    }
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory-50 px-5 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-black/[0.06] bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold tracking-[0.18em] text-rose-500">설문 접수 종료</p>
        <h1 className="mt-4 font-serif-kr text-3xl font-medium text-noir-800">
          현재 설문 응답을 받지 않습니다
        </h1>
        <p className="mt-4 text-sm leading-7 text-taupe-500">
          이 설문은 종료되어 질문 화면과 제출 기능을 제거했습니다. 인구통계·예산·자유서술 응답을
          새로 수집하지 않으며, 이 브라우저에 남은 과거 작성 중 응답도 제거합니다.
        </p>
        <Link
          href="/demo"
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-noir-800 px-6 text-sm font-semibold text-white"
        >
          서비스 소개로 돌아가기
        </Link>
      </section>
    </main>
  );
}
