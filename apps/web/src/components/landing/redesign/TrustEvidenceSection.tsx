import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import {
  DISCLOSURE_SOURCE_URL,
  disclosureRoundLabel,
} from "@/lib/price/period";

import { landingContent, trustPromises } from "./landingContent";
import {
  displaySection,
  secondaryLink,
  secondaryLinkOnDark,
  sectionEyebrow,
  sectionLede,
  sectionRhythm,
} from "./landingType";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

type TrustEvidenceSectionProps = {
  publishedPolicyCount: number;
  publishedVendorCount: number;
  countsVerifiedAt: string;
};

export default function TrustEvidenceSection({
  publishedPolicyCount,
  publishedVendorCount,
  countsVerifiedAt,
}: TrustEvidenceSectionProps) {
  return (
    <section
      id="trust"
      className="scroll-mt-20 bg-[#FBF8F2] text-[#243832]"
      aria-labelledby="landing-trust-title"
    >
      <div className={`${shell} ${sectionRhythm}`}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-20">
          <div>
            <p className={sectionEyebrow}>
              {landingContent.trust.eyebrow}
            </p>
            <h2
              id="landing-trust-title"
              className={`mt-4 max-w-xl ${displaySection}`}
            >
              결정은 둘이.
              <span className="mt-2 block text-[#8F6662]">아모라는 정리.</span>
            </h2>
            <p className={`mt-6 max-w-[34rem] ${sectionLede} text-[#36534E]/80`}>
              {landingContent.trust.body}
            </p>
          </div>

          <ol className="border-y border-[#243832]/14">
            {trustPromises.map((promise) => (
              <li
                key={promise.number}
                className="grid gap-3 border-b border-[#243832]/10 py-6 last:border-b-0 sm:grid-cols-[3rem_minmax(0,0.82fr)_minmax(0,1.18fr)] sm:items-start sm:gap-6 sm:py-7"
              >
                <span className="text-[12px] font-semibold text-[#8F6662]">{promise.number}</span>
                <strong className="text-[18px] font-semibold leading-[1.5]">{promise.title}</strong>
                <p className="text-[14px] leading-[1.7] text-[#4E6A62] sm:text-[16px]">{promise.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-12 grid overflow-hidden bg-[#243832] text-white lg:mt-16 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
          <div className="border-b border-white/12 px-6 py-8 sm:px-9 sm:py-9 lg:border-b-0 lg:border-r lg:px-10 lg:py-10">
            <p className="text-[12px] font-semibold text-[#E2D3C8]">공개 자료에서 확인하는 보조 정보</p>
            <h3 className="mt-3 max-w-md text-[20px] font-semibold leading-[1.4] tracking-[-0.025em] sm:text-[24px]">
              공개 가격과 규정은
              <span className="mt-1 block text-[#E2D3C8]">출처와 범위부터 보여드려요.</span>
            </h3>
            <p className="mt-3 text-[12px] leading-5 text-white/72">
              한국소비자원 {disclosureRoundLabel()} 게시 자료 · {countsVerifiedAt} 화면 집계 확인
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/12 pt-5">
              <div>
                <dt className="text-[12px] font-semibold text-white/64">표시된 업체</dt>
                <dd className="mt-1 text-[24px] font-bold tracking-[-0.025em]">
                  {publishedVendorCount.toLocaleString("ko-KR")}곳
                </dd>
              </div>
              <div>
                <dt className="text-[12px] font-semibold text-white/64">게시된 취소·환불 규정</dt>
                <dd className="mt-1 text-[24px] font-bold tracking-[-0.025em]">
                  {publishedPolicyCount.toLocaleString("ko-KR")}건
                </dd>
              </div>
            </dl>
          </div>

          <div className="px-6 py-8 sm:px-9 sm:py-9 lg:px-10 lg:py-10">
            <p className="max-w-[34rem] text-[14px] leading-[1.7] text-white/82">
              현재는 한국소비자원 {disclosureRoundLabel()} 게시 자료에 포함된 업체만 보여드려요.
              표시 금액은 기본 조건 기준이라 시즌·옵션에 따라 실제 계약가가 달라질 수 있고,
              예약·결제·계약은 업체와 직접 진행해요.
            </p>
            <p className="mt-4 max-w-2xl text-[12px] leading-6 text-white/70">
              이 숫자는 아모라의 사용자 성과나 업체 품질을 뜻하지 않아요. 공개 자료가 화면에 표시된 범위입니다.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <a
                href={DISCLOSURE_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-gold-light underline decoration-gold-light/40 underline-offset-4 focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]"
              >
                자료 출처 · 한국소비자원 참가격
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              <Link
                href="/price"
                className="group inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold text-white transition-colors duration-200 hover:text-[#E2D3C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]"
              >
                업체별 공개 가격·규정 보기
                <ArrowRight className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <p className="max-w-3xl text-[12px] leading-5 text-[#4E6A62]">
            광고는 광고라고 표시하고 일반 추천과 섞지 않아요. AI 답변은 틀리거나 놓칠 수 있으므로 계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를 다시 확인해 주세요.
          </p>
          <Link
            href="#start-conditions"
            className={`shrink-0 gap-2 ${secondaryLink} focus-visible:ring-offset-4 focus-visible:ring-offset-ivory-50`}
          >
            시작 조건·베타 비용 보기
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
