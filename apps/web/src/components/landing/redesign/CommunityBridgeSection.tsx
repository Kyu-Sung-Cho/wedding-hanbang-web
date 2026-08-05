import { BadgeCheck } from "lucide-react";

import { landingContent } from "./landingContent";
import { displayMuted, sectionEyebrow, sectionLedeCompact, sectionRhythmCompact } from "./landingType";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

const sourceLabels = [
  "일반 회원 · 경험 미인증",
  "업계 종사자 · 이해관계 확인",
  "광고·협찬 · 별도 표시",
  "AI 답변 · AI 생성 표시",
] as const;

export default function CommunityBridgeSection() {
  return (
    <section
      id="community-bridge"
      className="scroll-mt-20 border-y border-[#243832]/10 bg-white text-[#243832]"
      aria-labelledby="landing-community-title"
    >
      <div className={`${shell} ${sectionRhythmCompact}`}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(440px,0.92fr)] lg:items-center lg:gap-14">
          <div className="max-w-[660px]">
            <p className={`flex items-center gap-2 ${sectionEyebrow}`}>
              <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              운영 공개 전 · 출처 기준 검증 중
            </p>
            <h2
              id="landing-community-title"
              className={`mt-3 ${displayMuted}`}
            >
              {landingContent.community.titleLead}{" "}
              <span className="text-[#8F6662]">{landingContent.community.titleAccent}</span>
            </h2>
            <p className={`mt-3 max-w-[34rem] ${sectionLedeCompact} text-[#4E6A62]`}>
              {landingContent.community.body}
            </p>
          </div>

          <div role="group" aria-label="커뮤니티 공개 전 신뢰 기준">
            <p className="text-[12px] font-semibold text-[#8F6662]">공개할 때 구분할 출처</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2" aria-label="표시할 콘텐츠 출처">
              {sourceLabels.map((label) => (
                <li
                  key={label}
                  className="border-t border-[#243832]/10 pt-2 text-[12px] font-semibold leading-5 text-[#4E6A62]"
                >
                  {label}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-5 text-[#4E6A62]">
              사람의 경험과 AI의 제안을 같은 근거처럼 보여주지 않아요.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
