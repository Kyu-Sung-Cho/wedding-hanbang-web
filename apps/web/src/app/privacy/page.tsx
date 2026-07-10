"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
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
        <h1 className="font-serif-kr text-[28px] font-light text-noir-800 mb-2">개인정보 처리방침</h1>
        <p className="text-[13px] text-taupe-400 mb-10">최종 수정일: 2026년 7월 10일</p>

        <div className="prose prose-sm max-w-none text-[15px] text-charcoal leading-[1.9] font-normal space-y-8">
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
              <li>회원 탈퇴 요청과 새 AI 처리 차단 상태를 서버의 영속 처리 대기열에 함께 기록하고 현재 기기에서 로그아웃합니다. 진행 중인 AI 요청이 있으면 종료 여부를 확인한 뒤 서버가 삭제를 계속하며, 앱이나 브라우저를 닫아도 다시 요청할 필요가 없습니다. 일시적 실패는 제한된 횟수로 재시도하고 반복 실패는 접근이 제한된 실패 대기열에서 운영자가 확인합니다. 관련 법령에 따라 보관이 의무화된 정보는 해당 기간 동안 분리 보관됩니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>계약 또는 청약철회 등에 관한 기록: <strong>5년</strong> (전자상거래법)</li>
                  <li>대금결제 및 재화 등의 공급에 관한 기록: <strong>5년</strong> (전자상거래법)</li>
                  <li>소비자의 불만 또는 분쟁처리에 관한 기록: <strong>3년</strong> (전자상거래법)</li>
                  <li>웹사이트 방문 기록: <strong>3개월</strong> (통신비밀보호법)</li>
                  <li>AI 비용·보안 감사 장부와 피드백에 남은 과거 질문·응답·도구 원문 및 직접 식별자: <strong>90일 경과분을 매일 1회 처리하며, 경과 후 최대 약 24시간 이내 비식별화</strong></li>
                  <li>비식별화된 AI 비용·보안 감사 기록과 중복 실행 방지 해시: <strong>1년 경과분을 매일 1회 처리하며, 경과 후 최대 약 24시간 이내 삭제</strong></li>
                  <li>사용자에게 보이는 채팅 원문: 사용자가 채팅 삭제 또는 계정 탈퇴를 요청할 때까지 보관</li>
                  <li>커플 중 한 명이 탈퇴하면 삭제 절차에서 그 사용자의 비공개 상담·파생 데이터와 직접 작성한 공유 발화를 삭제하거나 삭제 표시합니다. 공동으로 생성한 공유 계획·AI 답변은 남은 파트너의 기록으로 유지되며, 마지막 파트너 탈퇴 시 함께 삭제됩니다.</li>
                  <li>본인 소유가 확인되는 사용자 전용 업로드 원본은 삭제 절차에서 제거합니다. 공동 커플 공간의 파일은 남은 파트너 기록에 필요한 경우 유지하며, 소유 관계가 불명확한 기존 파일은 다른 이용자 데이터 보호를 위해 자동 삭제하지 않고 확인 후 처리합니다. 이미 생성된 브라우저·CDN 이미지 캐시는 각 캐시 만료 시점까지 남을 수 있으며, 기존 장기 캐시는 최대 30일일 수 있습니다. 신규 업로드와 이미지 최적화 캐시는 짧은 만료시간을 적용하고 운영 배포 전 기존 캐시 정리 여부를 확인합니다.</li>
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
                    <td className="py-2">OpenAI OpCo, LLC</td>
                    <td className="py-2">AI 추론 처리(아모라 대화 및 첨부파일)</td>
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
            <p className="mt-3 text-[13px] text-taupe-500 leading-relaxed">
              PostHog 분석 및 Sentry 오류 전송은 처리위탁 계약·리전·보유기간과 국외 처리 고지가
              확정될 때까지 운영 키가 있더라도 코드에서 비활성화되어 있습니다.
            </p>
            <p className="mt-3 text-[13px] text-taupe-500 leading-relaxed">
              OpenAI Responses API 요청은 응답 저장을 비활성화한 상태(<code>store: false</code>)로 처리합니다.
              API 입력·출력은 모델 학습에 사용되지 않지만, 보안 및 오남용 모니터링 로그는 OpenAI 정책에 따라
              예외적인 경우를 제외하고 최대 30일 보관될 수 있습니다.{" "}
              <a
                href="https://developers.openai.com/api/docs/guides/your-data"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-rose-500 transition-colors"
              >
               OpenAI 데이터 처리 안내
              </a>
              . 현재 아모라 요청은 명시적 캐시 모드에서 cache breakpoint를 설정하지 않아
              질문·첨부·대화 원문을 프롬프트 캐시에 쓰지 않도록 구성합니다.
            </p>
            <div className="mt-4 rounded-xl border border-black/[0.06] bg-white p-4 text-[13px] leading-relaxed text-charcoal">
              <h3 className="mb-2 text-[13px] font-medium text-noir-800">OpenAI 국외 처리 안내</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>수령자: OpenAI OpCo, LLC (문의: privacy.openai.com)</li>
                <li>
                  이전 국가·방법: 미국을 포함한 OpenAI API 처리 지역, 아모라 이용 시 암호화된 HTTPS API 전송
                  (<a href="https://openai.com/policies/sub-processor-list/" target="_blank" rel="noreferrer" className="underline">최신 하위처리자·처리 지역</a>)
                </li>
                <li>이전 항목: 질문, 최근 대화 맥락, 선택적으로 첨부한 이미지·PDF, 도구 실행에 필요한 맥락</li>
                <li>목적: GPT-5.6 추론, 안전성·오남용 방지</li>
                <li>보유기간: Responses 저장 비활성화. 오남용 모니터링 로그는 원칙적으로 최대 30일이며, 현재 애플리케이션은 프롬프트 cache write를 요청하지 않음</li>
                <li>거부 방법·효과: 아모라에 내용을 입력하거나 파일을 첨부하지 않을 수 있으며, 이 경우 해당 AI 상담 기능 이용이 제한됩니다.</li>
              </ul>
            </div>
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-950">
              <h3 className="mb-2 text-[13px] font-medium">국외 처리 운영 확정 전 점검</h3>
              <p>
                Supabase·Vercel·Resend의 실제 계약 법인, 프로젝트 처리 국가·리전,
                전송 시기·방법, 처리 목적, 보유기간 및 거부 효과는 운영 계정 설정과
                계약서(DPA)를 기준으로 확정해야 합니다. 이 항목을 확인해 본 정책에
                게시하기 전에는 해당 서비스로 실제 이용자 개인정보를 보내는 운영 배포를
                진행하지 않습니다.
              </p>
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
            <p className="text-[13px] text-taupe-400">부칙: 본 개정 방침은 2026년 7월 10일부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
