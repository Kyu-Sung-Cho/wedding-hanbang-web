"use client";

import { useState } from "react";
import {
  EXAMPLE_FIRST_CHAT,
  EXAMPLE_HOME,
  FIRST_CHAT_COPY,
  type PreparationStartStage,
} from "@hanbang/shared/invitation";

import InvitationFirstChat from "@/components/invitation/InvitationFirstChat";

import ExampleColumn from "../ExampleColumn";
import { exampleRoute } from "../exampleRoutes";

/** 예시 커플 첫 대화. 고른 단계와 달은 이 화면 안에서만 바뀌고 어디에도 저장하지 않는다. */
export default function ExampleChatClient() {
  // 아티팩트의 첫 상태: "이제 시작해요", 민지와 준호의 예식 달(5월).
  const [stage, setStage] = useState<PreparationStartStage>(FIRST_CHAT_COPY.stages[0].id);
  const [month, setMonth] = useState<number | null>(EXAMPLE_HOME.invitation.month);

  return (
    <ExampleColumn>
      <InvitationFirstChat
        model={EXAMPLE_FIRST_CHAT}
        stage={stage}
        month={month}
        onPickStage={setStage}
        onPickMonth={setMonth}
        resolveRoute={exampleRoute}
      />
    </ExampleColumn>
  );
}
