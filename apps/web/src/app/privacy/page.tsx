"use client";

import { PUBLIC_BETA_RELATIONSHIP_SCOPE } from "@hanbang/shared";
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
        <p className="text-[13px] text-taupe-400 mb-10">최종 수정일: 2026년 7월 14일</p>

        <div className="prose prose-sm max-w-none text-[15px] text-charcoal leading-[1.9] font-normal space-y-8">
          <section>
            <p>웨딩한방 운영자(이하 &quot;운영자&quot;)는 「개인정보 보호법」 및 관련 법령을 준수하며, 회원의 개인정보를 소중히 보호합니다. 본 방침은 운영자가 운영하는 웨딩한방 플랫폼(hanbang.ai)에서 제공하는 서비스에 적용됩니다.</p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제1조 (개인정보의 수집 항목 및 수집 방법)</h2>
            <p>운영자는 서비스 제공을 위해 다음 항목을 수집합니다.</p>
            <div className="mt-3 space-y-3">
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">필수 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>이메일 주소와 서비스 내부 계정 식별자</li>
                  <li>이름(닉네임), 비밀번호(이메일 가입 시)</li>
                  <li>역할(신부/신랑)</li>
                  <li>커플 연동 정보(파트너 식별자)</li>
                </ul>
                <p className="mt-2 text-[13px] leading-relaxed text-taupe-500">
                  {PUBLIC_BETA_RELATIONSHIP_SCOPE.notice}{" "}
                  {PUBLIC_BETA_RELATIONSHIP_SCOPE.guidance}
                </p>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">선택 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>커뮤니티 가명, 선택한 이모지 아바타, 직접 작성한 글·댓글(사진·영상 업로드는 현재 차단)</li>
                  <li>결혼 예정일(미정 선택 가능), 예산과 준비 진행 상황</li>
                  <li>과거 선택적으로 저장한 휴대폰 번호(현재 새 번호 수집은 차단되어 있으며, 기존 번호는 설정에서 직접 삭제 가능. 업체 상담 요청이나 자동 알림에는 사용·전송하지 않음)</li>
                  <li>과거 축의금 관리 기능에서 저장된 데이터(이름, 금액, 신랑측·신부측·공통 구분, 관계, 수령 방식, 메모, 수령일, 내부 기록·계정·커플 식별자, 생성·수정 시각)</li>
                  <li>과거 계정에 저장된 마케팅 수신 동의 여부(현재 신규 동의 수집·마케팅 발송 없음)</li>
                </ul>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-noir-800 mb-1">자동 수집 항목</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>접속 로그, IP 주소, 브라우저·OS 정보, 페이지 조회 기록</li>
                  <li>사용자가 저장한 아모라 대화 내용과, 원문을 복제하지 않는 AI 비용·보안 감사 기록</li>
                </ul>
              </div>
            </div>
            <p className="mt-3 text-[13px] text-taupe-500 leading-relaxed">
              사용자 연구 신청 접수는 운영 환경에서 코드로 닫혀 있어 실제 이용자의 이메일·역할·이름·예식일·메시지·동의 기록·유입 정보를 새로 수집하지 않습니다. 내부 검증에는 실제 이용자 정보가 아닌 가상 데이터만 사용합니다.
            </p>
            <p className="mt-3 text-[13px] text-taupe-500 leading-relaxed">
              웨딩코드 테스트의 선택 답변은 현재 서버로 전송·수집하지 않습니다. 개인 결과 계산과
              새로고침 복구를 위해 이용자의 브라우저 저장소에만 최대 30일 보관되며, 커플 초대·비교와
              익명 응답 수집 API는 안전·동의·보유기간 설계가 승인될 때까지 코드에서 비활성화되어 있습니다.
            </p>
            <p className="mt-3 text-[13px] text-taupe-500 leading-relaxed">
              일정 알림 설정과 직접 등록한 예정 일정 알림의 읽음 상태는 서버에 동기화하지 않고 현재 브라우저의 저장소에 내부 계정 ID별로 분리해 저장합니다.
              로그인 전에는 영구 저장하지 않으며, 브라우저 저장소를 지우거나 다른 기기에서는 복구되지 않습니다. 과거의 계정 구분 없는 알림 저장값은 읽지 않고 제거합니다.
            </p>
            <p className="mt-3 text-[13px] text-taupe-500 leading-relaxed">
              축의금 관리 기능은 종료되어 새 정보를 수집하지 않습니다. 과거에 저장된 기록은 신규 화면에
              표시하거나 파일로 내보내지 않으며, 본인 소유가 확인된 기존 기록의 방어적 삭제 처리만 남겨 두었습니다.
            </p>
            <p className="mt-3 text-[13px] text-taupe-500 leading-relaxed">
              업체 연결 기능은 코드에서 비활성화되어 있습니다. 현재 새 상담 요청의 이름·휴대폰 번호·희망 일시·메모를 저장하거나 업체에 제공하지 않습니다.
              기존에 저장된 과거·예시 요청 내역의 조회만 유지하며, 결과와 공개 후기도 새로 저장하지 않습니다.
            </p>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제2조 (개인정보의 이용 목적)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>회원 식별, 본인 확인, 회원관리, 부정 이용 방지</li>
              <li>서비스 제공: AI 질문 응답과 정보 정리, 사용자가 직접 입력한 예산·일정·준비 상태 관리</li>
              <li>커플 연동 및 파트너 간 데이터 공유</li>
              <li>커뮤니티, 예절 가이드와 출처가 표시된 시세 정보 제공</li>
              <li>서비스 개선을 위한 통계 분석, 신규 기능 개발</li>
              <li>서비스에 실제로 적용되는 법령상 의무의 확인과 준수</li>
              <li>과거 동의 기록의 보존·철회 상태 관리(현재 이벤트·프로모션 발송에는 사용하지 않음)</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제3조 (개인정보의 보유 및 이용기간)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>현재 내부 테스트에서는 계정 삭제 요청 경로, 영속 처리 대기열, 처리 작업자와 실패 복구의 운영 검증이 완료되지 않아 설정의 삭제 요청 기능을 비활성화합니다. 삭제 요청 경로와 처리 작업자가 운영 검증을 통과하기 전에는 공개 운영을 시작하지 않습니다. 기능을 활성화한 뒤에는 서버가 요청을 영속적으로 접수한 경우에만 현재 기기에서 로그아웃하고 삭제 절차를 계속하며, 접수 실패 시 계정과 로그인 상태를 유지합니다. 관련 법령에 따라 보관이 의무화된 정보가 실제로 존재하는 경우에는 해당 기간 동안 분리 보관합니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>현재 베타는 플랫폼 내 계약·결제를 제공하지 않습니다. 향후 해당 거래 기록이 생성되는 기능을 제공할 경우 법정 보존기간과 대상을 기능 제공 전에 고지합니다.</li>
                  <li>현재 플랫폼 계약·결제가 없어 전자상거래 거래·결제 기록을 새로 만들지 않습니다. 향후 거래 기능을 열 때 실제 적용 법령과 기록별 보유기간을 별도 법률 검토 후 먼저 고지합니다.</li>
                  <li>접속 로그의 실제 처리 주체·항목·보유기간은 호스팅·데이터베이스 공급자 계약과 운영 설정을 기준으로 확정해야 합니다. 이를 본 방침에 반영하기 전에는 공개 운영을 시작하지 않습니다.</li>
                  <li>AI 비용·보안 감사 장부와 피드백에 남은 과거 질문·응답·도구 원문 및 직접 식별자: <strong>90일 경과분을 매일 1회 처리하며, 경과 후 최대 약 24시간 이내 비식별화</strong></li>
                  <li>비식별화된 AI 비용·보안 감사 기록과 중복 실행 방지 해시: <strong>1년 경과분을 매일 1회 처리하며, 경과 후 최대 약 24시간 이내 삭제</strong></li>
                  <li>사용자에게 보이는 채팅 원문: 사용자가 채팅 삭제 또는 계정 탈퇴를 요청할 때까지 보관</li>
                  <li>웨딩코드 개인 결과: 서버 미수집, 해당 브라우저에 최대 <strong>30일</strong> 보관 후 읽는 시점에 자동 제거</li>
                  <li>2026년 하반기 6주 사용자 연구 접수는 운영 환경에서 코드로 닫혀 있습니다. 내부 검증용 가상 신청 정보의 보관 상한은 접수일로부터 <strong>180일</strong>이며, 만료분은 매일 1회 정리하여 만료 후 최대 약 24시간 이내 삭제하도록 구성합니다. 실제 권리 행사 경로가 검증되기 전에는 실제 이용자 개인정보를 받지 않습니다.</li>
                  <li>결혼 준비 경험 설문 화면과 저장 API는 현재 코드로 닫혀 있어 새 응답을 받지 않습니다. 화면 방문 시 과거 브라우저 임시저장을 제거합니다. 과거 제출된 비식별 응답의 보관 상한은 <strong>1년</strong>이며, 만료분은 매일 1회 정리하여 만료 후 최대 약 24시간 이내 삭제하도록 구성합니다.</li>
                  <li>동기방은 현재 비활성화되어 새 견적·업체명·가격·메모를 수집하거나 집계하지 않습니다. 기존 테스트 데이터는 브라우저에서 접근할 수 없도록 닫고 운영 정리 대상으로 관리합니다.</li>
                  <li>견적 포함 항목을 별도 입력하는 기능은 신규 수집·저장·공개를 종료했고 과거 공개 설정도 일괄 해제합니다. 계정에 남은 비공개 과거 기록은 회원 탈퇴 시 삭제됩니다.</li>
                  <li>커뮤니티 공개 프로필: 계정 ID와 별개인 무작위 공개 식별자, 사용자가 직접 정한 가명 또는 무작위 가명, 허용된 이모지 아바타만 공개합니다. 실명·이메일·계정 ID·예식 시기·완료 여부·활동 합계·등급·뱃지는 다른 이용자의 응답에 포함하지 않습니다.</li>
                  <li>커플 중 한 명이 탈퇴하면 삭제 절차에서 그 사용자의 비공개 상담·파생 데이터와 직접 작성한 공유 발화를 삭제하거나 삭제 표시합니다. 공동으로 생성한 공유 계획·AI 답변은 남은 파트너의 기록으로 유지되며, 마지막 파트너 탈퇴 시 함께 삭제됩니다.</li>
                  <li>본인 소유가 확인되는 사용자 전용 업로드 원본은 삭제 절차에서 제거합니다. 공동 커플 공간의 파일은 남은 파트너 기록에 필요한 경우 유지하며, 소유 관계가 불명확한 기존 파일은 다른 이용자 데이터 보호를 위해 자동 삭제하지 않고 확인 후 처리합니다. 이미 생성된 브라우저·CDN 이미지 캐시는 각 캐시 만료 시점까지 남을 수 있으며, 기존 장기 캐시는 최대 30일일 수 있습니다. 신규 업로드와 이미지 최적화 캐시는 짧은 만료시간을 적용하고 운영 배포 전 기존 캐시 정리 여부를 확인합니다.</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제4조 (개인정보의 제3자 제공)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 회원의 개인정보를 본인의 동의 없이 외부에 제공하지 않습니다.</li>
              <li>현재 베타에서는 업체 상담 요청 경로로 개인정보를 제3자에게 제공하지 않습니다. 기능을 다시 활성화하기 전에 제공받는 자, 제공 항목, 목적, 보유기간, 동의와 철회 방법을 화면과 본 방침에 고지하고 실제 전달·삭제 절차를 검증합니다.</li>
              <li>다음의 경우는 예외로 합니다.
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>법령에 의해 요구되는 경우: 수사기관, 법원의 영장 등</li>
                </ul>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제5조 (개인정보의 처리위탁)</h2>
            <p>운영자는 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁하도록 코드를 구성하고 있습니다. 실제 운영은 각 공급자 계약과 프로젝트 설정을 확인한 뒤 시작합니다.</p>
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
              첨부 이미지는 OpenAI 전송 전에 서버에서 방향을 적용해 재인코딩하며 EXIF·GPS 등
              위치·기기 메타데이터를 제거합니다. PDF는 이미지 재인코딩 대상이 아니므로 파일 내용과
              속성에 민감정보가 없는지 사용자가 전송 전에 확인해야 합니다. 현재 첨부는 이미지와 PDF만
              지원하며, 각 첨부 상담에서 현재 전송 안내의 체크박스를 직접 확인한 경우에만 OpenAI 요청을
              시작합니다.
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
              <li>정보주체에게는 관련 법령에 따른 개인정보 열람·정정·삭제·처리정지 요구 권리가 있습니다.</li>
              <li>설정에서 이름·예식일 등 현재 제공되는 항목을 수정할 수 있습니다. 계정 삭제와 그 밖의 권리 행사 경로는 아직 운영 검증 전이므로 공개하지 않으며, 해당 경로가 준비되기 전에는 공개 운영을 시작하지 않습니다.</li>
              <li>실제 수신·본인 확인·처리 기록·삭제 절차가 검증되기 전에는 공개 권리 행사 창구를 안내하지 않으며, 그 전에는 실제 이용자 개인정보를 처리하는 공개 운영을 시작하지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제7조 (개인정보의 안전성 확보 조치)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>이메일 가입 비밀번호는 인증 공급자가 일방향 해시 형태로 관리하며 애플리케이션 데이터베이스에 원문을 저장하지 않습니다.</li>
              <li>웹 전송 구간은 HTTPS를 사용하도록 구성합니다.</li>
              <li>데이터베이스는 RLS(Row Level Security)와 서버 전용 권한으로 비공개·커플 공유·커뮤니티 공개 범위를 구분합니다.</li>
              <li>관리자 최소권한, 접속 기록, 비밀 회전 절차의 운영 검증이 끝나기 전에는 공개 운영을 시작하지 않습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제8조 (쿠키 및 추적기술)</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>운영자는 사용자 경험 개선을 위해 쿠키를 사용합니다.</li>
              <li>회원은 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으며, 이 경우 일부 서비스 이용에 제약이 있을 수 있습니다.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제9조 (개인정보 문의 창구와 공개 베타 게이트)</h2>
            <p>정식 법적 주체, 개인정보 보호책임자, 실제 수신·본인 확인이 가능한 문의 창구와 계정 삭제 처리 경로가 모두 확정되기 전에는 실제 이용자 개인정보를 처리하는 공개 운영을 시작하지 않습니다.</p>
            <div className="mt-3 px-4 py-3 bg-white rounded-xl">
              <ul className="space-y-1 text-[13px] text-charcoal">
                <li>담당: 웨딩한방 운영자 개인정보 문의 창구</li>
                <li>현재 상태: 공개 접수 기능과 연락처 안내 모두 닫힘</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="font-serif-kr text-[18px] font-medium text-noir-800 mb-3">제10조 (개인정보 처리방침의 변경)</h2>
            <p>본 방침은 법령·정책 또는 보안기술의 변경에 따라 내용이 추가·삭제 및 수정될 수 있으며, 변경 시 사전에 공지합니다.</p>
          </section>

          <section className="pt-4 border-t border-black/[0.06]">
            <p className="text-[13px] text-taupe-400">부칙: 본 개정 방침은 2026년 7월 14일부터 시행합니다.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
