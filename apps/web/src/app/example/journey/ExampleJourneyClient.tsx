"use client";

import { useState } from "react";
import { EXAMPLE_JOURNEY, type JourneyModel } from "@hanbang/shared/invitation";

import InvitationJourney from "@/components/invitation/InvitationJourney";

import ExampleColumn from "../ExampleColumn";
import { exampleRoute } from "../exampleRoutes";

/**
 * 예시 커플 준비 순서. 빼기·다시 넣기와 넣기는 이 화면 안에서만 바뀐다.
 * 아티팩트처럼 단계의 끝남·지금 상태는 그대로 두고 뺀 표시만 바꾼다. 예시 커플의 넣고 뺄 수
 * 있는 단계(상견례·신혼여행)는 모두 지금 단계 뒤라서 지금 단계가 옮겨 가는 일이 없다.
 */
export default function ExampleJourneyClient() {
  const [model, setModel] = useState<JourneyModel>(EXAMPLE_JOURNEY);

  function toggleStage(key: string) {
    setModel((current) => ({
      ...current,
      rows: current.rows.map((row) => (row.key === key && row.optional ? { ...row, off: !row.off } : row)),
    }));
  }

  function toggleAddOn(key: string) {
    setModel((current) => ({
      ...current,
      addOns: current.addOns.map((addOn) => (addOn.key === key ? { ...addOn, added: !addOn.added } : addOn)),
    }));
  }

  return (
    <ExampleColumn>
      <InvitationJourney
        model={model}
        resolveRoute={exampleRoute}
        onToggleStage={toggleStage}
        onToggleAddOn={toggleAddOn}
      />
    </ExampleColumn>
  );
}
