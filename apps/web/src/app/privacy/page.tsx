"use client";

import Link from "next/link";

import { businessInfoRows, readBusinessInfo } from "@/lib/legal/businessInfo";
import { ArrowLeft } from "lucide-react";
import {
  CURRENT_PRIVACY_VERSION,
  formatPolicyVersionKorean,
} from "@/lib/compliance/policyVersions";

const PRIVACY_VERSION_KO = formatPolicyVersionKorean(CURRENT_PRIVACY_VERSION);

export default function PrivacyPage() {
  const businessInfo = readBusinessInfo();
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
        <p className="text-[13px] text-taupe-400 mb-10">최종 수정일: {PRIVACY_VERSION_KO}</p>

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
                  <li>고객 설문 응답(성별·연령대·예산 구간, 선택지 및 선택적 자유서술)과 설문 처리 동의 버전·시각</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">자동 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>접속 로그, IP 주소, 브라우저·OS 정보, 페이지 조회 기록</li>
                  <li>아모라(AI) 상호작용 기록(질문·응답·도구 호출)</li>
                  <li>부정 이용 방지를 위한 보안 확인 정보(네트워크·기기·브라우저 신호 및 확인 결과)</li>
                  <li>모바일 알림에 동의한 경우 푸시 토큰, 기기 운영체제 및 알림 전달 결과</li>
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
              <li>업체 탐색, 예약 준비·기록 및 관련 문의 대응</li>
              <li>서비스 개선을 위한 통계 분석, 신규 기능 개발</li>
              <li>명시적으로 동의한 고객 설문 응답의 집계·분석</li>
              <li>법령상 의무 준수(전자상거래법·세법·AI 기본법 등)</li>
              <li>마케팅 수신 동의자 대상 이벤트·프로모션 안내</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제3조 (개인정보의 보유 및 이용기간)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>탈퇴 신청이 접수되면 커뮤니티 새 파일 업로드가 제한되고, 발급된 임시 접근 링크의 만료와 파일 소유권 확인 등 안전한 삭제 절차가 시작됩니다. 회사는 해당 절차가 끝난 뒤 보유 목적이 사라진 개인정보를 지체 없이 파기합니다. 관련 법령상 별도 보관이 필요한 정보의 적용 범위·기간은 법률 검토와 전용 보관 경계가 검증된 뒤 구체적으로 고지합니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>현재 공개된 베타 서비스는 업체와 회원 사이의 계약·예약·결제를 대행하거나 중개하지 않으며, 회사가 처리한 결제·환불 기록을 수집하지 않습니다. 향후 거래 기능을 제공하는 경우에는 법정 보관 대상과 기간, 분리 보관·삭제 경계를 검증한 뒤 기능 사용 전에 고지합니다.</li>
                  <li>접속·보안 기록: 실제 운영 목적별 보유기간과 자동 파기 일정을 검증 중입니다. 법령상 별도 보관 의무가 적용되는지는 회사의 지위와 기록 유형별로 확인하며, 확정 전 신규 운영 배포를 차단합니다.</li>
                  <li>AI 상호작용 기록: 원문과 비용·안전 메타데이터의 보유기간 및 자동 파기 일정을 재검증 중입니다. 확정 전에는 장기 보관을 전제로 추가 활용하지 않으며, 검증 완료 후 실제 적용일과 기간을 고지합니다.</li>
                  <li>고객 설문 응답: 동의 버전·시각을 신규 응답에 기록하고 직접 식별자가 포함된 자유서술은 저장을 거부합니다. 다만 응답 보유기간과 자동 파기 일정은 아직 확정되지 않았으므로, 이를 검증·고지하고 파기 작업을 운영하기 전에는 신규 운영 배포를 차단합니다.</li>
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
                  <li>현재 공개된 베타 서비스에는 회원의 이름·연락처·예약일시를 업체에 전송하는 예약 중개 기능이 없습니다. 향후 해당 기능을 제공하는 경우에는 제공받는 자, 항목, 목적과 보유기간을 알리고 필요한 동의를 먼저 받습니다.</li>
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
                    <td className="py-2">OpenAI</td>
                    <td className="py-2">AI 추론 처리(아모라)</td>
                  </tr>
                  <tr className="border-b border-black/[0.04]">
                    <td className="py-2">Resend, Inc.</td>
                    <td className="py-2">이메일 발송</td>
                  </tr>
                  <tr className="border-b border-black/[0.04]">
                    <td className="py-2">Cloudflare, Inc.</td>
                    <td className="py-2">Turnstile을 통한 부정 이용·자동화 요청 방지</td>
                  </tr>
                  <tr className="border-b border-black/[0.04]">
                    <td className="py-2">650 Industries, Inc. (Expo)</td>
                    <td className="py-2">동의 기반 모바일 푸시 알림 전달(기능 활성화 시)</td>
                  </tr>
                  <tr className="border-b border-black/[0.04]">
                    <td className="py-2">PostHog, Inc.</td>
                    <td className="py-2">경로 단위 서비스 이용 통계 분석(미국 소재)</td>
                  </tr>
                  <tr>
                    <td className="py-2">Functional Software, Inc. (Sentry)</td>
                    <td className="py-2">오류 수집 및 서비스 안정성 개선(미국 소재)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제6조 (개인정보의 국외 이전)</h2>
            <p>국외 소재 수탁자에 대해서는 실제 계약·배포 리전을 기준으로 이전 항목, 국가, 시기와 방법, 수령 법인의 명칭·연락처, 이용 목적·보유기간, 이전 거부 방법과 거부 시 영향을 확정해야 합니다. 현재 이 검증이 완료되지 않았으므로 본 초안을 국외 이전에 대한 동의나 완성된 고지로 취급하지 않으며, 검증·법률 검토·고지 반영 전에는 신규 운영 배포를 차단합니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제7조 (정보주체의 권리)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원은 언제든지 자신의 개인정보를 조회·수정·삭제·처리정지 요청할 수 있습니다.</li>
              <li>이용 내역은 설정 페이지에서 확인할 수 있고, 계정 삭제는 설정 페이지에서 요청할 수 있습니다. 자동 접수 기능을 점검 중이거나 이용할 수 없는 경우에는 고객센터(<a href="mailto:support@hanbang.ai" className="text-rose-500 underline">support@hanbang.ai</a>)로 요청할 수 있습니다.</li>
              <li>그 외 권리 행사도 고객센터로 요청할 수 있으며, 회사는 요청 내용을 확인해 처리 결과를 안내합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제8조 (개인정보의 안전성 확보 조치)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>비밀번호는 일방향 암호화(해시)하여 저장합니다.</li>
              <li>웹·앱과 서비스 API 사이의 전송에는 TLS/HTTPS를 사용합니다.</li>
              <li>비공개 회원 데이터에는 RLS(Row Level Security)를 적용해 본인 또는 연결된 커플 범위로 접근을 제한하며, 공개 커뮤니티 정보는 별도의 공개 필드로 분리합니다.</li>
              <li>관리자 접근 권한은 최소 인원에게만 부여하며 접속 기록을 보관합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제9조 (쿠키 및 추적기술)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회사는 로그인 상태 유지와 보안 등 서비스 제공에 필요한 쿠키를 사용합니다.</li>
              <li>웹 이용 통계에는 자동 클릭 수집·세션 녹화·지속 분석 식별자를 사용하지 않고, URL의 쿼리와 fragment를 제외한 경로 단위 이벤트만 전송합니다. 브라우저의 추적 거부 신호(DNT)도 존중합니다.</li>
              <li>회원은 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으며, 이 경우 일부 서비스 이용에 제약이 있을 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제10조 (개인정보 보호책임자)</h2>
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
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제11조 (개인정보 처리방침의 변경)</h2>
            <p>본 방침은 법령·정책 또는 보안기술의 변경에 따라 내용이 추가·삭제 및 수정될 수 있으며, 변경 시 사전에 공지합니다.</p>
          </section>

          {/* 사업자 식별 정보 — 값이 설정되지 않으면 렌더하지 않는다.
              없는 정보를 자리표시자로 띄우면 그게 곧 허위 표시다. */}
          {businessInfo ? (
            <section>
              <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">사업자 정보</h2>
              <div className="mt-3 px-4 py-3 bg-white rounded-xl">
                <ul className="space-y-1 text-[13px] text-charcoal">
                  {businessInfoRows(businessInfo).map(([label, value]) => (
                    <li key={label}>{label}: {value}</li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[13px] text-taupe-400">부칙: 본 방침은 {PRIVACY_VERSION_KO}부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
