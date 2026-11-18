"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EXAMPLE_JOURNEY, JOURNEY_COPY, JOURNEY_STATE_COPY, type JourneyModel } from "@hanbang/shared/invitation";

import InvitationJourney from "../InvitationJourney";
import { DemoExampleNote, LiveColumn, LiveLoadingScreen, LiveMessageScreen, LiveNotice } from "./LiveParts";
import { liveRoute } from "./liveRoutes";
import { LIVE_RETRY_LABEL, loadFailedMessage } from "./liveStateCopy";
import { useInvitationJourney } from "./useInvitationJourney";
import { useLiveIdentity } from "./useLiveIdentity";

const BACK_HOME = { href: liveRoute("home"), label: JOURNEY_COPY.back };

/** 체험 모드: 예시 커플의 준비 순서. 누른 것은 이 화면 안에서만 바뀐다(예시 커플 화면과 같다). */
function DemoJourney() {
  const [model, setModel] = useState<JourneyModel>(EXAMPLE_JOURNEY);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DemoExampleNote />
      <LiveColumn>
        <InvitationJourney
          model={model}
          resolveRoute={liveRoute}
          onToggleStage={(key) =>
            setModel((current) => ({
              ...current,
              rows: current.rows.map((row) => (row.key === key && row.optional ? { ...row, off: !row.off } : row)),
            }))}
          onToggleAddOn={(key) =>
            setModel((current) => ({
              ...current,
              addOns: current.addOns.map((addOn) => (addOn.key === key ? { ...addOn, added: !addOn.added } : addOn)),
            }))}
        />
      </LiveColumn>
    </div>
  );
}

/**
 * 준비 순서(`/journey`) 실제 커플 화면(`Journey.dc`). 빼기·다시 넣기·넣기는 누르면 먼저 바뀌고
 * PATCH `/api/invitation/journey-plan` 으로 저장한다(실패하면 되돌린다). "이 순서로 할게요"는 저장이 끝나기를
 * 기다렸다가 청첩장 홈으로 간다.
 */
export default function LiveJourney() {
  const identity = useLiveIdentity();
  const journey = useInvitationJourney(identity);
  const router = useRouter();

  if (identity.isDemo) return <DemoJourney />;
  if (!journey.data) {
    if (journey.loading) return <LiveLoadingScreen back={BACK_HOME} />;
    return (
      <LiveColumn>
        <LiveMessageScreen
          back={BACK_HOME}
          tone="error"
          text={loadFailedMessage(journey.failure, JOURNEY_STATE_COPY.loadFailed)}
          action={{ label: LIVE_RETRY_LABEL, onClick: journey.reload }}
        />
      </LiveColumn>
    );
  }

  async function confirm() {
    if (await journey.settle()) router.push(liveRoute("home"));
  }

  return (
    <LiveColumn>
      <InvitationJourney
        model={journey.data.journey}
        resolveRoute={liveRoute}
        onToggleStage={journey.toggleStage}
        onToggleAddOn={journey.toggleAddOn}
        onConfirm={() => void confirm()}
        notice={journey.saveFailed ? <LiveNotice tone="error">{journey.saveFailed}</LiveNotice> : null}
      />
    </LiveColumn>
  );
}
