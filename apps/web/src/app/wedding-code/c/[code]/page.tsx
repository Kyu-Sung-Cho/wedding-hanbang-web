import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  parseWeddingCodeString,
  WEDDING_CODE_LETTERS,
} from "@/lib/weddingCode/profile/letters";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  weddingCodeSceneCountLabel,
} from "@/lib/weddingCode/scene/config";
import { WeddingCodePoleChip } from "../../WeddingCodeBadge";

/**
 * 코드 한 개만 아는 사람을 위한 화면.
 *
 * MBTI는 「나 INFP야」만 알아도 그게 무슨 뜻인지 찾아볼 수 있다. 그게 코드가 퍼지는
 * 방식이다. 웨딩코드도 스무 문항을 다시 풀지 않고 글자만으로 뜻을 볼 수 있어야 한다.
 *
 * ## 왜 이 경로는 색인해도 되나
 *
 * `/wedding-code`의 답 링크에는 **누군가의 실제 응답**이 들어 있어서 색인하지 않는다.
 * 반면 이 경로에는 네 글자밖에 없다 — 누가 어떤 장면에서 무엇을 골랐는지는 코드에
 * 들어 있지 않다. 그래서 공유해도 되고, 검색으로 찾아와도 남의 답이 노출되지 않는다.
 *
 * ## 무엇을 말하지 않나
 *
 * 「VTUH인 사람은 이렇다」는 성격 설명을 쓰지 않는다. 글자가 뜻하는 것은 **그 사람이
 * 어느 쪽 답을 더 많이 골랐는가**뿐이고, 그건 본인의 응답에서만 나온다. 여기서는 글자의
 * 뜻과 반대쪽 글자를 알려주고, 자기 코드는 직접 답해서 받게 한다.
 */

const SCENE_COUNT = weddingCodeSceneCountLabel(
  CURRENT_WEDDING_CODE_SCENE_CONFIG.questions.length,
);

function normalized(raw: string): string | null {
  const value = decodeURIComponent(raw ?? "").trim();
  return parseWeddingCodeString(value) ? value : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const value = normalized(code);
  if (!value) {
    return { title: "웨딩코드 | 웨딩한방", robots: { index: false, follow: false } };
  }
  const upper = value.toUpperCase();
  return {
    title: `웨딩코드 ${upper} 네 글자 뜻 | 웨딩한방`,
    description:
      `웨딩코드 ${upper}, 네 글자가 각각 무슨 뜻인지 알려드려요.`
      + ` 결혼 준비 ${SCENE_COUNT} 장면에서 어느 쪽 답을 더 많이 골랐는지 네 글자로 줄인 코드예요.`
      + " 성격을 맞히거나 궁합을 보는 건 아니에요.",
    alternates: { canonical: `/wedding-code/c/${upper}` },
  };
}

export default async function WeddingCodeMeaningPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const value = normalized(code);
  // 없는 코드를 그럴듯하게 풀어주면 없는 뜻을 지어내는 것이 된다.
  if (!value) notFound();

  const letters = parseWeddingCodeString(value)!;
  const upper = value.toUpperCase();
  const surface = "rounded-[6px] border border-[var(--hb-hairline)] bg-white";

  return (
    <main className="min-h-dvh bg-[var(--hb-surface-page)] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <section className={`${surface} overflow-hidden`} data-code-meaning={upper}>
          <div className="bg-[var(--hb-primary)] px-5 py-8 text-center text-white sm:px-8">
            <p className="text-[12px] font-semibold text-[var(--hb-on-primary)]">웨딩코드</p>
            <h1 className="mt-3 text-[44px] font-semibold leading-none tracking-[0.04em] sm:text-[56px]">
              {upper}
            </h1>
            <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[var(--hb-on-primary)]">
              결혼 준비 {SCENE_COUNT} 장면에서 어느 쪽 답을 더 많이 골랐는지 네 글자로 줄인
              거예요. 성격을 맞히거나 궁합을 보는 코드는 아니에요.
            </p>
          </div>

          <div className="divide-y divide-[var(--hb-hairline)]">
            {letters.map((letter) => {
              // 결과 화면 범례와 같은 방향(왼쪽 글자 먼저)으로 양쪽 끝을 그린다.
              // 코드에는 답의 수가 없으므로 칸 막대 대신 선 하나로 두 끝을 잇는다.
              const own = { letter: letter.letter, short: letter.short };
              const other = { letter: letter.opposite, short: letter.oppositeShort };
              const [left, right] = letter.side === "left" ? [own, other] : [other, own];
              return (
                <div key={letter.axis} data-meaning-axis={letter.axis} className="px-5 py-5 sm:px-8">
                  <p className="text-[12px] font-semibold text-[var(--hb-success)]">{letter.axisLabel}</p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <WeddingCodePoleChip side="left" pole={left} chosen={letter.side === "left"} />
                    <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-[var(--hb-hairline)]" />
                    <WeddingCodePoleChip side="right" pole={right} chosen={letter.side === "right"} />
                  </div>
                  <p className="mt-3 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                    <span className="sr-only">{letter.letter}({letter.short}): </span>
                    {letter.meaning}
                  </p>
                  <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                    반대쪽 글자{" "}
                    <b className="font-semibold text-[var(--hb-text-strong)]">
                      {letter.opposite}({letter.oppositeShort})
                    </b>
                    : {letter.oppositeMeaning}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-5 sm:px-8">
            <p className="text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
              같은 글자라도 <b className="font-semibold text-[var(--hb-text-strong)]">어느 장면에서 그렇게
              골랐는지는 사람마다 달라요.</b> 그건 코드에 들어 있지 않아서, 직접 답해야 볼 수
              있어요.
            </p>
          </div>
        </section>

        <Link
          href="/wedding-code"
          className="mt-5 flex min-h-[48px] w-full items-center justify-center rounded-[6px] bg-[var(--hb-primary)] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--hb-primary)]"
        >
          내 웨딩코드 받아보기
        </Link>
        <p className="mt-3 text-center text-[13px] font-medium text-[var(--color-rose-700)]">
          {SCENE_COUNT} 문항 · 로그인 없이
        </p>
      </div>
    </main>
  );
}

export const dynamicParams = true;

/** 열여섯 조합을 미리 만들어 둔다 — 코드로 검색해 들어오는 경로가 이 제품의 입구다. */
export function generateStaticParams(): { code: string }[] {
  const [a, b, c, d] = [
    WEDDING_CODE_LETTERS.decisionCriteria,
    WEDDING_CODE_LETTERS.preparationMode,
    WEDDING_CODE_LETTERS.coordinationScope,
    WEDDING_CODE_LETTERS.supportOrder,
  ];
  const codes: { code: string }[] = [];
  for (const first of [a.left.letter, a.right.letter]) {
    for (const second of [b.left.letter, b.right.letter]) {
      for (const third of [c.left.letter, c.right.letter]) {
        for (const fourth of [d.left.letter, d.right.letter]) {
          codes.push({ code: `${first}${second}${third}${fourth}` });
        }
      }
    }
  }
  return codes;
}
