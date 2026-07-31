"use client";

import Link from "next/link";

import { businessInfoRows, readBusinessInfo } from "@/lib/legal/businessInfo";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  const businessInfo = readBusinessInfo();
  const operatorName = businessInfo?.companyName ?? "웨딩한방 운영자";

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
        <p className="text-[13px] text-taupe-400 mb-10">최종 수정일: 2026년 7월 31일</p>

        <div className="prose prose-sm max-w-none text-[14px] text-charcoal leading-[1.9] font-light space-y-8">
          <section>
            <p>{operatorName}(이하 &quot;운영자&quot;)는 「개인정보 보호법」과 관계 법령을 준수합니다. 본 방침은 웹사이트(hanbang.ai)와 모바일 애플리케이션에서 제공하는 웨딩한방 서비스에 적용됩니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제1조 (개인정보의 수집 항목 및 수집 방법)</h2>
            <p>운영자는 회원이 사용하는 기능에 따라 다음 정보를 처리합니다. 사용하지 않은 기능의 입력값은 받지 않습니다.</p>
            <div className="mt-3 space-y-3">
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">계정 생성·로그인</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>이메일 주소 또는 카카오·구글·Apple 계정 식별자</li>
                  <li>이름 또는 닉네임</li>
                  <li>이메일 가입 시 비밀번호는 인증 서비스 제공자인 Supabase가 처리합니다. 웨딩한방의 일반 서비스 데이터베이스에는 비밀번호 원문을 저장하지 않습니다.</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">회원이 기능을 사용할 때 입력하는 정보</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>결혼 준비 역할, 함께 준비할 사람의 연결 정보, 결혼 예정일, 결혼식장, 총 예산, 준비 상태와 선호</li>
                  <li>회원이 직접 고른 아모라 도움 방식(추천·비교 순서, 설명 분량, 힘들 때의 도움 순서, 준비·가족 의견을 정리하는 방식)</li>
                  <li>예산 항목과 실제 지출, 할 일, 일정, 메모, 아모라에게 보낸 질문과 첨부 파일, 아모라의 답변</li>
                  <li>프로필 사진과 커뮤니티에 올린 글·댓글·사진·파일</li>
                  <li>마케팅 수신 동의 여부</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">서비스 이용 중 자동으로 생기는 정보</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>접속 로그, IP 주소, 브라우저·OS 정보, 페이지 조회 기록</li>
                  <li>오류 기록과 보안 기록</li>
                  <li>아모라 호출의 모델명, 토큰 수, 처리 시간, 성공 여부, 비용 등 운영 기록. 이 비용 기록에는 질문·답변·첨부 파일·도구 입력값 원문을 복제하지 않습니다.</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제2조 (개인정보의 이용 목적)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원 식별, 로그인, 계정 관리와 부정 이용 방지</li>
              <li>아모라 대화와 회원이 승인한 예산·할 일·일정 반영</li>
              <li>회원이 직접 고른 도움 방식에 맞춘 아모라 답변의 순서와 분량 조정</li>
              <li>예산·할 일·일정 관리, 견적서 포함 항목 확인, 커뮤니티 기능 제공</li>
              <li>초대 코드로 연결한 사람과 회원이 공유하기로 한 결혼 준비 정보 제공</li>
              <li>오류 해결, 보안 대응, 서비스 이용 통계와 기능 개선</li>
              <li>관계 법령에 따른 의무 이행과 분쟁 대응</li>
              <li>별도로 마케팅 수신에 동의한 회원에게만 이벤트·프로모션 안내</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제3조 (개인정보의 보유 및 이용기간)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>계정과 결혼 준비 정보는 회원 탈퇴 또는 해당 처리 목적이 끝날 때까지 보관합니다. 탈퇴가 접수되면 커뮤니티 새 파일 업로드를 막고, 임시 파일 접근 링크의 만료와 파일 소유권 및 삭제 대상을 확인한 뒤 더 이상 필요하지 않은 개인정보를 지체 없이 파기합니다. 다른 법령에 따라 별도 보관해야 하는 정보는 전용 보관 경계가 검증된 뒤 적용 범위와 기간을 고지하고 다른 개인정보와 분리하여 보관합니다. 이 경계가 준비되지 않은 상태에서는 해당 보관 의무를 만드는 거래 기능을 운영하지 않습니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>현재 웨딩한방은 업체 계약·예약·결제를 중개하지 않으므로 해당 거래 기록을 수집하거나 보관하지 않습니다.</li>
                  <li>아모라 대화 원문은 대화 내역 제공을 위해 계정이 유지되는 동안 보관합니다. 비공개 대화 삭제를 선택하면 해당 대화 원문과 아모라가 자동 생성한 요약·기억을 삭제하고 그 범위의 기억 사용을 끕니다. 별도로 저장한 메모, 법적·보안 목적의 운영 기록과 백업은 각각 고지된 보관·파기 정책에 따라 처리합니다.</li>
                  <li>아모라 도움 방식은 회원이 설정에서 직접 확인·수정·삭제할 수 있습니다. 모두 지우면 해당 개인 설정 행을 삭제하며, 계정을 탈퇴하면 프로필과 함께 삭제합니다.</li>
                  <li>아모라 비용·오류 기록에는 대화 원문을 복제하지 않습니다. 식별정보 제거 시점과 운영 메타데이터의 최종 보유기간은 운영 환경의 자동 파기 증거와 법률 검토가 끝난 뒤 확정하며, 그 전에는 장기 분석이나 모델 학습에 사용하지 않습니다.</li>
                  <li>접속·보안 기록의 정확한 보유기간도 실제 호스팅·인증·오류 수집 설정과 함께 출시 전에 확정하여 고지합니다. 검증되지 않은 법정 기간을 임의로 적용했다고 표시하지 않습니다.</li>
                  <li>견적 점검: 새 입력은 분석 응답 생성 후 별도 DB에 저장하지 않으며 공개 결과 링크도 만들지 않습니다. 과거 저장 기록은 가격 통계와 업체 후보 신호에서 제외하고 공개 링크를 닫았습니다. 과거 기록의 열람·삭제는 고객센터로 요청할 수 있습니다.</li>
                  <li>견적 점검 실행 횟수는 서비스 이용 통계로 기록될 수 있지만, 선택한 분야·항목 상태·견적 금액은 해당 통계 이벤트에 넣지 않습니다.</li>
                  <li>웨딩코드: 답은 기기 안에서 계산하고 제품 분석·세션 녹화를 하지 않습니다. 새 공유 링크의 답 코드는 서버 요청에 포함되지 않는 주소의 # 뒤에 넣지만, 링크를 받은 사람은 답을 볼 수 있으므로 함께 비교할 사람에게만 보내야 합니다.</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제4조 (개인정보의 제3자 제공)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 회원의 동의 없이 개인정보를 다른 사업자에게 판매하거나 제공하지 않습니다.</li>
              <li>함께 준비할 사람과 연결하면 예산·할 일·일정 등 공유 영역의 정보가 연결된 회원에게 보입니다. 개인 대화나 개인 설정처럼 비공개로 표시된 정보는 공유하지 않습니다.</li>
              <li>커뮤니티에 올린 글·댓글·프로필 정보는 해당 화면의 공개 범위에 따라 다른 이용자에게 보입니다.</li>
              <li>법령에 따라 수사기관 또는 법원이 적법한 절차로 요구하는 경우에는 필요한 범위에서 제공할 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제5조 (개인정보의 처리위탁)</h2>
            <p>운영자는 실제로 해당 기능을 켠 경우 다음 사업자에게 개인정보 처리를 맡길 수 있습니다.</p>
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
                    <td className="py-2">PostHog, Inc.</td>
                    <td className="py-2">서비스 이용 통계 분석(미국 소재)</td>
                  </tr>
                  <tr>
                    <td className="py-2">Functional Software, Inc. (Sentry)</td>
                    <td className="py-2">오류 수집 및 서비스 안정성 개선(미국 소재)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] text-taupe-500">
              일부 사업자는 국외에서 정보를 처리할 수 있습니다. 실제 운영 계정의 처리 국가, 이전 항목·목적·시기·방법과 보유기간을 확인한 별도 국외 이전 고지가 완료되기 전에는 해당 국외 이전 기능을 운영 환경에서 켜지 않습니다.
            </p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제6조 (정보주체의 권리)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원은 관계 법령이 정한 범위에서 자신의 개인정보 열람·정정·삭제·처리정지를 요청할 수 있습니다.</li>
              <li>이용 내역 확인 및 탈퇴는 설정 페이지에서 직접 처리할 수 있습니다.</li>
              <li>그 밖의 요청은 고객센터(<a href="mailto:support@hanbang.ai" className="text-rose-500 underline">support@hanbang.ai</a>)로 접수할 수 있으며, 운영자는 본인 확인 후 처리 결과를 알립니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제7조 (개인정보의 안전성 확보 조치)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>이메일 가입 비밀번호는 인증 서비스에서 안전한 방식으로 처리하며, 웨딩한방 일반 데이터베이스에는 원문을 저장하지 않습니다.</li>
              <li>전송 구간은 TLS/HTTPS로 암호화합니다.</li>
              <li>데이터베이스 접근은 행 단위 접근 제어를 적용하여 본인 정보와 회원이 명시적으로 공유한 정보에 한정합니다.</li>
              <li>관리자 접근 권한은 최소 인원에게만 부여하며 접속 기록을 보관합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제8조 (쿠키 및 추적기술)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 로그인 유지와 보안 등 서비스에 필요한 쿠키를 사용합니다.</li>
              <li>이용 통계 기능이 설정된 경우에는 자동 화면 수집과 세션 녹화를 끄고, 정해진 화면 이동·기능 사용 이벤트만 수집합니다. 웨딩코드 답변 화면과 내부 연구 화면에서는 이용 통계를 실행하지 않습니다.</li>
              <li>회원은 브라우저 설정에서 쿠키 저장을 거부할 수 있습니다. 로그인 유지에 필요한 쿠키까지 막으면 일부 기능을 사용할 수 없습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제9조 (개인정보 보호책임자)</h2>
            <p>개인정보 관련 문의와 권리 행사는 아래 연락처로 접수할 수 있습니다.</p>
            <div className="mt-3 px-4 py-3 bg-white rounded-lg">
              <ul className="space-y-1 text-[13px] text-charcoal">
                <li>담당: 웨딩한방 개인정보 보호 담당</li>
                <li>이메일: <a href="mailto:support@hanbang.ai" className="text-rose-500">support@hanbang.ai</a></li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제10조 (개인정보 처리방침의 변경)</h2>
            <p>본 방침이 바뀌면 적용일과 변경 이유를 서비스 안에서 미리 알립니다. 회원의 권리에 중요한 영향을 주는 변경은 필요한 경우 별도 동의를 받습니다.</p>
          </section>

          {/* 사업자 식별 정보 — 값이 설정되지 않으면 렌더하지 않는다.
              없는 정보를 자리표시자로 띄우면 그게 곧 허위 표시다. */}
          {businessInfo ? (
            <section>
              <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">사업자 정보</h2>
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
            <p className="text-[13px] text-taupe-400">부칙: 본 방침은 2026년 7월 30일부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
