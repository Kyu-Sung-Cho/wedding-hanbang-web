import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { WeddingCodeV06AxisKey } from "@/constants/weddingCodeV06";

import {
  parseWeddingCodeString,
  WEDDING_CODE_LETTERS,
} from "@/lib/weddingCode/profile/letters";
import { WeddingCodePoleChip } from "../../WeddingCodeBadge";

/**
 * 이전 판(장면 문항 v0.6~v1.2) 웨딩코드 네 글자만 아는 사람을 위한 화면.
 *
 * 이 경로가 읽는 글자표(`WEDDING_CODE_LETTERS`: V/M·T/O·U/F·H/A)는 장면 문항 판의 것이다.
 * 지금 판(v3.1)은 질문도 글자 체계도 다르다(K/R·T/D·F/C·L/A와 B·M·N·?). 그래서
 *
 * - 화면 맨 위에 **이전 판 웨딩코드**라고 적는다. `MTFA` 처럼 지금 판에서도 나올 수 있는
 *   네 글자가 있어서(M=중간 답, T, F, A), 판을 밝히지 않으면 지금 결과를 옛 뜻으로 읽힌다.
 * - 지금 판으로 가는 안내는 "글자 체계가 달라요"까지만 말한다. 지금 판 문항 수처럼
 *   이 파일이 재지 않는 숫자는 적지 않는다(예전에는 옛 판의 「스무 장면」을 지금 검사처럼 적었다).
 * - 검색 색인은 막는다. 지금 판을 설명하지 않는 화면이 검색으로 입구 노릇을 하면 안 된다.
 * - 지금 판 결과 화면은 이 경로로 링크하지 않는다(`weddingCodeEntryPoints.test.ts`).
 *   지금 판 코드는 여기서 404다. 새 경로는 만들지 않았다.
 *
 * ## 무엇을 말하지 않나
 *
 * 문항 판과 실제 답이 없으므로 특정 문항에서 무엇을 골랐다고 설명하지 않는다.
 * 글자가 다루는 공통 주제와 반대쪽 글자만 안내한다. 정확한 풀이는 응답 결과의 몫이다.
 */

type LookupSide = Readonly<{ short: string; meaning: string }>;

// 판을 알 수 없는 코드 조회에서만 쓴다. 실제 응답 결과와 구판 범례는 바꾸지 않는다.
const CODE_LOOKUP_TOPICS: Readonly<Record<WeddingCodeV06AxisKey, Readonly<{
  label: string;
  left: LookupSide;
  right: LookupSide;
  note?: string;
}>>> = {
  decisionCriteria: {
    label: "정할 때 살피는 것",
    left: { short: "비용·조건", meaning: "가격과 계약 조건, 제공되는 서비스를 살피는 쪽을 뜻해요." },
    right: { short: "분위기·경험", meaning: "사진과 공간의 분위기, 준비하며 느낀 점이나 남기고 싶은 경험을 살피는 쪽을 뜻해요." },
  },
  preparationMode: {
    label: "준비와 선택을 나누는 방식",
    left: { short: "함께 살피기", meaning: "준비하거나 선택할 때 둘이 함께하는 쪽을 뜻해요." },
    right: { short: "맡아서 하기", meaning: "준비할 일이나 선택을 누군가 맡는 쪽을 뜻해요." },
  },
  coordinationScope: {
    label: "둘의 선택과 가족 참여",
    left: { short: "둘의 선택", meaning: "둘의 기준과 선택을 중심에 두는 쪽을 뜻해요." },
    right: { short: "가족 참여", meaning: "가족의 의견을 듣거나 선택에 참여하도록 하는 쪽을 뜻해요." },
    note: "문항에 따라 가족 의견을 언제 들을지, 마지막 선택을 누구와 할지를 물어요.",
  },
  supportOrder: {
    label: "힘들 때 나누는 도움",
    left: { short: "마음", meaning: "힘들 때 마음을 나누거나 들어주는 쪽을 뜻해요." },
    right: { short: "할 일", meaning: "힘들 때 할 일이나 결정을 정리하는 쪽을 뜻해요." },
  },
};

function normalized(raw: string): string | null {
  // 깨진 퍼센트 부호(%25, %FF)는 decodeURIComponent 가 URIError 를 던진다. 던지게 두면 서버 오류(500)가 되므로, 읽을 수 없는 주소는 없는 코드와 같이 null 로 답한다(찾을 수 없음 화면).
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw ?? "");
  } catch {
    return null;
  }
  const value = decoded.trim();
  return parseWeddingCodeString(value) ? value : null;
}

/**
 * 공유 카드도 여기서 정한다. 정하지 않으면 루트 layout 의 카드(아모라 문구, `og:url=/landing`)를
 * 물려받는다. 부모 폴더의 웨딩코드 카드 이미지는 지금 판을 소개하므로 이전 판 화면에는 붙이지
 * 않는다(openGraph 를 여기서 정하면 부모 이미지는 따라오지 않는다).
 */
function lookupMetadata(title: string, description: string, robots: Metadata["robots"]): Metadata {
  return {
    title,
    description,
    robots,
    openGraph: { title, description, siteName: "웨딩한방", locale: "ko_KR", type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const value = normalized(code);
  if (!value) {
    return lookupMetadata(
      "웨딩코드 | 웨딩한방",
      "이 주소로는 웨딩코드 글자 뜻을 찾을 수 없어요.",
      { index: false, follow: false },
    );
  }
  const upper = value.toUpperCase();
  return lookupMetadata(
    `이전 판 웨딩코드 ${upper} 글자 뜻 | 웨딩한방`,
    `이전 판 웨딩코드 ${upper}의 네 글자가 다루던 주제를 알려드려요.`
      + " 코드만으로는 어떤 문항에 답했는지 알 수 없어요. 정확한 풀이와 고른 답은 함께 받은 결과 링크에서 확인해 주세요."
      + " 지금 웨딩코드는 질문도, 네 글자를 정하는 방식도 달라요.",
    // 지금 판을 설명하지 않는 화면이라 검색에 싣지 않는다. 안에 있는 지금 판 링크는 따라가도 된다.
    { index: false, follow: true },
  );
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
            <p data-code-edition="previous" className="text-[12px] font-semibold text-[var(--hb-on-primary)]">이전 판 웨딩코드</p>
            <h1 className="mt-3 text-[44px] font-semibold leading-none tracking-[0.04em] sm:text-[56px]">
              {upper}
            </h1>
            <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[var(--hb-on-primary)]">
              이 네 글자가 이전 판에서 다루던 주제를 알려드려요.
              성격을 맞히거나 궁합을 보는 코드는 아니에요.
            </p>
            <p data-code-version-note="" className="mt-3 text-[13px] font-medium leading-[1.7] text-[var(--hb-on-primary)]">
              코드만으로는 어떤 문항에 답했는지 알 수 없어요.
              정확한 풀이와 고른 답은 함께 받은 결과 링크에서 확인해 주세요.
            </p>
          </div>

          <div className="divide-y divide-[var(--hb-hairline)]">
            {letters.map((letter) => {
              const topic = CODE_LOOKUP_TOPICS[letter.axis];
              const selected = topic[letter.side];
              const opposite = topic[letter.side === "left" ? "right" : "left"];
              // 실제 답 수는 없으므로 공통 주제와 글자 방향만 표시한다.
              const own = { letter: letter.letter, short: selected.short };
              const other = { letter: letter.opposite, short: opposite.short };
              const [left, right] = letter.side === "left" ? [own, other] : [other, own];
              return (
                <div key={letter.axis} data-meaning-axis={letter.axis} className="px-5 py-5 sm:px-8">
                  <p className="text-[12px] font-semibold text-[var(--hb-success)]">{topic.label}</p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <WeddingCodePoleChip side="left" pole={left} chosen={letter.side === "left"} />
                    <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-[var(--hb-hairline)]" />
                    <WeddingCodePoleChip side="right" pole={right} chosen={letter.side === "right"} />
                  </div>
                  <p className="mt-3 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                    <span className="sr-only">{letter.letter}({selected.short}): </span>
                    {selected.meaning}
                  </p>
                  <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                    반대쪽 글자{" "}
                    <b className="font-semibold text-[var(--hb-text-strong)]">
                      {letter.opposite}({opposite.short})
                    </b>
                    : {opposite.meaning}
                  </p>
                  {topic.note ? <p className="mt-3 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">{topic.note}</p> : null}
                </div>
              );
            })}
          </div>

          <div className="border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-5 sm:px-8">
            <p className="text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
              같은 글자라도 <b className="font-semibold text-[var(--hb-text-strong)]">어느 장면에서 그렇게
              골랐는지는 사람마다 달라요.</b> 서로의 결과 링크에서 실제로 고른 답도 함께 봐 주세요.
            </p>
          </div>
        </section>

        <section data-current-edition-note="" className={`${surface} mt-5 px-5 py-5 sm:px-8`}>
          <h2 className="text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
            지금 웨딩코드는 글자 풀이가 달라요
          </h2>
          <p className="mt-2 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
            질문도, 네 글자를 정하는 방식도 바뀌었어요.
            지금 웨딩코드에서 받은 네 글자라면 여기 풀이와 맞지 않아요.
            받은 결과 화면에 글자마다 뜻이 함께 나와요.
          </p>
        </section>

        <Link
          href="/wedding-code"
          className="mt-5 flex min-h-[48px] w-full items-center justify-center rounded-[6px] bg-[var(--hb-primary)] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--hb-primary)]"
        >
          지금 웨딩코드 해보기
        </Link>
        <p className="mt-3 text-center text-[13px] font-medium text-[var(--color-rose-700)]">
          로그인 없이 시작할 수 있어요
        </p>
      </div>
    </main>
  );
}

/**
 * 이전 판 열여섯 조합. 예전에 받은 링크는 계속 열리되, 검색 색인은 metadata 가 막는다.
 *
 * Next 의 `generateStaticParams` 로 내보내지 않는다(일부러). 그 이름으로 내보내면 빌드가 열여섯 조합을 미리 만들면서 이 경로가 prerender manifest 에 오르고,
 * 요청이 올 때마다 Next 가 요청 경로를 한 번 더 풀어 목록과 맞춰 본다. 그때 `/wedding-code/c/%25` 처럼 풀면 깨지는 퍼센트 부호가 서버 오류(500)를 낸다
 * (Next 의 PrerenderManifestMatcher 안에서 던져서 이 파일의 코드는 아직 실행되기 전이다. 감사 A27, A49). 목록에 오른 경로만 그렇다.
 * 요청마다 그려도 열여섯 장이 전부라 부담이 없다. 깨진 주소는 이 파일의 normalized 가 없는 코드와 같이 notFound 로 보낸다.
 * 시험(page.test.tsx)이 이 파일이 generateStaticParams 를 내보내지 않는 것을 고정한다.
 */
export function previousEditionCodes(): { code: string }[] {
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
