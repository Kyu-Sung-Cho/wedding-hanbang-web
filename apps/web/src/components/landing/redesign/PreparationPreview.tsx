"use client";

import { CalendarCheck } from "lucide-react";

import type { PreparationPriority } from "@/lib/marketing/preparationPriorities";

/**
 * 히어로에서 날짜를 넣는 즉시 보여주는 "내 준비 3가지".
 *
 * 왜 랜딩에서 결과까지 보여주나: 이 페이지는 아홉 섹션에 걸쳐 제품을 **설명**만
 * 하고 사용자가 아무것도 해보지 못한 채 CTA를 만났다. "날짜를 넣으면 준비 3가지가
 * 나와요"라고 약속하면서, 정작 그 결과는 다른 페이지로 넘어가야 볼 수 있었다.
 * 계산은 브라우저에서 즉시 되므로(`computePreparationPriorities`) 약속을 그 자리에서
 * 증거로 바꾼다 — 랜딩이 제품을 설명하는 대신 제품이 된다.
 *
 * 정직성: 이건 진짜 계산 결과이고 샘플이 아니다. 다만 `ddayStart`·`ddayDeadline`은
 * **화면 정렬용 기본 확인 시점**이지 실제 계약 마감이 아니므로(상수 정의의 주석)
 * 화면에서 그렇게 말한다. 날짜는 서버로 나가지 않는다.
 */

interface PreparationPreviewProps {
  priorities: PreparationPriority[];
  /** 아직 확인 시작점을 지난 항목이 없을 때 문구를 바꾼다. */
  anyStarted: boolean;
}

export default function PreparationPreview({ priorities, anyStarted }: PreparationPreviewProps) {
  return (
    <section
      aria-labelledby="landing-preparation-preview-title"
      className="relative z-10 min-w-0 overflow-hidden rounded-[28px] border border-white/18 bg-[#FBF8F2] text-[#243832] shadow-overlay"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243832]/10 bg-white/84 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#36534E] text-white">
            <CalendarCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="landing-preparation-preview-title"
              className="text-[14px] font-semibold leading-5"
            >
              지금 알아볼 준비 3가지
            </h2>
            <p className="mt-0.5 text-[12px] font-medium text-[#4E6A62]">
              {anyStarted
                ? "넣은 날짜 기준으로 골랐어요"
                : "아직 여유가 있어요. 곧 볼 순서예요"}
            </p>
          </div>
        </div>
        <span className="inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full border border-[#8F6662]/20 bg-white px-3 text-[12px] font-semibold text-rose-700">
          로그인 없이
        </span>
      </div>

      <ol className="divide-y divide-[#243832]/10">
        {priorities.map((item, index) => (
          <li key={item.key} className="px-4 py-4 sm:px-5">
            <div className="flex items-baseline gap-3">
              <span className="text-[12px] font-bold text-rose-700">0{index + 1}</span>
              <h3 className="min-w-0 text-[16px] font-semibold leading-[1.4]">{item.label}</h3>
            </div>
            {item.firstSteps.length > 0 ? (
              <ul className="mt-2 space-y-1 pl-[27px]">
                {item.firstSteps.map((step) => (
                  <li
                    key={step}
                    className="text-[14px] font-medium leading-[1.55] text-[#36534E] before:mr-2 before:text-[#8F6662] before:content-['·']"
                  >
                    {step}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>

      {/* 상수 정의가 "화면 정렬용 기본 확인 시점이며 실제 마감일이 아니다"라고
          못박아 두었다. 이 순서를 계약 마감처럼 읽으면 틀린 판단을 하게 된다. */}
      <p className="border-t border-[#243832]/10 px-4 py-3 text-[12px] leading-5 text-[#243832]/72 sm:px-5">
        빠뜨리기 쉬운 항목을 살펴보는 참고 순서예요. 실제 계약서와 업체·가족과 정한 날짜가 우선이에요.
      </p>
    </section>
  );
}
