"use client";

import { EXAMPLE_CONSULTATION } from "@hanbang/shared/invitation";

import InvitationConsultation from "@/components/invitation/InvitationConsultation";

import ExampleColumn from "../ExampleColumn";
import { examplePhotoSrc, exampleRoute } from "../exampleRoutes";

/** 예시 커플 상담 확정. 바꾸는 값이 없고, 주소 해석 함수를 넘기려고 클라이언트에서 그린다. */
export default function ExampleConsultationClient() {
  return (
    <ExampleColumn>
      <InvitationConsultation model={EXAMPLE_CONSULTATION} resolveRoute={exampleRoute} photoSrc={examplePhotoSrc} />
    </ExampleColumn>
  );
}
