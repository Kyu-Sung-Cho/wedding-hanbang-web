"use client";

import { EXAMPLE_HOME, EXAMPLE_WEB_SPACE } from "@hanbang/shared/invitation";

import InvitationHome from "@/components/invitation/InvitationHome";
import InvitationWebSpace from "@/components/invitation/InvitationWebSpace";

import ExampleColumn from "./ExampleColumn";
import { examplePhotoSrc, exampleRoute } from "./exampleRoutes";

/**
 * 예시 커플 홈. 1024px 이상에서는 웹 두 칸 화면(`Web.dc`), 그 아래에서는 앱 홈(`Home.dc`)이다.
 * 둘 다 그려 두고 폭에 따라 하나만 보인다. 서버 렌더와 첫 화면이 폭과 무관하게 같아서
 * 화면이 바뀌며 깜빡이지 않는다. 숨긴 쪽은 보조기술에도 읽히지 않는다.
 */
export default function ExampleHomeClient() {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col lg:hidden" data-example-view="narrow">
        <ExampleColumn>
          <InvitationHome model={EXAMPLE_HOME} resolveRoute={exampleRoute} />
        </ExampleColumn>
      </div>
      <div className="hidden min-h-0 flex-1 lg:flex" data-example-view="wide">
        <InvitationWebSpace model={EXAMPLE_WEB_SPACE} resolveRoute={exampleRoute} photoSrc={examplePhotoSrc} />
      </div>
    </>
  );
}
