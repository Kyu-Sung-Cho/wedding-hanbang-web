"use client";

import Link from "next/link";
import { CONTACT } from "@/lib/constants/contact";
import { ArrowLeft } from "lucide-react";

import { businessInfoRows, readBusinessInfo } from "@/lib/legal/businessInfo";

export default function TermsPage() {
  const businessInfo = readBusinessInfo();
  const operatorName = businessInfo?.companyName ?? "웨딩한방 운영자";

  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)]">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/[0.04]">
        <div className="max-w-[800px] mx-auto px-6 h-16 flex items-center">
          <Link href="/landing" className="flex items-center gap-2 text-[13px] text-[var(--hb-text-body)] hover:text-[var(--color-rose-700)] transition-colors">
            <ArrowLeft className="w-4 h-4" />
            홈으로
          </Link>
        </div>
      </nav>

      <div className="max-w-[800px] mx-auto px-6 py-16 max-md:px-5 max-md:py-10">
        <h1 className="font-serif-kr text-[28px] font-light text-[var(--hb-text-strong)] mb-2">서비스 이용약관</h1>
        <p className="text-[13px] text-[var(--hb-text-muted)] mb-10">최종 수정일: 2026년 8월 22일</p>

        <div className="prose prose-sm max-w-none text-[14px] text-charcoal leading-[1.9] font-light space-y-8">
          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제1조 (목적)</h2>
            <p>본 약관은 {operatorName}(이하 &quot;운영자&quot;)가 제공하는 웨딩한방 서비스의 이용 조건과 운영자와 회원의 권리·의무를 정합니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제2조 (정의)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>&quot;서비스&quot;란 웹사이트(hanbang.ai)와 모바일 애플리케이션에서 제공하는 웨딩한방 기능을 말합니다.</li>
              <li>&quot;회원&quot;이란 본 약관에 동의하고 계정을 만든 이용자를 말합니다.</li>
              <li>&quot;함께 준비할 사람&quot;이란 초대 코드로 같은 결혼 준비 공간에 연결된 다른 회원을 말합니다.</li>
              <li>&quot;업체&quot;란 결혼식장, 사진 촬영, 드레스, 헤어·메이크업 등 결혼 준비 상품이나 서비스를 제공하는 사업자를 말합니다. 서비스에 업체 정보가 보인다는 사실만으로 운영자와 해당 업체 사이의 입점·제휴 관계가 생기지는 않습니다.</li>
              <li>&quot;아모라&quot;란 운영자가 제공하는 인공지능 기반 결혼 준비 도우미를 말합니다.</li>
              <li>&quot;콘텐츠&quot;란 회원이 서비스에 게시하거나 전송한 글, 사진, 파일, 댓글 등의 정보를 말합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제3조 (현재 서비스와 업체 거래의 경계)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li><strong>현재 웨딩한방은 업체 계약 신청, 예약 또는 결제를 중개하지 않습니다.</strong></li>
              <li>회원은 업체와 직접 상담하고 계약합니다. 계약 전에 업체가 제공한 최신 원문, 최종 금액, 포함 항목, 추가 비용, 취소·환불 조건을 직접 확인해야 합니다.</li>
              <li>서비스의 업체 정보와 가격 정보는 출처 및 확인 시점이 표시된 참고 자료입니다. 오래되었거나 서로 다른 상품 조건의 정보가 섞이지 않도록 운영자가 검수하지만, 업체의 현재 제안이나 최종 계약 조건을 대신하지 않습니다.</li>
              <li>운영자가 향후 계약 신청·예약·결제 중개 기능을 추가하는 경우, 적용되는 거래 조건과 개인정보 처리 내용을 이용 전에 별도로 알리고 필요한 동의를 받습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제4조 (회원가입)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원가입은 본 약관과 개인정보 처리방침을 확인한 후 정해진 가입 절차에 따라 신청합니다.</li>
              <li>운영자는 다음 경우 가입을 거절하거나 이용을 제한할 수 있습니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>타인의 명의를 도용하여 신청한 경우</li>
                  <li>가입 신청 시 허위의 정보를 기재한 경우</li>
                  <li>관련 법령 및 본 약관에 위반된 사용을 시도한 경우</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제5조 (서비스의 제공)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 현재 다음 서비스를 제공합니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>아모라에게 결혼 준비를 묻고, 사용자가 확인한 내용을 예산·할 일·일정에 반영하는 기능</li>
                  <li>예산, 할 일, 일정 관리 기능</li>
                  <li>커뮤니티 글·댓글과 비슷한 시기에 준비하는 이용자끼리 정보를 나누는 공간</li>
                  <li>견적서에 무엇이 포함되어 있는지 확인하는 기능</li>
                  <li>출처와 확인 시점이 있는 업체 공개 가격 정보 열람 기능</li>
                </ul>
              </li>
              <li>운영자는 서비스 운영상 필요한 경우 기능을 변경하거나 중단할 수 있습니다. 회원의 권리나 이용에 중요한 영향을 주는 변경은 사전에 알립니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제6조 (업체 계약·결제·환불)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>현재 서비스 안에서는 업체 예약과 결제를 할 수 없습니다. 운영자는 업체 결제 정보나 카드 정보를 받거나 저장하지 않습니다.</li>
              <li>회원이 서비스 밖에서 업체와 체결한 계약과 결제는 해당 업체가 제시한 계약서와 관계 법령의 적용을 받습니다.</li>
              <li>취소·환불 조건은 계약 전에 업체의 최신 서면 조건으로 확인해야 합니다. 아모라의 설명이나 커뮤니티 글은 계약 조건을 대신하지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제7조 (회원의 의무)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원은 서비스 이용에 필요한 정보를 사실에 맞게 입력하고, 중요한 내용이 바뀌면 수정해야 합니다.</li>
              <li>회원은 자신의 계정 정보를 타인에게 양도·대여하여서는 안 됩니다.</li>
              <li>회원은 다음 행위를 하여서는 안 됩니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>타인의 명예를 훼손하거나 모욕하는 콘텐츠 게시</li>
                  <li>저작권·초상권 등 타인의 권리를 침해하는 행위</li>
                  <li>허위 후기 작성, 평점 조작, 광고 미표시</li>
                  <li>플랫폼의 안정적 운영을 방해하는 행위</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제8조 (콘텐츠의 권리)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원이 플랫폼에 게시한 콘텐츠의 저작권은 작성자 본인에게 귀속됩니다.</li>
              <li>회원은 콘텐츠를 서비스 안에서 저장·전송·표시하고 기능을 제공하는 데 필요한 범위에서만 운영자가 이용할 수 있도록 허락합니다.</li>
              <li>운영자가 회원 콘텐츠를 광고나 외부 홍보 자료로 사용하려면 작성자의 별도 동의를 받습니다.</li>
              <li>운영자는 신고가 접수되었거나 법령·약관 위반이 명백한 콘텐츠를 필요한 범위에서 임시로 숨기거나 삭제할 수 있으며, 가능한 경우 그 이유와 이의제기 방법을 알립니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제9조 (AI 서비스 관련 고지)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>아모라는 인공지능이 답변을 만드는 서비스입니다. 「인공지능 발전과 신뢰 기반 조성 등에 관한 기본법」에 따른 사전 고지와 생성물 표시를 제공합니다. 자세한 내용은 <Link href="/ai-policy" className="text-[var(--hb-accent-hover)] underline">AI 정책</Link>에서 확인할 수 있습니다.</li>
              <li>아모라의 AI 생성 응답에는 AI가 만든 내용임을 알리는 표시가 포함됩니다. 상호작용 기록은 <Link href="/privacy" className="text-[var(--hb-accent-hover)] underline">개인정보 처리방침</Link>에 고지한 목적과 기간에 따라 처리합니다.</li>
              <li>아모라는 사용자가 입력한 내용과 연결된 도구의 결과를 바탕으로 준비를 돕지만, 틀리거나 빠진 내용이 있을 수 있습니다. 계약, 결제, 법률, 세금, 의료, 안전처럼 결과가 큰 결정은 해당 원문과 담당 기관 또는 자격 있는 전문가에게 다시 확인해야 합니다.</li>
              <li>예산·할 일·일정에 내용을 저장하거나 함께 준비할 사람에게 공유하는 동작은 실행 전에 회원의 확인을 받습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제10조 (회원 탈퇴 및 자격 상실)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원은 언제든지 탈퇴를 신청할 수 있습니다. 현재는 고객센터(<a href={`mailto:${CONTACT.email}`} className="text-[var(--hb-accent-hover)] underline">{CONTACT.email}</a>)로 접수받고 있으며, 운영자가 본인 확인 후 처리합니다.</li>
              <li>탈퇴 신청이 접수되면 커뮤니티 새 파일 업로드가 제한되고 계정 삭제 절차가 시작됩니다. 임시 파일 접근 링크가 만료되고 파일 소유권과 삭제 대상을 확인한 뒤, 더 이상 필요하지 않은 개인정보를 지체 없이 파기합니다. 처리 범위와 기간은 개인정보 처리방침을 따릅니다.</li>
              <li>계정 삭제는 되돌릴 수 없습니다. 같은 이메일로 다시 가입하더라도 이전 기록은 복구되지 않습니다.</li>
              <li>연결된 파트너가 있는 경우, 두 사람이 함께 만든 준비 기록과 주고받은 대화는 남은 파트너의 화면에 그대로 유지되고 탈퇴한 회원의 식별 정보만 제거됩니다. 남은 파트너도 자신의 기록에 대해 같은 권리를 가집니다.</li>
              <li>회원이 등록한 업체가 있는 경우에는 해당 업체를 먼저 정리해야 탈퇴할 수 있습니다.</li>
              <li>운영자는 회원이 법령이나 본 약관을 중대하게 위반한 경우 원칙적으로 이유와 소명 기회를 알린 뒤 이용을 제한하거나 이용계약을 해지할 수 있습니다. 긴급한 피해 방지가 필요한 경우 먼저 제한하고 뒤에 알릴 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제11조 (책임과 정보 확인)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 합리적인 수준의 보안과 안정성을 갖추어 서비스를 제공하고, 운영자의 고의 또는 과실로 회원에게 손해가 발생한 경우 관계 법령에 따라 책임을 부담합니다.</li>
              <li>천재지변, 통신망 장애 등 운영자가 합리적으로 통제하기 어려운 사유로 서비스가 중단된 경우에도 운영자는 복구와 피해 축소를 위해 노력합니다.</li>
              <li>업체 공개 정보와 회원 콘텐츠는 작성·공개 시점 이후 바뀌거나 사실과 다를 수 있습니다. 운영자는 신고·정정 절차를 제공하며, 회원은 계약 전 최신 원문을 확인해야 합니다.</li>
              <li>본 약관은 관계 법령이 허용하지 않는 범위까지 운영자의 책임을 제한하지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제12조 (분쟁 해결 및 관할)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>이용 문의와 불만은 고객센터(<a href={`mailto:${CONTACT.email}`} className="text-[var(--hb-accent-hover)] underline">{CONTACT.email}</a>)로 접수할 수 있습니다.</li>
              <li>운영자와 회원은 분쟁이 생기면 먼저 사실관계를 확인하고 원만한 해결을 위해 노력합니다. 해결되지 않는 경우 관계 법령에 따른 소비자 분쟁조정 절차를 이용할 수 있습니다.</li>
              <li>소송이 필요한 경우 관할 법원은 민사소송법 등 관계 법령에 따라 정합니다.</li>
            </ol>
          </section>

          {businessInfo ? (
            <section>
              <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">운영자 정보</h2>
              <div className="mt-3 px-4 py-3 bg-white rounded-lg">
                <ul className="space-y-1 text-[13px] text-charcoal">
                  {businessInfoRows(businessInfo).map(([label, value]) => (
                    <li key={label}>{label}: {value}</li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[13px] text-[var(--hb-text-muted)]">부칙: 본 약관은 2026년 7월 30일부터 시행합니다. 2026년 8월 21일 개정분(제10조 3~5항: 계정 삭제의 불가역성, 파트너 기록 유지 범위, 업체 등록 회원의 탈퇴 제한)은 회원의 권리를 제한하지 않는 설명 사항으로 같은 날부터 적용합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
