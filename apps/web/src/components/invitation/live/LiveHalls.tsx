"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  COMPARE_COPY,
  COMPARE_STATE_COPY,
  EXAMPLE_COMPARE,
  type CompareModel,
  type CompareSortId,
} from "@hanbang/shared/invitation";

import Button from "@/components/ui/Button";

import InvitationCompare from "../InvitationCompare";
import { DemoExampleNote, LiveColumn, LiveLoadingScreen, LiveNotice } from "./LiveParts";
import { liveConditionsHref, livePhotoSrc, liveRoute } from "./liveRoutes";
import { HALLS_LOAD_FAILED, LIVE_RETRY_LABEL } from "./liveStateCopy";
import { useInvitationHalls } from "./useInvitationHalls";
import { useLiveIdentity } from "./useLiveIdentity";

/** 비교할 홀이 없을 때 쓰는 빈 모델. 화면은 이 모델 대신 빈 상태(`empty`)를 그린다. */
const NO_COMPARE: CompareModel = { guests: 0, month: null, halls: [], sourceDateLabel: null };

/**
 * 비교 화면의 빈 상태. 아모라의 첫 문장 자리(17px 글줄)에 상태 문구를 둔다.
 * 운영에는 아직 확인한 홀이 없어서 이 화면이 지금 실제로 보이는 비교 화면이다.
 */
function CompareEmpty({
  text,
  sub,
  action,
  tone = "status",
}: {
  text: string;
  sub?: string;
  action?: ReactNode;
  tone?: "status" | "error";
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-[22px] pt-2.5 pb-[18px]" data-compare-empty>
      <p role={tone === "error" ? "alert" : undefined} className="text-[17px] leading-[1.65]">
        {text}
      </p>
      {sub ? <p className="text-[13px] leading-[1.6] text-inv-muted">{sub}</p> : null}
      {action}
    </div>
  );
}

/** 체험 모드: 예시 커플의 비교. 하트와 정렬은 이 화면 안에서만 바뀐다. */
function DemoHalls() {
  const [picked, setPicked] = useState<Readonly<Record<string, boolean>>>(() =>
    Object.fromEntries(EXAMPLE_COMPARE.halls.map((hall) => [hall.id, hall.picked])),
  );
  const [sort, setSort] = useState<CompareSortId>(COMPARE_COPY.sorts[0].id);
  const model = useMemo<CompareModel>(
    () => ({ ...EXAMPLE_COMPARE, halls: EXAMPLE_COMPARE.halls.map((hall) => ({ ...hall, picked: picked[hall.id] ?? false })) }),
    [picked],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DemoExampleNote />
      <LiveColumn>
        <InvitationCompare
          model={model}
          sort={sort}
          onSort={setSort}
          onToggleHall={(id) => setPicked((current) => ({ ...current, [id]: !current[id] }))}
          resolveRoute={liveRoute}
          photoSrc={livePhotoSrc}
        />
      </LiveColumn>
    </div>
  );
}

/**
 * 웨딩홀 비교(`/halls`) 실제 커플 화면(`Compare.dc`). 정렬 칩은 서버에 그 기준으로 다시 묻고(`?sort=`),
 * 하트는 담기·빼기를 바로 저장한다. 조건이 모자라거나 확인한 홀이 없으면 상태 문구(`COMPARE_STATE_COPY`)를 그린다.
 */
export default function LiveHalls() {
  const identity = useLiveIdentity();
  const [sort, setSort] = useState<CompareSortId>(COMPARE_COPY.sorts[0].id);
  const halls = useInvitationHalls(identity, sort);

  if (identity.isDemo) return <DemoHalls />;
  if (!halls.data && halls.loading) return <LiveLoadingScreen back={{ href: liveRoute("home"), label: COMPARE_COPY.back }} />;

  const data = halls.data;
  const compare = data?.compare ?? null;
  let empty: ReactNode = null;
  if (!data) {
    empty = (
      <CompareEmpty
        tone="error"
        text={HALLS_LOAD_FAILED}
        action={
          <Button variant="outline" size="pill-46" className="px-[22px]" onClick={halls.reload}>
            {LIVE_RETRY_LABEL}
          </Button>
        }
      />
    );
  } else if (!compare) {
    empty = (
      <CompareEmpty
        text={COMPARE_STATE_COPY.needConditions}
        action={
          // 첫 대화를 다시 연다(첫 대화를 건너뛰었어도). 홈으로만 보내면 건너뛴 사람은 다시 홈을 본다.
          <Button href={liveConditionsHref()} variant="ink" size="pill-46" weight="bold" className="px-[22px]">
            {COMPARE_STATE_COPY.needConditionsAction}
          </Button>
        }
      />
    );
  } else if (compare.halls.length === 0) {
    empty = <CompareEmpty text={COMPARE_STATE_COPY.noHalls} sub={COMPARE_STATE_COPY.noHallsSub} />;
  }

  const pickedCount = compare?.halls.filter((hall) => hall.picked).length ?? 0;
  const notice = halls.shortlistFailed ? (
    <div className="pb-2.5">
      <LiveNotice tone="error">{halls.shortlistFailed}</LiveNotice>
    </div>
  ) : halls.failure && data ? (
    <div className="pb-2.5">
      <LiveNotice tone="error">{HALLS_LOAD_FAILED}</LiveNotice>
    </div>
  ) : pickedCount === 0 ? (
    <div className="pb-2.5">
      <LiveNotice>{COMPARE_STATE_COPY.pickFirst}</LiveNotice>
    </div>
  ) : null;

  return (
    <LiveColumn>
      <InvitationCompare
        model={compare ?? NO_COMPARE}
        sort={sort}
        onSort={setSort}
        onToggleHall={(id) => void halls.toggleShortlist(id)}
        resolveRoute={liveRoute}
        photoSrc={livePhotoSrc}
        empty={empty ?? undefined}
        notice={notice}
      />
    </LiveColumn>
  );
}
