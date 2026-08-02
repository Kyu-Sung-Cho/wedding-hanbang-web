"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  CURRENT_TERMS_VERSION,
  formatPolicyVersionKorean,
} from "@/lib/compliance/policyVersions";

const TERMS_VERSION_KO = formatPolicyVersionKorean(CURRENT_TERMS_VERSION);

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-ivory-50">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/[0.04]">
        <div className="max-w-[800px] mx-auto px-6 h-16 flex items-center">
          <Link href="/" className="flex items-center gap-2 text-[13px] text-taupe-500 hover:text-rose-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            홈으로
          </Link>
        </div>
      </nav>

      <div className="max-w-[800px] mx-auto px-6 py-16 max-md:px-5 max-md:py-10">
        <h1 className="font-serif-kr text-[28px] font-light text-noir-800 mb-2">서비스 이용약관</h1>
        <p className="text-[13px] text-taupe-400 mb-10">최종 수정일: {TERMS_VERSION_KO}</p>

        <div className="prose prose-sm max-w-none text-[14px] text-charcoal leading-[1.9] font-light space-y-8">
          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제1조 (목적)</h2>
            <p>본 약관은 주식회사 웨딩한방(이하 &quot;회사&quot;)이 운영하는 웨딩한방 플랫폼(이하 &quot;플랫폼&quot;)에서 제공하는 서비스의 이용과 관련하여, 회사와 회원 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제2조 (정의)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>&quot;플랫폼&quot;이란 회사가 운영하는 웹사이트(hanbang.ai) 및 모바일 애플리케이션을 의미합니다.</li>
              <li>&quot;회원&quot;이란 본 약관에 동의하고 회사와 서비스 이용계약을 체결한 예비 신랑·신부 및 이용자를 의미합니다.</li>
              <li>&quot;파트너&quot;란 플랫폼에 입점한 웨딩 관련 사업자(스튜디오, 드레스샵, 메이크업샵, 예식장 등)를 의미합니다.</li>
              <li>&quot;아모라&quot;란 회사가 제공하는 AI 웨딩 플래너 서비스를 의미합니다.</li>
              <li>&quot;콘텐츠&quot;란 회원이 플랫폼에 게시·등록·전송하는 글, 사진, 영상, 댓글 등 일체의 정보를 의미합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제3조 (통신판매중개자의 지위)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회사는 「전자상거래 등에서의 소비자보호에 관한 법률」 제20조에 따른 <strong>통신판매중개자</strong>이며, 회원과 파트너 간의 거래를 중개하는 역할을 수행합니다.</li>
              <li><strong>회사는 통신판매의 당사자가 아니며,</strong> 파트너가 등록한 상품·서비스의 정보 및 거래에 대하여 책임을 지지 않습니다. 다만, 회사의 고의 또는 중대한 과실로 인하여 회원에게 손해가 발생한 경우에는 그러하지 아니합니다.</li>
              <li>각 거래 건의 판매자(파트너) 정보는 해당 업체 상세 페이지에서 확인할 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제4조 (회원가입)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원가입은 본 약관 및 개인정보처리방침에 동의한 후 회사가 정한 가입 양식에 따라 정보를 기재하여 신청합니다.</li>
              <li>회사는 다음 각 호에 해당하는 경우 가입을 거절하거나 사후에 이용계약을 해지할 수 있습니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>타인의 명의를 도용하여 신청한 경우</li>
                  <li>가입 신청 시 허위의 정보를 기재한 경우</li>
                  <li>관련 법령 및 본 약관에 위반된 사용을 시도한 경우</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제5조 (서비스의 제공)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회사는 다음과 같은 서비스를 제공합니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>AI 웨딩 플래너(아모라) 상담 서비스</li>
                  <li>예산·일정·체크리스트 관리 도구</li>
                  <li>웨딩 관련 업체 탐색 및 예약 준비·기록</li>
                  <li>커뮤니티 게시판 및 동기방</li>
                  <li>예절 가이드 및 시세 정보</li>
                </ul>
              </li>
              <li>회사는 서비스 운영상의 필요에 따라 일부 기능을 변경·중단할 수 있으며, 중요한 변경의 경우 사전에 공지합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제6조 (거래 기능)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>현재 공개된 베타 서비스는 업체와 회원 사이의 계약·예약·결제를 대행하거나 중개하지 않습니다. 계약과 대금 지급은 회원이 해당 업체와 직접 진행합니다.</li>
              <li>회원이 서비스에 입력하는 예산, 견적, 예약일 또는 실제 지출 금액은 준비 과정을 정리하기 위한 기록이며, 회사가 결제를 처리했다는 의미가 아닙니다.</li>
              <li>회사가 향후 거래 기능을 제공하는 경우에는 적용 범위, 결제사업자, 환불 기준, 법정 보관 항목과 기간을 검증한 뒤 기능 사용 전에 별도로 고지하고 필요한 동의를 받습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제7조 (회원의 의무)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원은 가입 시 정확한 정보를 제공하여야 하며, 변동 사항이 있는 경우 즉시 수정하여야 합니다.</li>
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
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제8조 (콘텐츠의 권리)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원이 플랫폼에 게시한 콘텐츠의 저작권은 작성자 본인에게 귀속됩니다.</li>
              <li>회원은 회사가 서비스 운영, 홍보, 개선의 목적으로 해당 콘텐츠를 무상으로 사용·전시할 수 있도록 비독점적 라이선스를 부여합니다.</li>
              <li>회사는 다른 회원의 신고가 있거나 약관 위반이 명백한 경우 사전 통지 없이 콘텐츠를 비공개·삭제할 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제9조 (AI 서비스 관련 고지)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>아모라는 「인공지능 발전 및 신뢰 기반 조성 등에 관한 법률」(이하 &quot;AI 기본법&quot;)에 따라 AI 기반 서비스임을 사전에 고지합니다. 자세한 사항은 <Link href="/ai-policy" className="text-rose-500 underline">AI 정책</Link>을 참고하시기 바랍니다.</li>
              <li>아모라의 AI 생성 응답에는 AI가 만든 내용임을 알리는 표시가 포함됩니다. 상호작용 기록은 <Link href="/privacy" className="text-rose-500 underline">개인정보 처리방침</Link>에 고지한 목적과 기간에 따라 처리합니다.</li>
              <li>아모라의 추천·답변은 참고 자료이며, 최종 결정과 책임은 회원에게 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제10조 (회원 탈퇴 및 자격 상실)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원은 언제든지 설정 페이지에서 탈퇴를 신청할 수 있습니다.</li>
              <li>탈퇴 신청이 접수되면 커뮤니티 새 파일 업로드가 제한됩니다. 회사는 발급된 임시 접근 링크의 만료와 파일 소유권 등 안전 확인을 거쳐 보유 목적이 끝난 개인정보를 지체 없이 파기합니다. 관련 법령상 별도 보관이 필요한 정보가 확인되면 적용 범위와 기간을 개인정보 처리방침에 고지하고 그 범위에서만 보관합니다.</li>
              <li>회사는 회원이 본 약관을 중대하게 위반한 경우 사전 통지 후 회원 자격을 상실시킬 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제11조 (면책)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회사는 천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대하여 책임을 지지 않습니다.</li>
              <li>회사는 회원과 파트너 간 또는 회원 상호 간 거래·분쟁에 대하여 직접적인 책임을 지지 않습니다.</li>
              <li>회사는 회원이 게시한 콘텐츠의 신뢰도·정확성에 대하여 책임을 지지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제12조 (분쟁 해결 및 관할)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회사는 회원의 의견과 불만을 적절하게 처리하기 위하여 고객센터(<a href="mailto:support@hanbang.ai" className="text-rose-500 underline">support@hanbang.ai</a>)를 운영합니다.</li>
              <li>회원은 회사와의 분쟁에 대하여 다음 기관의 조정을 신청할 수 있습니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>한국소비자원 소비자분쟁조정위원회 (https://www.kca.go.kr)</li>
                  <li>전자거래분쟁조정위원회 (https://www.ecmc.or.kr)</li>
                </ul>
              </li>
              <li>본 약관과 관련하여 회사와 회원 간 소송이 제기될 경우, 회사의 본점 소재지를 관할하는 법원을 제1심 관할 법원으로 합니다.</li>
            </ol>
          </section>

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[13px] text-taupe-400">부칙: 본 약관은 {TERMS_VERSION_KO}부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
