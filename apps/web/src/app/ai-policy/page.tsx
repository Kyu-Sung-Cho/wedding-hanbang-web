import type { Metadata } from "next";
import Link from "next/link";
import { getAmoraModelConfig } from "@/lib/ai/modelConfig";

export const metadata: Metadata = {
  title: "AI 정책 | 웨딩한방",
  description:
    "웨딩한방 AI 서비스의 투명성, 안전성, 개인정보와 사용자 확인 원칙을 안내합니다.",
};

export default function AIPolicyPage() {
  const primaryModel = getAmoraModelConfig("primary").model;
  const fastModel = getAmoraModelConfig("fast").model;

  return (
    <div className="min-h-screen bg-[#fcf9f8]">
      <main className="max-w-3xl mx-auto px-6 py-16 max-md:py-10">
        {/* 상단 */}
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-xs text-[#795252] hover:underline mb-3"
          >
            ← 홈으로
          </Link>
          <h1 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-3xl max-md:text-2xl text-[#1b1c1c] mb-3 leading-tight">
            웨딩한방 AI 정책
          </h1>
          <p className="text-sm text-[#504444]">
            최종 수정: 2026년 7월 14일 · 실제 안전·삭제·문의 운영 범위 반영
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
                <li>
                  사용 AI 공급자와 배포 모델을 공개합니다 (OpenAI · GPT-5.6 Luna — 일반 상담,
                  GPT-5.6 Terra — 계약·분쟁/안전·반복 수정 턴).
                </li>
                <li className="text-xs text-[#504444]/75">기술 ID: {primaryModel}, {fastModel}</li>
                <li>AI의 한계를 숨기지 않습니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[#1b1c1c] mb-2">2. 안전성</h3>
              <ul className="list-disc pl-5 text-sm text-[#504444] space-y-1 leading-relaxed">
                <li>비용·개인정보·도구 사용·위기 응답의 안전 경계를 코드와 내부 문서로 관리합니다.</li>
                <li>중요한 계약·금액·일정 판단은 사용자가 원문과 업체를 확인한 뒤 직접 결정하도록 안내합니다.</li>
                <li>자해·타해, 즉각적인 신체 위험, 관계폭력·스토킹 단서가 명확하면 생성형 답변보다 고정된 긴급 안내를 먼저 제공합니다.</li>
                <li>오류와 안전 문제의 공개 접수 경로는 실제 수신·처리 절차를 검증한 뒤에만 안내합니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[#1b1c1c] mb-2">3. 사용자 권리</h3>
              <ul className="list-disc pl-5 text-sm text-[#504444] space-y-1 leading-relaxed">
                <li>비공개 대화는 본인이 영구 삭제할 수 있습니다. 공유 대화는 양쪽 화면에서 정리할 수 있지만 현재 물리 삭제는 지원하지 않습니다.</li>
                <li>보안·감사 기록은 개인정보처리방침에 공개한 별도 보유기간과 삭제·비식별화 절차를 따릅니다.</li>
                <li>Couple Memory는 사용자가 자신의 결혼 준비 기록을 관리하기 위한 데이터이며, 운영자가 임의의 영업 자산처럼 판매하지 않습니다.</li>
                <li>제3자에게 판매하지 않습니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[#1b1c1c] mb-2">4. 고지와 개인정보 처리</h3>
              <p className="text-sm text-[#504444] leading-relaxed">
                서비스가 생성형 AI를 사용한다는 사실과 AI 생성 결과를 화면에 표시합니다.
                개인정보의 항목, 목적, 보유기간과 삭제 절차는 개인정보처리방침에 공개하며,
                채팅 메시지와 별도 보안·감사 기록은 각 공개 기간에 따라 삭제·비식별화합니다.
              </p>
            </div>
          </div>
        </section>

        {/* Section 2 — 운영 문의 */}
        <section className="mb-10 p-6 max-md:p-5 bg-white rounded-2xl border border-[#e5dcdc]">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[#1b1c1c] mb-4">
            AI 운영 문의
          </h2>
          <ul className="text-sm text-[#504444] space-y-2 leading-relaxed">
            <li>
              <strong className="text-[#1b1c1c]">담당</strong>: 웨딩한방 운영자
            </li>
            <li><strong className="text-[#1b1c1c]">현재 상태</strong>: 공개 문의 접수 기능 닫힘</li>
            <li><strong className="text-[#1b1c1c]">공개 조건</strong>: 수신·본인 확인·처리 기록·삭제 절차 검증 완료</li>
          </ul>
        </section>

        {/* Section 3 — AI의 한계 */}
        <section className="mb-10">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[#1b1c1c] mb-4">
            AI의 한계
          </h2>
          <p className="text-sm text-[#504444] mb-4 leading-relaxed">
            아모라는 OpenAI의 GPT 모델과 사용자가 제공한 결혼 준비 맥락을 바탕으로 답변하는 AI입니다. 다음 사항을 인지하시기 바랍니다:
          </p>
          <ul className="list-disc pl-5 text-sm text-[#504444] space-y-2 leading-relaxed">
            <li>법률 자문을 대체하지 않습니다. 계약 관련 중요 결정은 변호사와 상의하세요.</li>
            <li>가격 정보는 조사·등록 시점 이후 달라질 수 있습니다. 최종 가격은 업체와 직접 확인하세요.</li>
            <li>대화를 통해 고민 정리를 돕지만 전문 심리상담이나 의료 서비스를 대체하지 않습니다.</li>
          </ul>
        </section>

        {/* Section 4 — 문제 신고 */}
        <section className="mb-6">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[#1b1c1c] mb-4">
            문제 신고
          </h2>
          <p className="text-sm text-[#504444] leading-relaxed">
            현재 공개 문제 신고 접수는 열지 않았습니다. 수신 확인, 담당자 권한, 처리 기록과 개인정보 보호
            절차를 검증한 뒤 이 페이지에 실제 이용 가능한 접수 방법을 안내하겠습니다.
          </p>
        </section>

        {/* 하단 */}
        <div className="pt-8 mt-8 border-t border-[#e5dcdc] text-xs text-[#504444]/70">
          <p>
            본 문서는 웨딩한방의 현재 자체 운영 원칙을 설명하며, 법률 검토나 규제 준수 완료를
            증명하는 문서가 아닙니다. 중요한 변경은 이 페이지에 업데이트됩니다.
          </p>
        </div>
      </main>
    </div>
  );
}
