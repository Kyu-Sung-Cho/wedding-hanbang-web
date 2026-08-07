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

/**
 * 날짜가 실제로 가르는 유일한 것. 항목 셋은 어떤 날짜에도 같으므로, 슬라이더를
 * 끄는 동안 움직이는 것은 여기다 — 시작할 때가 됐는지와 남은 날 수.
 * 두 값 모두 상수의 기본 확인 시점에서 뺀 것이라 계약 마감이 아니다(아래 각주).
 */
function timingLabel(item: PreparationPriority): string {
  if (!item.started) return `${item.daysUntilStart}일 뒤부터`;
  if (item.daysUntilDeadline < 0) return `${Math.abs(item.daysUntilDeadline)}일 지남`;
  return `${item.daysUntilDeadline}일 남음`;
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
              {/* 항목 순서는 날짜와 무관하게 고정이다(정렬이 모든 항목에서 같은
                  D-day를 빼므로 상대 순서가 바뀌지 않는다). 날짜가 실제로 가르는 것은
                  "지금 시작할 때가 됐는지"뿐이라 그것만 말한다. */}
              {anyStarted
                ? "지금 시작해도 되는 시점이에요"
                : "아직 여유가 있어요. 먼저 살펴볼 순서예요"}
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
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[12px] font-bold text-rose-700">0{index + 1}</span>
              <h3 className="min-w-0 text-[16px] font-semibold leading-[1.4]">{item.label}</h3>
              <span
                className={`ml-auto inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] font-bold ${
                  item.started
                    ? "bg-[#8F6662]/12 text-rose-700"
                    : "bg-[#36534E]/10 text-[#36534E]"
                }`}
              >
                {timingLabel(item)}
              </span>
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
