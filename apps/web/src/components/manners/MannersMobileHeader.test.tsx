import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MannersMobileHeader from "./MannersMobileHeader";

// 로그인한 사람에게는 앱 상단 바(`MannersSignedInTopBar`)가 같은 자리에 온다. 목록 화면의 이 머리는
// 그와 겹쳐 내리지만, 글 화면의 머리는 「예절 가이드 전체 보기」로 되돌아가는 유일한 한 번 누름이라
// 상단 바가 있어도 남아 있어야 한다.
const HIDE_WHEN_APP_CHROME = "group-has-[[data-manners-app-chrome]]/manners:hidden";

describe("MannersMobileHeader", () => {
  it("steps aside for the app top bar on the guide index", () => {
    const html = renderToStaticMarkup(<MannersMobileHeader index />);
    expect(html).toContain(HIDE_WHEN_APP_CHROME);
    expect(html).toContain("웨딩한방 홈으로 이동");
  });

  it("keeps the way back to the list on an article even with the app top bar", () => {
    const html = renderToStaticMarkup(<MannersMobileHeader />);
    expect(html).not.toContain(HIDE_WHEN_APP_CHROME);
    expect(html).toContain("예절 가이드 전체 보기");
  });

  it("still hides on desktop in both variants", () => {
    for (const html of [renderToStaticMarkup(<MannersMobileHeader index />), renderToStaticMarkup(<MannersMobileHeader />)]) {
      expect(html).toContain("md:hidden");
    }
  });
});
