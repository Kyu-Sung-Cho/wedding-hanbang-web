import type { Metadata } from "next";
import { CONTACT } from "@/lib/constants/contact";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI 정책 | 웨딩한방",
  description:
    "웨딩한방 AI 서비스의 제공 방식, 안전 원칙, 사용자 권리와 한계를 안내합니다.",
};

export default function AIPolicyPage() {
  return (
    <div className="min-h-screen bg-[var(--hb-surface-hover)]">
      <main className="max-w-3xl mx-auto px-6 py-16 max-md:py-10">
        {/* 상단 */}
        <div className="mb-10">
          <Link
            href="/landing"
            className="inline-block text-xs text-[var(--hb-primary)] hover:underline mb-6"
          >
            ← 홈으로
          </Link>
          <h1 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-3xl max-md:text-2xl text-[var(--hb-text-strong)] mb-3 leading-tight">
            웨딩한방 AI 정책
          </h1>
          <p className="text-sm text-[var(--hb-text-body)]">
            최종 수정일: 2026년 7월 31일
          </p>
        </div>

        {/* Section 1 — 원칙 */}
        <section className="mb-10">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[var(--hb-text-strong)] mb-4">
            우리의 AI 원칙
          </h2>
          <p className="text-sm text-[var(--hb-text-body)] mb-6 leading-relaxed">
            웨딩한방은 AI 기반 서비스입니다. 다음 4가지 원칙을 지킵니다.
          </p>

          <div className="space-y-7">
            <div>
              <h3 className="font-medium text-base text-[var(--hb-text-strong)] mb-2">1. 투명성</h3>
              <ul className="list-disc pl-5 text-sm text-[var(--hb-text-body)] space-y-1 leading-relaxed">
                <li>AI가 생성한 답변임을 명확히 표시합니다.</li>
                <li>사용 AI 모델을 공개합니다 (OpenAI GPT-5.6 Luna·Terra).</li>
                <li>AI를 사람인 것처럼 소개하지 않고, 틀리거나 빠진 답변이 생길 수 있음을 알립니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[var(--hb-text-strong)] mb-2">2. 안전성</h3>
              <ul className="list-disc pl-5 text-sm text-[var(--hb-text-body)] space-y-1 leading-relaxed">
                <li>개인정보, 계약, 결제, 안전에 영향을 줄 수 있는 답변을 별도로 점검합니다.</li>
                <li>예산·할 일·일정 저장과 다른 사람에게 공유하는 동작은 사용자가 실행 전에 확인합니다.</li>
                <li>사용자가 AI 답변의 문제를 신고할 수 있는 이메일 창구를 제공합니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[var(--hb-text-strong)] mb-2">3. 사용자 권리</h3>
              <ul className="list-disc pl-5 text-sm text-[var(--hb-text-body)] space-y-1 leading-relaxed">
                <li>AI 대화 기록을 확인하고, 제공되는 기능으로 대화 목록을 비울 수 있습니다.</li>
                <li>아모라의 개인 도움 방식을 직접 확인·수정·삭제할 수 있습니다. 이 값은 성격·유형·궁합 판정에 사용하지 않고, 현재 질문에서 직접 요청한 방식이 저장값보다 우선합니다.</li>
                <li>함께 준비할 사람과 공유할 내용과 나만 볼 내용을 구분합니다.</li>
                <li>회원의 대화와 결혼 준비 정보를 다른 사업자에게 판매하지 않습니다.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-base text-[var(--hb-text-strong)] mb-2">4. 법령·정책 반영</h3>
              <p className="text-sm text-[var(--hb-text-body)] leading-relaxed">
                「인공지능 발전과 신뢰 기반 조성 등에 관한 기본법」과 개인정보 보호 관계 법령을
                검토해 운영에 반영합니다. 실제 수집 항목과 보관 범위는{" "}
                <Link href="/privacy" className="underline hover:text-[var(--hb-primary)]">
                  개인정보 처리방침
                </Link>
                에서 확인할 수 있습니다.
              </p>
            </div>
          </div>
        </section>

        {/* Section 2 — 관리·감독 담당 */}
        <section className="mb-10 p-6 max-md:p-5 bg-white rounded-lg border border-[#e5dcdc]">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[var(--hb-text-strong)] mb-4">
            AI 운영 문의
          </h2>
          <ul className="text-sm text-[var(--hb-text-body)] space-y-2 leading-relaxed">
            <li>
              <strong className="text-[var(--hb-text-strong)]">담당</strong>: 웨딩한방 AI 운영 담당
            </li>
            <li>
              <strong className="text-[var(--hb-text-strong)]">이메일</strong>:{" "}
              <a href={`mailto:${CONTACT.email}`} className="underline hover:text-[var(--hb-primary)] transition-colors">
                {CONTACT.email}
              </a>
            </li>
          </ul>
        </section>

        {/* Section 3 — AI의 한계 */}
        <section className="mb-10">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[var(--hb-text-strong)] mb-4">
            AI의 한계
          </h2>
          <p className="text-sm text-[var(--hb-text-body)] mb-4 leading-relaxed">
            아모라는 OpenAI GPT-5.6 Luna·Terra를 이용하고, 회원이 입력한 내용과 웨딩한방의
            검토된 결혼 준비 자료를 바탕으로 답변합니다. 다음 한계가 있습니다.
          </p>
          <ul className="list-disc pl-5 text-sm text-[var(--hb-text-body)] space-y-2 leading-relaxed">
            <li>법률·세금·의료 등 자격이 필요한 전문 상담을 대신하지 않습니다.</li>
            <li>업체 공개 가격과 계약 조건은 바뀔 수 있습니다. 계약 전 업체의 최신 원문을 직접 확인해야 합니다.</li>
            <li>사용자가 입력하지 않은 예산, 가격, 일정, 가족의 생각이나 감정 상태를 사실처럼 만들지 않도록 제한하지만, 잘못된 추론이 생길 수 있습니다.</li>
            <li>개인 도움 방식은 답변의 순서와 표현만 조정합니다. 이 설정만으로 예산·일정·담당자·업체를 바꾸거나 저장하지 않습니다.</li>
          </ul>
        </section>

        {/* Section 4 — 문제 신고 */}
        <section className="mb-6">
          <h2 className="font-[family-name:var(--font-serif-kr,_'Paperlogy',_sans-serif)] text-xl text-[var(--hb-text-strong)] mb-4">
            문제 신고
          </h2>
          <p className="text-sm text-[var(--hb-text-body)] leading-relaxed">
            사실과 다른 답변, 부적절한 내용, 저장·공유 문제를 발견하면{" "}
            <a href={`mailto:${CONTACT.email}`} className="underline hover:text-[var(--hb-primary)] transition-colors">
              {CONTACT.email}
            </a>
            로 알려주세요. 접수 내용을 확인한 뒤 처리 결과를 안내합니다.
          </p>
        </section>

        {/* 하단 */}
        <div className="pt-8 mt-8 border-t border-[#e5dcdc] text-xs text-[var(--hb-text-body)]/70">
          <p>
            AI 제공 방식이나 정책이 변경되면 본 페이지를 업데이트합니다.
          </p>
        </div>
      </main>
    </div>
  );
}
