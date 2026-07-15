"use client";

import { PUBLIC_BETA_RELATIONSHIP_SCOPE } from "@hanbang/shared";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-ivory-50">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/[0.04]">
        <div className="max-w-[800px] mx-auto px-6 h-16 flex items-center">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-[13px] text-taupe-500 hover:text-rose-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            홈으로
          </Link>
        </div>
      </nav>

      <div className="max-w-[800px] mx-auto px-6 py-16 max-md:px-5 max-md:py-10">
        <h1 className="font-serif-kr text-[28px] font-light text-noir-800 mb-2">서비스 이용약관</h1>
        <p className="text-[13px] text-taupe-400 mb-10">최종 수정일: 2026년 7월 14일</p>

        <div className="prose prose-sm max-w-none text-[15px] text-charcoal leading-[1.9] font-normal space-y-8">
          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제1조 (목적)</h2>
            <p>본 약관은 웨딩한방 운영자(이하 &quot;운영자&quot;)가 운영하는 웨딩한방 플랫폼(이하 &quot;플랫폼&quot;)에서 제공하는 서비스의 이용과 관련하여, 운영자와 회원 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제2조 (정의)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>&quot;플랫폼&quot;이란 운영자가 운영하는 웹사이트(hanbang.ai) 및 모바일 애플리케이션을 의미합니다.</li>
              <li>&quot;회원&quot;이란 본 약관에 동의하고 운영자와 서비스 이용계약을 체결한 예비 신랑·신부 및 이용자를 의미합니다.</li>
              <li>&quot;파트너&quot;란 향후 업체 연결 기능이 별도로 검증·고지된 경우 플랫폼에 참여할 수 있는 웨딩 관련 사업자를 의미합니다. 현재 공개 기능에는 파트너 연결·예약·결제가 포함되지 않습니다.</li>
              <li>&quot;아모라&quot;란 운영자가 제공하는 AI 웨딩 플래너 서비스를 의미합니다.</li>
              <li>&quot;콘텐츠&quot;란 회원이 플랫폼에 게시·등록·전송하는 글, 사진, 영상, 댓글 등 일체의 정보를 의미합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제3조 (베타 서비스와 거래 범위)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>현재 베타는 웨딩 서비스의 결제 또는 계약을 체결하거나 대행하지 않습니다.</li>
              <li>업체 연결과 상담 요청 전송 기능은 현재 제공하지 않으며 재개 여부와 시점은 정해지지 않았습니다. 새 상담 요청은 파트너에게 전송되지 않고 이름·휴대폰 번호·희망 일시·메모도 이 경로에서 새로 저장하지 않습니다.</li>
              <li>업체가 공개한 운영시간과 과거·예시 요청 상태는 참고 정보이며, 파트너의 수신·수락·계약 또는 결제를 증명하지 않습니다.</li>
              <li>최종 가능 여부, 일정, 가격, 포함 항목, 변경·취소 조건과 계약 당사자 정보는 회원이 해당 파트너의 공식 연락처로 직접 확인해야 합니다.</li>
              <li>향후 업체 연결, 거래 중개 또는 결제 기능을 제공하게 되는 경우, 적용 법령에 따른 사업자·판매자 정보, 개인정보 제공 항목과 거래 조건을 기능 제공 전에 별도로 고지합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제4조 (회원가입)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원가입은 본 약관 및 개인정보처리방침에 동의한 후 운영자가 정한 가입 양식에 따라 정보를 기재하여 신청합니다.</li>
              <li>
                {PUBLIC_BETA_RELATIONSHIP_SCOPE.notice}{" "}
                {PUBLIC_BETA_RELATIONSHIP_SCOPE.guidance}
              </li>
              <li>운영자는 다음 각 호에 해당하는 경우 가입을 거절하거나 사후에 이용계약을 해지할 수 있습니다.
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
              <li>운영자는 다음과 같은 서비스를 제공합니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>AI 웨딩 플래너(아모라)의 질문 응답 및 정보 정리 기능</li>
                  <li>사용자가 직접 입력한 예산·일정·준비 상태 기록 도구</li>
                  <li>커뮤니티 게시판</li>
                  <li>예절 가이드 및 출처가 표시된 시세 정보</li>
                </ul>
              </li>
              <li>업체 탐색·연결·예약, 동기방, 결제는 현재 제공 범위가 아닙니다. 화면과 서버의 공개 기능 계약이 검증된 뒤 별도 고지한 경우에만 제공합니다.</li>
              <li>견적 포함 항목을 별도 입력하는 기능은 신규 작성·저장·공개를 종료했으며, 과거 공개 설정도 모두 해제합니다. 계정에 남은 비공개 과거 기록은 회원 탈퇴 시 삭제됩니다.</li>
              <li>운영자는 서비스 운영상의 필요에 따라 일부 기능을 변경·중단할 수 있으며, 중요한 변경의 경우 사전에 공지합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제6조 (업체 정보와 현재 제공하지 않는 연결 기능)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>현재 베타는 플랫폼 내 결제를 제공하지 않으며 카드정보를 수집·저장하지 않습니다.</li>
              <li>현재 플랫폼에서는 새 상담 요청·문의와 그에 포함된 개인정보를 파트너에게 전송하거나 해당 요청으로 새로 저장하지 않습니다.</li>
              <li>기존 목록에 표시되는 과거·예시 상태는 조회 전용 기록으로, 파트너가 실제로 받거나 처리했다는 의미가 아닙니다. 실제 완료 증빙 경로가 마련되기 전에는 결과 저장과 공개 후기 게시도 제공하지 않습니다.</li>
              <li>회원은 계약, 결제, 변경, 취소와 환불을 파트너의 공식 연락처로 직접 확인하고, 해당 파트너와 합의한 계약 및 정책에 따라 진행해야 합니다.</li>
              <li>업체 연결·결제 또는 거래 중개 기능을 제공하게 되는 경우 관련 조건, 개인정보 제공·철회 방법과 보관기간을 기능 제공 전에 약관과 화면에 별도로 고지합니다.</li>
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
              <li>회원은 자신이 선택한 공개 범위에서 콘텐츠를 저장·전송·표시하고 장애 복구와 신고 처리를 수행하는 데 필요한 기간과 범위에 한해 운영자에게 비독점적 이용 권한을 부여합니다.</li>
              <li>홍보·마케팅 재사용은 별도의 구체적이고 철회 가능한 동의를 받기 전에는 하지 않습니다. 비공개 아모라 대화와 첨부파일은 별도 동의 없이 홍보나 모델 학습에 사용하지 않습니다.</li>
              <li>운영자는 다른 회원의 신고가 있거나 약관 위반이 명백한 경우 사전 통지 없이 콘텐츠를 비공개·삭제할 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제9조 (AI 서비스 관련 고지)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>아모라는 AI 기반 서비스이며, 생성형 AI를 사용한다는 사실과 주요 운영 경계는 <Link href="/ai-policy" className="text-rose-500 underline">AI 정책</Link>에서 안내합니다. 이 고지만으로 특정 법령 검토나 규제 준수가 완료됐다고 주장하지 않습니다.</li>
              <li>아모라 화면에는 &quot;AI 생성&quot; 표시가 제공됩니다. 상호작용 원문과 감사 기록의 보유기간은 <Link href="/privacy" className="text-rose-500 underline">개인정보 처리방침</Link>에 따릅니다.</li>
              <li>아모라의 답변에는 오류가 있을 수 있습니다. 계약·금액·법률·안전처럼 중요한 결정은 원문, 업체 또는 해당 분야 전문가에게 다시 확인해야 합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제10조 (회원 탈퇴 및 자격 상실)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>현재 내부 테스트에서는 영속 삭제 대기열, 처리 작업자, 실패 복구와 문의 경로의 운영 검증이 완료되지 않아 설정의 계정 삭제 요청 기능을 비활성화합니다. 이 권리 행사 경로가 검증되기 전에는 공개 운영을 시작하지 않습니다.</li>
              <li>기능을 활성화한 뒤에는 서버가 삭제 요청을 영속적으로 접수한 경우에만 로그아웃하고 삭제 절차를 시작합니다. 접수 실패 시에는 계정과 로그인 상태를 유지합니다. 관련 법령에 따라 보관이 의무화된 정보가 실제로 존재하는 경우에는 해당 기간 동안 분리 보관합니다.</li>
              <li>운영자는 회원이 본 약관을 중대하게 위반한 경우 사전 통지 후 회원 자격을 상실시킬 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제11조 (면책)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대하여 책임을 지지 않습니다.</li>
              <li>운영자는 회원과 파트너 간 또는 회원 상호 간 거래·분쟁에 대하여 직접적인 책임을 지지 않습니다.</li>
              <li>운영자는 회원이 게시한 콘텐츠의 신뢰도·정확성에 대하여 책임을 지지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제12조 (분쟁 해결 및 관할)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>현재 공개 문의 접수와 연락처 안내는 열지 않았습니다. 실제 수신·본인 확인·처리 기록·삭제 절차를 검증한 뒤 이용 가능한 창구를 별도로 고지합니다.</li>
              <li>회원은 운영자와의 분쟁에 대하여 다음 기관의 조정을 신청할 수 있습니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>한국소비자원 소비자분쟁조정위원회 (https://www.kca.go.kr)</li>
                  <li>전자거래분쟁조정위원회 (https://www.ecmc.or.kr)</li>
                </ul>
              </li>
              <li>본 약관과 관련한 소송의 관할 법원은 민사소송법 등 관계 법령에 따릅니다.</li>
            </ol>
          </section>

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[13px] text-taupe-400">부칙: 본 개정 약관은 2026년 7월 14일부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
