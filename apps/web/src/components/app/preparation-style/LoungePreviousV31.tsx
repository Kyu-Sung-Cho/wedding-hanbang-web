"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { V31_SAVE_PREFERENCE_KEY } from "@/app/wedding-code/useV31LocalProgress";
import { WeddingCodeComparisonResume } from "@/app/wedding-code/WeddingCodeV31Connection";
import { wc64Secondary } from "@/components/weddingCode64/styles";
import { LOCAL_KEY, hasV31ResumableAnswer, readV31LocalProgress } from "@/lib/weddingCode/v31LocalProgress";
import { weddingLinkProps } from "@/lib/weddingPaths";

/** 라운지에서 이전 판(v3.1)을 여는 주소. 라운지 맨 주소는 64문항을 열므로 판을 쿼리로 고른다. */
export const LOUNGE_V31_PATH = "/preparation-style?v=v3.1-preferences";

type PreviousV31 = "" | "draft" | "result";

/**
 * 이 브라우저에 v3.1 답이 남아 있는지. 자동 저장을 껐거나, 기록이 없거나 만료됐거나, 답 없이 자리만 저장됐으면 없다고 본다.
 * 읽기만 하고 저장 기간을 늘리거나 기록을 지우지 않는다.
 */
function readPreviousV31(): PreviousV31 {
  try {
    const storage = window.localStorage;
    if (storage.getItem(V31_SAVE_PREFERENCE_KEY) === "off") return "";
    const read = readV31LocalProgress(storage);
    if (read.status !== "ready" || !hasV31ResumableAnswer(read.snapshot)) return "";
    return read.snapshot.screen === "result" ? "result" : "draft";
  } catch { return ""; }
}

function subscribe(onChange: () => void) {
  const receive = (event: StorageEvent) => {
    if (event.key === null || event.key === LOCAL_KEY || event.key === V31_SAVE_PREFERENCE_KEY) onChange();
  };
  window.addEventListener("storage", receive);
  return () => window.removeEventListener("storage", receive);
}

const serverSnapshot = (): PreviousV31 => "";

/**
 * 라운지 wc64 시작 화면에 붙는 이전 판 길. v3.1 을 하던 사람이 답을 잃지 않고 돌아가게 한다.
 * 함께 보기 기록이 있으면 기존 안내(WeddingCodeComparisonResume)를 그대로 쓴다. 둘 다 없으면 아무것도 그리지 않는다.
 */
export default function LoungePreviousV31() {
  const previous = useSyncExternalStore(subscribe, readPreviousV31, serverSnapshot);
  return <>
    {previous ? (
      <Link {...weddingLinkProps(LOUNGE_V31_PATH)} className={`${wc64Secondary} w-full no-underline`}
        data-lounge-previous-v31={previous}>
        {previous === "result" ? "이전 웨딩코드 결과 다시 보기" : "이전 웨딩코드 이어 하기"}
      </Link>
    ) : null}
    <WeddingCodeComparisonResume compact />
  </>;
}
