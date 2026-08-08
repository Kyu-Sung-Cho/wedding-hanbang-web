import { BadgeCheck } from "lucide-react";

import { landingContent } from "./landingContent";
import {
  displayMuted,
  eyebrowGlyph,
  sectionEyebrow,
  sectionLedeCompact,
  sectionRhythmCompact,
} from "./landingType";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

/**
 * 네 개를 "공개할 때 구분할 출처"로 나란히 보여주고 있었다. 커뮤니티가 아직 안
 * 열렸다는 전제에서는 정직한 화면이었는데, 그 전제가 거짓이 됐다 — 커뮤니티는
 * 이미 열려 있고 로그인 없이 읽힌다.
 *
 * 그래서 넷을 있는 것과 없는 것으로 가른다. 코드에서 확인한 결과:
 *   광고·협찬  → `AdDisclosureBadge` (있음)
 *   AI 답변    → `AiCommentBox` (있음)
 *   작성자 종류 → 없음. `UserRole`은 "bride" | "groom"으로 아바타 캐릭터를 고른다.
 *
 * 없는 것을 지워 버리지 않고 "아직"으로 남긴다 — 약속을 조용히 없애는 것도
 * 하지 않은 걸 한다고 말하는 것만큼 나쁘다.
 */
const sourceLabelsInPlace = [
  "광고·협찬 · 별도 표시",
  "AI 답변 · AI 생성 표시",
] as const;

const sourceLabelsPending = [
  "일반 회원 · 업계 종사자 구분",
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
              <BadgeCheck className={eyebrowGlyph} aria-hidden="true" />
              커뮤니티 · 로그인 없이 읽기
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

          <div role="group" aria-label="커뮤니티 출처 표시 기준">
            <p className="text-[12px] font-semibold text-[#8F6662]">지금 구분해서 보여주는 것</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2" aria-label="지금 구분하는 콘텐츠 출처">
              {sourceLabelsInPlace.map((label) => (
                <li
                  key={label}
                  className="border-t border-[#243832]/10 pt-2 text-[12px] font-semibold leading-5 text-[#4E6A62]"
                >
                  {label}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] font-semibold text-[#8F6662]">아직 구분하지 않는 것</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2" aria-label="아직 구분하지 않는 콘텐츠 출처">
              {sourceLabelsPending.map((label) => (
                <li
                  key={label}
                  // 투명도로 낮췄더니 12px에서 3.68:1로 미달했다(실측). 이 저장소
                  // 규칙대로 색을 흐리는 대신 웨이트로 낮춘다 — 옆 목록과 같은
                  // #4E6A62(5.90:1)를 쓰고 font-medium으로만 구분한다.
                  className="border-t border-[#243832]/10 pt-2 text-[12px] font-medium leading-5 text-[#4E6A62]"
                >
                  {label}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] leading-5 text-[#4E6A62]">
              사람의 경험과 AI의 제안을 같은 근거처럼 보여주지 않아요.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
