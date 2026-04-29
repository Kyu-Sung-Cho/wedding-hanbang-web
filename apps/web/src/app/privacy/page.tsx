"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
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
        <h1 className="font-serif-kr text-[28px] font-light text-noir-800 mb-2">개인정보 처리방침</h1>
        <p className="text-[13px] text-taupe-400 mb-10">최종 수정일: 2026년 4월 29일</p>

        <div className="prose prose-sm max-w-none text-[14px] text-charcoal leading-[1.9] font-light space-y-8">
          <section>
            <p>주식회사 웨딩한방(이하 &quot;회사&quot;)은 「개인정보 보호법」 및 관련 법령을 준수하며, 회원의 개인정보를 소중히 보호합니다. 본 방침은 회사가 운영하는 웨딩한방 플랫폼(hanbang.ai)에서 제공하는 서비스에 적용됩니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제1조 (개인정보의 수집 항목 및 수집 방법)</h2>
            <p>회사는 서비스 제공을 위해 다음 항목을 수집합니다.</p>
            <div className="mt-3 space-y-3">
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">필수 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>이메일 주소 또는 카카오·구글·Apple 계정 식별자</li>
                  <li>이름(닉네임), 비밀번호(이메일 가입 시)</li>
                  <li>역할(신부/신랑), 결혼 예정일, 예산, 진행 상황</li>
                  <li>커플 연동 정보(파트너 식별자)</li>
                  <li>서비스 이용 기록(접속 IP, 쿠키, 기기 정보)</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">선택 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>프로필 사진, 커뮤니티 게시 콘텐츠(사진·영상·글)</li>
                  <li>청첩장 정보(인사말, 일시, 장소, 계좌번호)</li>
                  <li>축의금 관리 데이터(이름, 관계, 금액)</li>
                  <li>마케팅 수신 동의 여부</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">자동 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>접속 로그, IP 주소, 브라우저·OS 정보, 페이지 조회 기록</li>
                  <li>아모라(AI) 상호작용 기록(질문·응답·도구 호출)</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제2조 (개인정보의 이용 목적)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원 식별, 본인 확인, 회원관리, 부정 이용 방지</li>
              <li>서비스 제공: AI 상담, 예산·일정·체크리스트 관리, 업체 매칭</li>
              <li>커플 연동 및 파트너 간 데이터 공유</li>
              <li>업체 예약 중개, 결제 처리, 분쟁 조정</li>
              <li>서비스 개선을 위한 통계 분석, 신규 기능 개발</li>
              <li>법령상 의무 준수(전자상거래법·세법·AI 기본법 등)</li>
              <li>마케팅 수신 동의자 대상 이벤트·프로모션 안내</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제3조 (개인정보의 보유 및 이용기간)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원 탈퇴 시 즉시 파기됩니다. 다만, 관련 법령에 따라 보관이 의무화된 정보는 해당 기간 동안 보관됩니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>계약 또는 청약철회 등에 관한 기록: <strong>5년</strong> (전자상거래법)</li>
                  <li>대금결제 및 재화 등의 공급에 관한 기록: <strong>5년</strong> (전자상거래법)</li>
                  <li>소비자의 불만 또는 분쟁처리에 관한 기록: <strong>3년</strong> (전자상거래법)</li>
                  <li>웹사이트 방문 기록: <strong>3개월</strong> (통신비밀보호법)</li>
                  <li>AI 상호작용 기록: <strong>5년</strong> (AI 기본법 제8조)</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제4조 (개인정보의 제3자 제공)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회사는 회원의 개인정보를 본인의 동의 없이 외부에 제공하지 않습니다.</li>
              <li>다음의 경우는 예외로 합니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>업체(파트너) 예약 시: 예약 진행에 필요한 최소한의 정보(이름, 연락처, 예약일시)를 해당 파트너에게 제공</li>
                  <li>법령에 의해 요구되는 경우: 수사기관, 법원의 영장 등</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제5조 (개인정보의 처리위탁)</h2>
            <p>회사는 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁하고 있습니다.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    <th className="py-2 text-left font-medium text-noir-800">수탁 업체</th>
                    <th className="py-2 text-left font-medium text-noir-800">위탁 업무</th>
                  </tr>
                </thead>
                <tbody className="text-charcoal">
                  <tr className="border-b border-black/[0.04]">
                    <td className="py-2">Supabase, Inc.</td>
                    <td className="py-2">데이터베이스, 인증, 파일 저장</td>
                  </tr>
                  <tr className="border-b border-black/[0.04]">
                    <td className="py-2">Vercel Inc.</td>
                    <td className="py-2">웹 호스팅 및 배포</td>
                  </tr>
                  <tr className="border-b border-black/[0.04]">
                    <td className="py-2">Anthropic PBC</td>
                    <td className="py-2">AI 추론 처리(아모라)</td>
                  </tr>
                  <tr className="border-b border-black/[0.04]">
                    <td className="py-2">㈜ 토스페이먼츠</td>
                    <td className="py-2">결제 처리</td>
                  </tr>
                  <tr>
                    <td className="py-2">Resend, Inc.</td>
                    <td className="py-2">이메일 발송</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제6조 (정보주체의 권리)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원은 언제든지 자신의 개인정보를 조회·수정·삭제·처리정지 요청할 수 있습니다.</li>
              <li>이용 내역 확인 및 탈퇴는 설정 페이지에서 직접 처리할 수 있습니다.</li>
              <li>그 외 권리 행사는 고객센터(<a href="mailto:support@hanbang.ai" className="text-rose-500 underline">support@hanbang.ai</a>)로 요청할 수 있으며, 회사는 지체 없이 조치합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제7조 (개인정보의 안전성 확보 조치)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>비밀번호는 일방향 암호화(해시)하여 저장합니다.</li>
              <li>전송 구간은 TLS/HTTPS로 암호화합니다.</li>
              <li>데이터베이스 접근은 RLS(Row Level Security)로 본인 데이터에 한정합니다.</li>
              <li>관리자 접근 권한은 최소 인원에게만 부여하며 접속 기록을 보관합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제8조 (쿠키 및 추적기술)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회사는 사용자 경험 개선을 위해 쿠키를 사용합니다.</li>
              <li>회원은 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으며, 이 경우 일부 서비스 이용에 제약이 있을 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제9조 (개인정보 보호책임자)</h2>
            <p>회사는 개인정보 보호 관련 문의에 답변하고 처리 결과를 알려드리기 위해 다음과 같이 개인정보 보호책임자를 지정하고 있습니다.</p>
            <div className="mt-3 px-4 py-3 bg-white rounded-xl">
              <ul className="space-y-1 text-[13px] text-charcoal">
                <li>성명: 조규성</li>
                <li>직책: 대표이사</li>
                <li>이메일: <a href="mailto:ceo@hanbang.ai" className="text-rose-500">ceo@hanbang.ai</a></li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제10조 (개인정보 처리방침의 변경)</h2>
            <p>본 방침은 법령·정책 또는 보안기술의 변경에 따라 내용이 추가·삭제 및 수정될 수 있으며, 변경 시 사전에 공지합니다.</p>
          </section>

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[13px] text-taupe-400">부칙: 본 방침은 2026년 4월 29일부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
