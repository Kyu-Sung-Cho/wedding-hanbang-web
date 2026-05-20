"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

// 이전 사고: 우측 사이드바에 위젯 5개(아모라 CTA, 커뮤니티 현황 메트릭, 많이
// 언급된 업체, 커뮤니티 원칙, 좋은 글의 기준)가 쌓여 페이지가 번잡해 보였음.
// - "많이 언급된 업체"는 페이지 별도 영역 "인기 태그" 와 중복
// - "커뮤니티 원칙"은 푸터에 동일 내용 노출됨
// - "좋은 글의 기준"은 글쓰기 페이지에서 안내하면 충분
// - "커뮤니티 현황"은 정보량 대비 자리 차지가 큼
// 정리: 아모라 견적 체크 CTA 1개만 남기고 나머지는 제거. 핵심 동선(견적 점검)
// 으로 진입할 수 있는 단일 액션만 sidebar 상단에 노출.
export default function RightSidebar() {
  return (
    <section className="rounded-lg border border-[#d9c8c8] bg-[#795252] p-4 text-white shadow-[0_8px_24px_rgba(121,82,82,0.14)]">
      <div className="mb-3 flex items-center gap-2.5">
        <Sparkles className="h-4 w-4 text-[#dee6c4]" />
        <h3 className="font-serif-kr text-lg">아모라 견적 체크리스트</h3>
      </div>
      <p className="text-sm leading-relaxed text-white/80">
        받은 견적서에서 빠진 항목, 추가금 가능성, 계약 전 질문을 먼저 정리해요.
      </p>
      <Link
        href="/community/quote-check"
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-[#795252] transition-colors hover:bg-[#fff8f5]"
      >
        체크리스트 보기
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}
