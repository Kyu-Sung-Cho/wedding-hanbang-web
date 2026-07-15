import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI 정책 | 웨딩한방",
  description:
    "웨딩한방 AI 서비스의 제공 방식, 안전 원칙, 사용자 권리와 한계를 안내합니다.",
};

export default function AIPolicyPage() {
  return (
    <div className="min-h-screen bg-[#fcf9f8]">
      <main className="max-w-3xl mx-auto px-6 py-16 max-md:py-10">
        {/* 상단 */}
        <div className="mb-10">
          <Link
            href="/"
            className="inline-block text-xs text-[#795252] hover:underline mb-6"
          >
            ← 홈으로
          </Link>
          <h1 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-3xl max-md:text-2xl text-[#1b1c1c] mb-3 leading-tight">
            웨딩한방 AI 정책
          </h1>
          <p className="text-sm text-[#504444]">
            최종 수정: 2026년 7월 · OpenAI GPT-5.6 제공 방식 반영
          </p>
        </div>

        {/* Section 1 — 원칙 */}
        <section className="mb-10">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[#1b1c1c] mb-4">
            우리의 AI 원칙
          </h2>
          <p className="text-sm text-[#504444] mb-6 leading-relaxed">
            웨딩한방은 AI 기반 서비스입니다. 다음 4가지 원칙을 지킵니다.
          </p>

          <div className="space-y-7">
            <div>
              <h3 className="font-medium text-base text-[#1b1c1c] mb-2">1. 투명성</h3>
              <ul className="list-disc pl-5 text-sm text-[#504444] space-y-1 leading-relaxed">
                <li>AI가 생성한 답변임을 명확히 표시합니다.</li>
                <li>사용 AI 모델을 공개합니다 (OpenAI GPT-5.6 Luna·Terra).</li>
                <li>AI의 한계를 숨기지 않습니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[#1b1c1c] mb-2">2. 안전성</h3>
              <ul className="list-disc pl-5 text-sm text-[#504444] space-y-1 leading-relaxed">
                <li>위험관리방안을 마련하고 내부 문서로 보관합니다.</li>
                <li>사용자가 AI 답변의 문제를 신고할 수 있는 창구를 제공합니다.</li>
                <li>신고된 문제는 정해진 내부 절차에 따라 검토합니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[#1b1c1c] mb-2">3. 사용자 권리</h3>
              <ul className="list-disc pl-5 text-sm text-[#504444] space-y-1 leading-relaxed">
                <li>AI 대화 기록을 확인하고, 제공되는 기능으로 대화 목록을 비울 수 있습니다.</li>
                <li>Couple Memory 데이터는 회사의 자산이 아니라 커플의 자산입니다.</li>
                <li>제3자에게 판매하지 않습니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[#1b1c1c] mb-2">4. 법령·정책 반영</h3>
              <p className="text-sm text-[#504444] leading-relaxed">
                관련 법령과 서비스 정책을 검토해 운영에 반영합니다. 대화 기록을 비우는 기능과
                실제 보관 범위는 서비스 내 설정 및 개인정보 처리방침에서 확인할 수 있습니다.
              </p>
            </div>
          </div>
        </section>

        {/* Section 2 — 관리·감독 책임자 */}
        <section className="mb-10 p-6 max-md:p-5 bg-white rounded-2xl border border-[#e5dcdc]">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[#1b1c1c] mb-4">
            관리·감독 책임자
          </h2>
          <ul className="text-sm text-[#504444] space-y-2 leading-relaxed">
            <li>
              <strong className="text-[#1b1c1c]">이름</strong>: 조규성 (CEO)
            </li>
            <li>
              <strong className="text-[#1b1c1c]">이메일</strong>:{" "}
              <a href="mailto:ceo@hanbang.ai" className="underline hover:text-[#795252] transition-colors">
                ceo@hanbang.ai
              </a>
            </li>
            <li>
              <strong className="text-[#1b1c1c]">연락처</strong>: 이메일 문의
            </li>
          </ul>
        </section>

        {/* Section 3 — AI의 한계 */}
        <section className="mb-10">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[#1b1c1c] mb-4">
            AI의 한계
          </h2>
          <p className="text-sm text-[#504444] mb-4 leading-relaxed">
            아모라는 OpenAI GPT-5.6 Luna·Terra를 기반으로 하며, 웨딩한방이 제공하는 결혼 준비 정보와 사용자가 입력한 맥락을 바탕으로 답변합니다. 다음 사항을 인지하시기 바랍니다:
          </p>
          <ul className="list-disc pl-5 text-sm text-[#504444] space-y-2 leading-relaxed">
            <li>법률 자문을 대체하지 않습니다. 계약 관련 중요 결정은 변호사와 상의하세요.</li>
            <li>실시간 가격은 변동 가능합니다. 최종 가격은 업체와 직접 확인하세요.</li>
            <li>감정적 지원은 제공하지만 전문 상담을 대체하지 않습니다.</li>
          </ul>
        </section>

        {/* Section 4 — 문제 신고 */}
        <section className="mb-6">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[#1b1c1c] mb-4">
            문제 신고
          </h2>
          <p className="text-sm text-[#504444] leading-relaxed">
            AI 답변 오류, 부적절한 내용, 환각 현상 등을 발견하시면{" "}
            <a href="mailto:ceo@hanbang.ai" className="underline hover:text-[#795252] transition-colors">
              ceo@hanbang.ai
            </a>
            로 신고해주세요. 접수된 신고는 내부 운영 절차에 따라 확인합니다.
          </p>
        </section>

        {/* TODO(HUMAN): Confirm exact AI Basic Act article numbers before quoting specific clause numbers. */}
        {/* 하단 */}
        <div className="pt-8 mt-8 border-t border-[#e5dcdc] text-xs text-[#504444]/70">
          <p>
            AI 제공 방식이나 정책이 변경되면 본 페이지를 업데이트합니다.
          </p>
        </div>
      </main>
    </div>
  );
}
