// 서버 컴포넌트다. **클라이언트로 만들면 안 된다** — 탈퇴 접수 문장이
// `ACCOUNT_DELETION_INTAKE_ENABLED` 를 서버에서 읽어 정해지는데, 브라우저
// 번들에서는 그 값이 undefined 라 **법적 고지가 조용히 틀린 문장이 된다**
// (2026-09-02 에 실제로 그렇게 만들 뻔했고 테스트가 잡았다).
// 이 파일은 클라이언트 훅·이벤트를 하나도 쓰지 않는다.
import Link from "next/link";
import { accountDeletionIntakeSentence } from "@/lib/account/deletionIntake";
import { CONTACT } from "@/lib/constants/contact";

import { businessInfoRows, readBusinessInfo } from "@/lib/legal/businessInfo";
import {
  WEDDING_CODE_RESEARCH_MIN_AGE,
  WEDDING_CODE_RESEARCH_RETENTION_DAYS,
  WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS,
} from "@/lib/weddingCode/contribution/contract";
import { isWeddingCodeResearchStorageActive } from "@/lib/weddingCode/contribution/server";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  const businessInfo = readBusinessInfo();
  // 탈퇴 접수 문장과 같은 이유로 서버에서 읽는다. 저장소가 없는 동안에는 받는다고 쓰지 않고,
  // 새 답 받기를 멈춘 뒤에도 남은 답이 있을 수 있는 동안에는 고지를 내리지 않는다.
  const researchStorageActive = isWeddingCodeResearchStorageActive();
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
        <h1 className="font-serif-kr text-[28px] font-light text-[var(--hb-text-strong)] mb-2">개인정보 처리방침</h1>
        <p className="text-[13px] text-[var(--hb-text-muted)] mb-10">최종 수정일: 2026년 9월 11일</p>

        <div className="prose prose-sm max-w-none text-[14px] text-charcoal leading-[1.9] font-light space-y-8">
          <section>
            <p>{operatorName}(이하 &quot;운영자&quot;)는 「개인정보 보호법」과 관계 법령을 준수합니다. 본 방침은 웹사이트(hanbang.ai)와 모바일 애플리케이션에서 제공하는 웨딩한방 서비스에 적용됩니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제1조 (개인정보의 수집 항목 및 수집 방법)</h2>
            <p>운영자는 회원이 사용하는 기능에 따라 다음 정보를 처리합니다. 사용하지 않은 기능의 입력값은 받지 않습니다.</p>
            <div className="mt-3 space-y-3">
              <div>
                <h3 className="text-[14px] font-medium text-[var(--hb-text-strong)] mb-1">계정 생성·로그인</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>이메일 주소 또는 카카오·구글·Apple 계정 식별자</li>
                  <li>이름 또는 닉네임</li>
                  <li>이메일 가입 시 비밀번호는 인증 서비스 제공자인 Supabase가 처리합니다. 웨딩한방의 일반 서비스 데이터베이스에는 비밀번호 원문을 저장하지 않습니다.</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-[var(--hb-text-strong)] mb-1">회원이 기능을 사용할 때 입력하는 정보</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>결혼 준비 역할, 함께 준비할 사람의 연결 정보, 결혼 예정일, 결혼식장, 총 예산, 준비 상태와 선호</li>
                  <li>회원이 직접 고른 아모라 도움 방식(추천·비교 순서, 설명 분량, 힘들 때의 도움 순서, 준비·가족 의견을 정리하는 방식)</li>
                  <li>예산 항목과 실제 지출, 할 일, 일정, 메모, 아모라에게 보낸 질문과 첨부 파일, 아모라의 답변</li>
                  <li>프로필 사진과 커뮤니티에 올린 글·댓글·사진·파일</li>
                  <li>마케팅 수신 동의 여부</li>
                  <li>가입 시 받은 필수 동의(이용약관·개인정보 처리방침) 여부, 동의한 시각, 동의 당시 문서 판(예: 2026-08-22)</li>
                  {researchStorageActive ? (
                    <li>웨딩코드 답 보태기에 동의한 경우(2026년 9월 16일부터, 선택): 문항 판, 장면마다 고른 답 기호(건너뛴 장면 포함), 동의 문구 판, 보낸 날짜, 삭제 코드의 해시. 로그인하지 않아도 되며 계정과 연결하지 않습니다.</li>
                  ) : null}
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-[var(--hb-text-strong)] mb-1">서비스 이용 중 자동으로 생기는 정보</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>접속 로그, IP 주소, 브라우저·OS 정보, 페이지 조회 기록</li>
                  <li>오류 기록과 보안 기록</li>
                  <li>아모라 호출의 모델명, 토큰 수, 처리 시간, 성공 여부, 비용 등 운영 기록. 이 비용 기록에는 질문·답변·첨부 파일·도구 입력값 원문을 복제하지 않습니다.</li>
                </ul>
              </div>
            </div>
          </section>

          {/*
            방침 전문에 "14세"·"법정대리인"·"아동" 이 한 번도 없었다. 가입 동의에도
            연령 항목이 없어, 만 14세 미만이 가입해도 아무것도 걸러지지 않았다.
            생년월일을 새로 수집하지 않고 확인 항목으로 거른다 — 거르는 데 필요하지
            않은 정보를 더 받는 것은 최소수집 원칙에 어긋난다.
          */}
          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제1조의2 (만 14세 미만 아동의 개인정보)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>웨딩한방은 만 14세 이상만 이용할 수 있습니다. 회원은 가입할 때 만 14세 이상임을 확인하며, 그 확인 여부와 시각을 계정에 기록합니다.</li>
              <li>운영자는 만 14세 미만 아동의 개인정보를 수집하지 않습니다. 「개인정보 보호법」 제22조의2가 요구하는 법정대리인 동의 절차를 제공하지 않기 때문입니다.</li>
              <li>만 14세 미만임이 확인된 계정은 지체 없이 삭제하고 수집된 개인정보를 파기합니다. 법정대리인은 고객센터로 해당 계정의 확인과 삭제를 요청하실 수 있습니다.</li>
              <li>운영자는 생년월일을 수집하지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제2조 (개인정보의 이용 목적)</h2>
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
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제3조 (개인정보의 보유 및 이용기간)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>계정과 결혼 준비 정보는 회원 탈퇴 또는 해당 처리 목적이 끝날 때까지 보관합니다. 탈퇴가 접수되면 커뮤니티 새 파일 업로드를 막고, 임시 파일 접근 링크의 만료와 파일 소유권 및 삭제 대상을 확인한 뒤 더 이상 필요하지 않은 개인정보를 지체 없이 파기합니다. 다른 법령에 따라 별도 보관해야 하는 정보는 전용 보관 경계가 검증된 뒤 적용 범위와 기간을 고지하고 다른 개인정보와 분리하여 보관합니다. 이 경계가 준비되지 않은 상태에서는 해당 보관 의무를 만드는 거래 기능을 운영하지 않습니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>현재 웨딩한방은 업체 계약·예약·결제를 중개하지 않으므로 해당 거래 기록을 수집하거나 보관하지 않습니다.</li>
                  <li>아모라 대화 원문은 대화 내역 제공을 위해 계정이 유지되는 동안 보관합니다. 비공개 대화 삭제를 선택하면 해당 대화 원문과 아모라가 자동 생성한 요약·기억을 삭제하고 그 범위의 기억 사용을 끕니다. 별도로 저장한 메모, 법적·보안 목적의 운영 기록과 백업은 각각 고지된 보관·파기 정책에 따라 처리합니다.</li>
                  <li>아모라 도움 방식은 회원이 설정에서 직접 확인·수정·삭제할 수 있습니다. 모두 지우면 해당 개인 설정 행을 삭제하며, 계정을 탈퇴하면 프로필과 함께 삭제합니다.</li>
                  <li>아모라 비용·오류 기록에는 대화 원문을 복제하지 않습니다. 과거 이 기록에 남은 질문·답변·도구 입력 및 출력과 오류 원문은 <strong>90일이 지나면 자동으로 제거</strong>됩니다. 이후에도 회원·커플·대화 연결 식별자, 처리 시각, 모델·사용량·비용·성공 여부 등 운영 기록이 남을 수 있으며, 익명 정보로 바뀌는 것은 아닙니다. 이 기록은 장기 분석이나 모델 학습에 사용하지 않습니다.</li>
                  <li>회사의 관리자가 회원 정보에 접근한 기록(접속한 사람, 시각, 접근한 화면 주소)은 <strong>1년간 보관</strong>한 뒤 자동으로 파기합니다. 이 기록에는 조회한 회원 정보의 내용이나 검색어를 담지 않습니다.</li>
                  <li>회원의 로그인·접속에 관한 기록은 별도의 장기 저장소를 두지 않고, 인증·호스팅·오류 수집 서비스가 각자의 설정에 따라 보관합니다. 회사가 그와 별도로 회원 접속 이력을 장기간 모아 두지는 않습니다.</li>
                  <li>견적 점검: 새 입력은 분석 응답 생성 후 별도 DB에 저장하지 않으며 공개 결과 링크도 만들지 않습니다. 과거 저장 기록은 가격 통계와 업체 후보 신호에서 제외하고 공개 링크를 닫았습니다. 과거 기록의 열람·삭제는 고객센터로 요청할 수 있습니다.</li>
                  <li>견적 점검 실행 횟수는 서비스 이용 통계로 기록될 수 있지만, 선택한 분야·항목 상태·견적 금액은 해당 통계 이벤트에 넣지 않습니다.</li>
                  <li>웨딩코드: 답은 기기 안에서 계산하고 {researchStorageActive ? "아래 답 보태기에 동의한 경우가 아니면 " : ""}서버에 저장하지 않으며 세션 녹화를 하지 않습니다. 2026년 9월 23일부터는 화면 개선을 위해 시작·완료·공유 여부, 몇 번째 장면까지 봤는지, 답한 장면과 건너뛴 장면의 개수를 서비스 이용 통계로 기록합니다. 고른 답·웨딩코드·공유 링크 주소는 이 통계에 넣지 않습니다. 새 공유 링크의 답 코드는 서버 요청에 포함되지 않는 주소의 # 뒤에 넣지만, 링크를 받은 사람은 답을 볼 수 있으므로 함께 비교할 사람에게만 보내야 합니다.</li>
                  {researchStorageActive ? (
                    <li>웨딩코드 답 보태기(선택, 2026년 9월 16일부터): 결과 화면에서 만 {WEDDING_CODE_RESEARCH_MIN_AGE}세 이상임을 확인하고 동의한 경우에만 제1조의 항목을 보관합니다. 이름·연락처·계정·IP 주소·공유 링크·상대의 답은 함께 보관하지 않고, 저장 시각은 날짜 단위로만 남기며, 다른 사업자에게 제공하지 않습니다. 문항과 선택지를 고치는 데만 쓰고, 보낸 날부터 {WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 삭제합니다. 보낼 때 보여드리는 삭제 코드로 언제든 지울 수 있고, 코드를 잃어버리면 누구의 답인지 알 수 없어 찾아 지울 수 없습니다. 지운 삭제 코드의 해시와 삭제 날짜는 같은 코드로 다시 저장되지 않게 하려고 {WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS}일간 보관합니다. 새 답 받기를 멈춘 뒤에도 이미 받은 답의 자동 삭제와 삭제 요청은 계속 처리합니다.</li>
                  ) : null}
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제4조 (개인정보의 제3자 제공)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 회원의 동의 없이 개인정보를 다른 사업자에게 판매하거나 제공하지 않습니다.</li>
              <li>함께 준비할 사람과 연결하면 예산·할 일·일정 등 공유 영역의 정보가 연결된 회원에게 보입니다. 개인 대화나 개인 설정처럼 비공개로 표시된 정보는 공유하지 않습니다.</li>
              <li>커뮤니티에 올린 글·댓글·프로필 정보는 해당 화면의 공개 범위에 따라 다른 이용자에게 보입니다.</li>
              <li>법령에 따라 수사기관 또는 법원이 적법한 절차로 요구하는 경우에는 필요한 범위에서 제공할 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제5조 (개인정보의 처리위탁)</h2>
            <p>운영자는 실제로 해당 기능을 켠 경우 다음 사업자에게 개인정보 처리를 맡길 수 있습니다.</p>
            {/*
              2026-08-31: 두 표 어디에도 **Cloudflare 가 없었다.** 그런데 이용자의
              요청은 이미 두 경로로 Cloudflare 를 지나간다. 운영에서 직접 재서
              확인한 것만 적는다.

              (1) 2026-08-31 https://hanbang.ai/privacy 응답 헤더의 CSP 에
                  `https://challenges.cloudflare.com` 가 script-src·connect-src·
                  frame-src 세 곳에 있다. 가입·비밀번호 찾기 화면의 봇 확인
                  위젯(`components/auth/TurnstileWidget.tsx`)이 그 호스트에서
                  스크립트를 내려받고, 서버 검증(`lib/turnstile.ts`)은 siteverify
                  에 `remoteip` 로 이용자 IP 를 함께 보낸다
                  (`api/auth/signup`·`api/auth/forgot-password` 가 호출자다).
              (2) 2026-08-31 운영 Supabase 엔드포인트
                  (slrtobkksjmxgzatjyqb.supabase.co)의 응답 헤더가
                  `Server: cloudflare` · `CF-RAY: …-ICN` 이고, `Domain=supabase.co`
                  로 봇 차단 쿠키 `__cf_bm` 을 심는다. 로그인·대화·예산 등 모든
                  DB/인증 요청이 그 앞단을 지난다는 뜻이다.

              반대편 실측도 같이 남긴다 — 같은 날 운영 가입 화면에는 봇 확인 위젯이
              **렌더되지 않았다**(사이트 키 미설정, 브라우저 요청 0건). 그래서 (1)은
              오늘 도는 기능이 아니라 키가 설정되는 순간 도는 배선이고, (2)는 오늘
              이미 일어나는 이전이다. 제5조 첫 문장이 "실제로 해당 기능을 켠 경우"로
              시작하므로 두 경우를 한 줄로 적을 수 있다.

              엣지 노드가 국내(인천)로 잡혔더라도 수탁사 자체는 미국 법인이므로
              국외 이전으로 고지한다.

              남은 것 1 — 수탁사들의 개인정보 보호 담당 연락처는 저장소·운영 어디에도
              근거가 없어 지어내지 않았다. 아래 목록의 "고객센터로 요청하시면 안내"
              문구를 그대로 두고, 연락처를 확보하면 표에 직접 적는다.

              남은 것 2 — 위 "최종 수정일"과 부칙은 이 변경에 맞춰 올리지 않았다.
              `lib/auth/__tests__/signupConsent.test.ts` 가 이 날짜를
              `SIGNUP_CONSENT_POLICY_VERSION`(packages/shared) 및 이용약관의 최종
              수정일과 **한 값으로 묶어** 두었기 때문이다. 셋을 함께 올리면 기존
              회원의 동의 기록이 새 판을 가리키게 되므로 파운더 결정이 필요하다.
              날짜를 올릴 때 같이 손대야 하는 곳: privacy/page.tsx 최종 수정일·부칙,
              terms/page.tsx 최종 수정일, packages/shared 의 동의 판 상수.
            */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    <th className="py-2 text-left font-medium text-[var(--hb-text-strong)]">수탁 업체</th>
                    <th className="py-2 text-left font-medium text-[var(--hb-text-strong)]">위탁 업무</th>
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
                    <td className="py-2">Cloudflare, Inc.</td>
                    <td className="py-2">데이터베이스·인증 요청 구간의 네트워크 보안과 전송(미국 소재)</td>
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
            {/*
              여기에는 "국외 이전 고지는 준비 중이며 확정되는 대로 반영합니다" 만
              있었다. 그런데 이전은 **이미 일어나고 있다** — 위 표의 수탁사 중
              PostHog·Sentry 는 미국 엔드포인트를 쓰고(운영 응답의 CSP 에
              `us.i.posthog.com`·`ingest.us.sentry.io` 가 그대로 있다), 운영
              데이터베이스는 인도 리전이다. 준비 중이라고 적어 둔 채 이전하는 것은
              개인정보보호법 제28조의8 이 요구하는 사전 고지가 아니다.

              그래서 법이 요구하는 항목을 채운다. **확인한 것만 적는다** —
              각 수탁사의 개인정보 보호 담당 연락처는 저장소·운영 어디에도 근거가
              없어 지어내지 않았고, 그 항목만 별도로 남겨 두었다.
            */}
            <div className="mt-4">
              <h3 className="text-[14px] font-medium text-[var(--hb-text-strong)] mb-2">국외 이전에 관한 고지</h3>
              <p className="text-[13px] text-charcoal">
                위 수탁 업체는 국외에 서버를 두고 있어, 서비스를 이용하시면 개인정보가 국외로 이전됩니다. 이전은 회원이 서비스를 이용하는 시점에 암호화된 통신(HTTPS)으로 자동으로 이루어지며, 별도의 저장 매체를 통한 이전은 없습니다.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="border-b border-black/[0.06]">
                      <th className="py-2 text-left font-medium text-[var(--hb-text-strong)]">이전받는 자</th>
                      <th className="py-2 text-left font-medium text-[var(--hb-text-strong)]">이전되는 국가</th>
                      <th className="py-2 text-left font-medium text-[var(--hb-text-strong)]">이전 항목</th>
                      <th className="py-2 text-left font-medium text-[var(--hb-text-strong)]">이전받는 자의 연락처</th>
                    </tr>
                  </thead>
                  <tbody className="text-charcoal">
                    <tr className="border-b border-black/[0.04]">
                      <td className="py-2 align-top">Supabase, Inc.</td>
                      <td className="py-2 align-top">인도(데이터베이스 리전), 미국(사업자 소재지)</td>
                      <td className="py-2 align-top">제1조의 모든 항목 — 계정 식별자, 회원이 입력한 결혼 준비 정보, 아모라 대화와 첨부 파일, 커뮤니티 게시물</td>
                      <td className="py-2 align-top"><a href="mailto:privacy@supabase.com" className="text-[var(--hb-accent-hover)] underline">privacy@supabase.com</a></td>
                    </tr>
                    <tr className="border-b border-black/[0.04]">
                      <td className="py-2 align-top">Vercel Inc.</td>
                      <td className="py-2 align-top">미국</td>
                      <td className="py-2 align-top">접속 로그, IP 주소, 브라우저·OS 정보</td>
                      <td className="py-2 align-top"><a href="mailto:privacy@vercel.com" className="text-[var(--hb-accent-hover)] underline">privacy@vercel.com</a></td>
                    </tr>
                    <tr className="border-b border-black/[0.04]">
                      <td className="py-2 align-top">Cloudflare, Inc.</td>
                      <td className="py-2 align-top">미국(사업자 소재지). 요청은 이용자와 가까운 전 세계 엣지 노드에서 처리됩니다</td>
                      <td className="py-2 align-top">IP 주소, 브라우저·기기 신호(User-Agent 등 요청 헤더), 요청한 주소, 봇 차단 쿠키(__cf_bm)</td>
                      <td className="py-2 align-top"><a href="mailto:dpo@cloudflare.com" className="text-[var(--hb-accent-hover)] underline">dpo@cloudflare.com</a></td>
                    </tr>
                    <tr className="border-b border-black/[0.04]">
                      <td className="py-2 align-top">OpenAI</td>
                      <td className="py-2 align-top">미국</td>
                      <td className="py-2 align-top">아모라에게 보낸 질문과 첨부 파일, 답변 생성에 필요한 대화 문맥</td>
                      <td className="py-2 align-top"><a href="mailto:dsar@openai.com" className="text-[var(--hb-accent-hover)] underline">dsar@openai.com</a></td>
                    </tr>
                    <tr className="border-b border-black/[0.04]">
                      <td className="py-2 align-top">Resend, Inc.</td>
                      <td className="py-2 align-top">미국</td>
                      <td className="py-2 align-top">이메일 주소</td>
                      <td className="py-2 align-top"><a href="mailto:support@resend.com" className="text-[var(--hb-accent-hover)] underline">support@resend.com</a></td>
                    </tr>
                    <tr className="border-b border-black/[0.04]">
                      <td className="py-2 align-top">PostHog, Inc.</td>
                      <td className="py-2 align-top">미국</td>
                      <td className="py-2 align-top">접속 기록, 페이지 조회 기록, 이용 통계</td>
                      <td className="py-2 align-top"><a href="mailto:privacy@posthog.com" className="text-[var(--hb-accent-hover)] underline">privacy@posthog.com</a></td>
                    </tr>
                    <tr>
                      <td className="py-2 align-top">Functional Software, Inc. (Sentry)</td>
                      <td className="py-2 align-top">미국</td>
                      <td className="py-2 align-top">오류 기록과 보안 기록</td>
                      <td className="py-2 align-top"><a href="mailto:compliance@sentry.io" className="text-[var(--hb-accent-hover)] underline">compliance@sentry.io</a></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <ul className="mt-3 list-disc pl-5 space-y-1 text-[13px] text-charcoal">
                <li>이전 목적은 위 위탁 업무와 같습니다.</li>
                <li>보유·이용 기간은 위탁 계약이 끝나거나 제3조의 보유 기간이 지날 때까지이며, 그 이후에는 파기합니다.</li>
                <li>위 연락처는 각 사가 공개한 개인정보 처리방침에서 확인한 개인정보 담당 창구입니다(2026년 9월 2일 확인). 연락이 닿지 않거나 안내가 필요하시면 고객센터(<a href={`mailto:${CONTACT.email}`} className="text-[var(--hb-accent-hover)] underline">{CONTACT.email}</a>)로 알려 주세요.</li>
                <li>국외 이전을 원하지 않으시면 서비스 이용을 중단하고 고객센터로 계정 삭제를 요청하실 수 있습니다. 다만 위 수탁 업무 없이는 서비스의 핵심 기능을 제공할 수 없어, 일부 기능만 선택적으로 제외할 수는 없습니다.</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제6조 (정보주체의 권리)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원은 관계 법령이 정한 범위에서 자신의 개인정보 열람·정정·삭제·처리정지를 요청할 수 있습니다.</li>
              {/* 접수 경로는 **플래그와 같은 곳**에서 읽는다. 여기에 문장을 박아 두면
                  플래그가 움직일 때 법적 고지가 조용히 거짓이 된다(2026-09-02). */}
              <li>설정 페이지에서는 프로필, 웨딩 스타일, 커플 연결, 알림 설정, 아모라 도움 방식, 아모라가 기억하는 것을 직접 확인하고 수정할 수 있습니다. 이용 내역·접속 기록의 열람은 고객센터(<a href={`mailto:${CONTACT.email}`} className="text-[var(--hb-accent-hover)] underline">{CONTACT.email}</a>)로 요청하실 수 있으며, 운영자는 본인 확인 후 보유하고 있는 범위에서 안내합니다. {accountDeletionIntakeSentence(CONTACT.email)} 탈퇴는 되돌릴 수 없으며, 무엇이 지워지고 무엇이 남는지는 진행 전에 미리 안내해 드립니다.</li>
              <li>연결된 파트너와 함께 만든 준비 기록과 대화는 두 사람의 정보가 섞여 있어 남은 파트너의 화면에 유지되고, 탈퇴한 회원의 식별 정보만 제거됩니다. 등록한 업체가 있으면 해당 업체를 먼저 정리해야 탈퇴가 완료됩니다.</li>
              <li>그 밖의 요청은 고객센터(<a href={`mailto:${CONTACT.email}`} className="text-[var(--hb-accent-hover)] underline">{CONTACT.email}</a>)로 접수할 수 있으며, 운영자는 본인 확인 후 처리 결과를 알립니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제7조 (개인정보의 안전성 확보 조치)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>이메일 가입 비밀번호는 인증 서비스에서 안전한 방식으로 처리하며, 웨딩한방 일반 데이터베이스에는 원문을 저장하지 않습니다.</li>
              <li>전송 구간은 TLS/HTTPS로 암호화합니다.</li>
              <li>데이터베이스 접근은 행 단위 접근 제어를 적용하여 본인 정보와 회원이 명시적으로 공유한 정보에 한정합니다.</li>
              <li>관리자 접근 권한은 최소 인원에게만 부여하며 접속 기록을 보관합니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제8조 (쿠키 및 추적기술)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 로그인 유지와 보안 등 서비스에 필요한 쿠키를 사용합니다.</li>
              <li>이용 통계 기능이 설정된 경우에는 자동 화면 수집과 세션 녹화를 끄고, 정해진 화면 이동·기능 사용 이벤트만 수집합니다. 웨딩코드 화면에서는 페이지 조회를 기록하지 않고, 2026년 9월 23일부터 답과 주소를 뺀 흐름 이벤트(제3조)만 수집합니다. 내부 연구 화면에서는 이용 통계를 실행하지 않습니다.</li>
              <li>회원은 브라우저 설정에서 쿠키 저장을 거부할 수 있습니다. 로그인 유지에 필요한 쿠키까지 막으면 일부 기능을 사용할 수 없습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제9조 (개인정보 보호책임자)</h2>
            <p>개인정보 관련 문의와 권리 행사는 아래 연락처로 접수할 수 있습니다.</p>
            <div className="mt-3 px-4 py-3 bg-white rounded-[6px]">
              <ul className="space-y-1 text-[13px] text-charcoal">
                <li>담당: 웨딩한방 개인정보 보호 담당</li>
                <li>이메일: <a href={`mailto:${CONTACT.email}`} className="text-[var(--hb-accent-hover)]">{CONTACT.email}</a></li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">제10조 (개인정보 처리방침의 변경)</h2>
            <p>본 방침이 바뀌면 적용일과 변경 이유를 서비스 안에서 미리 알립니다. 회원의 권리에 중요한 영향을 주는 변경은 필요한 경우 별도 동의를 받습니다.</p>
          </section>

          {/* 사업자 식별 정보 — 값이 설정되지 않으면 렌더하지 않는다.
              없는 정보를 자리표시자로 띄우면 그게 곧 허위 표시다. */}
          {businessInfo ? (
            <section>
              <h2 className="font-serif-kr text-[18px] font-medium text-[var(--hb-text-strong)] mb-3">사업자 정보</h2>
              <div className="mt-3 px-4 py-3 bg-white rounded-[6px]">
                <ul className="space-y-1 text-[13px] text-charcoal">
                  {businessInfoRows(businessInfo).map(([label, value]) => (
                    <li key={label}>{label}: {value}</li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[13px] text-[var(--hb-text-muted)]">부칙: 본 방침은 2026년 7월 30일부터 시행합니다. 2026년 8월 21일 개정분(제1조 동의 기록 항목, 제6조 탈퇴 처리 범위)은 같은 날부터 적용합니다. 2026년 9월 11일에는 제3조의 아모라 비용·오류 기록에서 원문 제거 후에도 연결 식별자와 운영 기록이 남는다는 설명을 정정했습니다. 이 정정으로 처리 항목·목적·보유 기간을 추가하거나 변경하지 않았습니다. 2026년 9월 16일 개정분(제3조·제8조의 웨딩코드 이용 통계)은 2026년 9월 23일부터 적용합니다.{researchStorageActive ? " 2026년 9월 16일 개정분(제1조·제3조의 웨딩코드 답 보태기)은 같은 날부터 적용합니다 — 동의 없이는 아무것도 저장하지 않는 선택 기능이라 고지와 같은 날 엽니다." : ""}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
