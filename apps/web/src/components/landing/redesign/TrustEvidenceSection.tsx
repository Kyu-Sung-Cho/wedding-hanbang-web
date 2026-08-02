import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import {
  DISCLOSURE_SOURCE_URL,
  disclosureRoundLabel,
} from "@/lib/price/period";

import { landingContent, trustPromises } from "./landingContent";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

type TrustEvidenceSectionProps = {
  publishedPolicyCount: number;
  publishedVendorCount: number;
};

export default function TrustEvidenceSection({
  publishedPolicyCount,
  publishedVendorCount,
}: TrustEvidenceSectionProps) {
  return (
    <section
      id="trust"
      className="scroll-mt-20 bg-[#FBF8F2] text-[#243832]"
      aria-labelledby="landing-trust-title"
    >
      <div className={`${shell} py-20 sm:py-24 lg:py-32`}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-20">
          <div>
            <p className="text-[13px] font-semibold text-[#8F6662]">
              {landingContent.trust.eyebrow}
            </p>
            <h2
              id="landing-trust-title"
              className="mt-4 max-w-xl text-[clamp(2.4rem,7vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.05em]"
            >
              결정은 둘이.
              <span className="mt-2 block text-[#8F6662]">아모라는 정리.</span>
            </h2>
            <p className="mt-6 max-w-lg text-[15px] leading-7 text-[#36534E]/80 sm:text-[16px]">
              {landingContent.trust.body}
            </p>
          </div>

          <ol className="border-y border-[#243832]/16">
            {trustPromises.map((promise) => (
              <li
                key={promise.number}
                className="grid gap-3 border-b border-[#243832]/10 py-6 last:border-b-0 sm:grid-cols-[3rem_minmax(0,0.82fr)_minmax(0,1.18fr)] sm:items-start sm:gap-6 sm:py-7"
              >
                <span className="text-[12px] font-semibold text-[#8F6662]">{promise.number}</span>
                <strong className="text-[17px] font-semibold leading-6">{promise.title}</strong>
                <p className="text-[14px] leading-7 text-[#4E6A62] sm:text-[15px]">{promise.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-14 grid overflow-hidden bg-[#243832] text-white lg:mt-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="border-b border-white/14 px-6 py-8 sm:px-10 sm:py-10 lg:border-b-0 lg:border-r lg:px-12 lg:py-12">
            <p className="text-[12px] font-semibold text-[#E2D3C8]">공개 자료에서 확인하는 보조 정보</p>
            <p className="mt-3 text-[12px] leading-5 text-white/78">
              한국소비자원 {disclosureRoundLabel()} 게시 자료 · 현재 화면 집계
            </p>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.035em] sm:text-[34px]">
              업체 {publishedVendorCount.toLocaleString("ko-KR")}곳 표시
            </p>
            <p className="mt-1 text-[17px] font-semibold text-white/82 sm:text-[19px]">
              게시된 취소·환불 규정 {publishedPolicyCount.toLocaleString("ko-KR")}건
            </p>
          </div>

          <div className="px-6 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
            <p className="max-w-2xl text-[13px] leading-6 text-white/82">
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
                className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:text-[#E2D3C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]"
              >
                자료 출처 · 한국소비자원 참가격
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              <Link
                href="/price"
                className="group inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold text-white transition-colors hover:text-[#E2D3C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]"
              >
                업체별 공개 가격·규정 보기
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-5 text-[12px] leading-5 text-[#4E6A62]">
          광고는 광고라고 표시하고 일반 추천과 섞지 않아요. AI 답변은 틀리거나 놓칠 수 있으므로 계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를 다시 확인해 주세요.
        </p>
      </div>
    </section>
  );
}
