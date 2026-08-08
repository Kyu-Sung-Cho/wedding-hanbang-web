import Image from "next/image";
import {
  CalendarDays,
  Check,
  ListChecks,
  WalletCards,
} from "lucide-react";

import { landingContent, preparationRecords } from "./landingContent";
import { displaySection, sectionEyebrow, sectionLede, sectionRhythm } from "./landingType";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

const recordIcons = {
  budget: WalletCards,
  task: ListChecks,
  schedule: CalendarDays,
} as const;

const destinationLabels = {
  budget: "예산에 반영",
  task: "할 일에 반영",
  schedule: "일정에 반영",
} as const;

const exampleUtterances = {
  budget: "우리 총예산은 3,000만 원으로 정했어.",
  task: "이번 주에 드레스숍 세 곳에 문의하자.",
  schedule: "10월 17일 오후 2시에 드레스 투어야.",
} as const;

export default function PreparationResult() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 bg-[#FBF8F2] text-[#243832]"
      aria-labelledby="landing-outcome-title"
    >
      <div className={`${shell} ${sectionRhythm}`}>
        {/* 세 번째 템플릿: 가운데로 모은다. 이 섹션이 페이지에서 제품의 핵심
            동작("말한 것이 기록이 된다")을 보여주는 자리라, 좌우로 흩지 않고
            한 축에 세워 아래 세 행에 시선을 모은다. */}
        <div className="mx-auto max-w-[46rem] text-center">
          <p className={sectionEyebrow}>{landingContent.outcome.eyebrow}</p>
          <h2
            id="landing-outcome-title"
            className={`mx-auto mt-4 ${displaySection}`}
          >
            {landingContent.outcome.title}
          </h2>
          <p className={`mx-auto mt-6 max-w-[34rem] ${sectionLede} text-[#36534E]/82`}>
            {landingContent.outcome.body}
          </p>
        </div>

        {/* 제품 화면을 섹션 맨 앞에 세운다.
            전에는 텍스트 네 블록 뒤에 삽화처럼 들어가 있었다. 이 페이지가 아홉
            섹션에 걸쳐 "정리된다"고 말하는데 그 화면은 스크롤을 한참 내려야
            나왔다. 읽히는 결과물 하나가 그것을 설명하는 문단들보다 빨리 읽힌다 —
            글로 설득하는 대신 먼저 보여주고, 아래 세 행은 그 화면을 뒷받침한다.
            스톡 사진이 아니라 진짜 제품 화면이다. */}
        <figure className="mt-10 lg:mt-12">
          {/* 데스크톱 화면을 모바일에 그대로 넣으면 348×164로 줄어 글자가 읽히지
              않는다(실측). 증거로 쓰려면 읽혀야 하므로 폭에 맞는 화면을 따로 쓴다.
              lazy + display:none이라 각 뷰포트는 자기 것 하나만 내려받는다. */}
          <div className="overflow-hidden rounded-[20px] border border-[#243832]/14 bg-white shadow-raised">
            <Image
              src="/images/landing-app-budget-mobile.webp"
              alt="예산 화면 — 전체 예산 2,500만원, 기록한 지출, 남은 예산이 카드로 정리된 모습"
              width={780}
              height={1290}
              sizes="100vw"
              priority
              className="h-auto w-full sm:hidden"
            />
            {/* 원본이 1600px이라 그 위로 늘리면 흐려진다. 포스터로 키우되 선명함이
                깨지지 않는 선에서 멈춘다 — 읽히지 않으면 증거가 아니다. */}
            <Image
              src="/images/landing-app-budget.webp"
              alt="예산 화면 — 전체 예산, 기록한 지출, 남은 예산과 두 사람의 분담 현황이 한 화면에 정리된 모습"
              width={1600}
              height={756}
              sizes="(min-width: 1024px) 1080px, 100vw"
              priority
              className="hidden h-auto w-full sm:block"
            />
          </div>
          <figcaption className="mt-3 text-center text-[12px] leading-5 text-[#243832]/72">
            확인한 변경이 쌓이는 예산 화면이에요. 이름·금액은 기능을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요.
          </figcaption>
        </figure>

        <div className="mt-12 border-y border-[#243832]/14 lg:mt-16">
          <div className="flex flex-col gap-3 border-b border-[#243832]/10 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[12px] font-semibold text-[#8F6662]">서로 다른 변경의 목적지</p>
              <h3 className="mt-1 text-[20px] font-semibold">확인한 한 가지가 알맞은 기록으로</h3>
            </div>
            <p className="flex items-center gap-2 text-[12px] font-semibold text-[#36534E]">
              <Check className="h-4 w-4 text-[#8F6662]" aria-hidden="true" />
              제안마다 따로 확인
            </p>
          </div>

          <ul aria-label="각기 다른 대화와 준비 기록 예시">
            {preparationRecords.map((record, index) => {
              const Icon = recordIcons[record.id];
              return (
                <li
                  key={record.id}
                  className="grid gap-4 border-b border-[#243832]/10 py-6 last:border-b-0 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(180px,0.62fr)] sm:items-center sm:gap-6 lg:py-7"
                >
                  <div className="flex items-center gap-3 sm:block">
                    <span className="text-[12px] font-semibold text-[#8F6662]">0{index + 1}</span>
                    <span className="ml-auto flex h-10 w-10 items-center justify-center text-[#8F6662] sm:ml-0 sm:mt-2">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-[#8F6662]">{record.note}</p>
                    <p className="mt-1 text-[16px] font-medium leading-[1.6] text-[#243832]">
                      “{exampleUtterances[record.id]}”
                    </p>
                  </div>
                  <div className="border-l-2 border-sage-500 pl-4 sm:pl-5">
                    <p className="text-[12px] font-semibold text-[#4E6A62]">
                      {destinationLabels[record.id]}
                    </p>
                    <p className="mt-1 text-[16px] font-semibold leading-6 text-[#243832]">{record.value}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="flex items-start gap-2 border-t border-[#243832]/10 py-5 text-[14px] font-medium leading-[1.7] text-[#36534E]">
            <Check className="mt-1 h-4 w-4 shrink-0 text-[#8F6662]" aria-hidden="true" />
            계정 베타 기능 예시예요. 한 번의 확인에는 한 가지 변경만 포함돼요.
          </p>
        </div>

      </div>
    </section>
  );
}
