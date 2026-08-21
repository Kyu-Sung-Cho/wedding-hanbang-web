import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  // 어느 쪽으로 렌더됐는지 구분하려고 표식을 남긴다. `hanbang://` 같은 스킴을
  // next/link에 넘기면 클라이언트 라우터가 가로채서 이동이 안 되기 때문에,
  // "무엇으로 렌더됐는가"가 이 컴포넌트의 실제 계약이다.
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="true" {...rest}>
      {children}
    </a>
  ),
}));

import Button from "./Button";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Button은 웹의 첫 공유 프리미티브다. 이 테스트가 지키는 것은 **모양이 아니라 계약**이다.
 *
 * 모양(색·반경·높이)은 디자인이 확정되면 바뀔 값이라 여기서 못 박지 않는다. 대신
 * 실측된 결함들이 프리미티브를 쓰는 것만으로 닫히는지를 본다 — 그게 이 컴포넌트가
 * 존재하는 이유다.
 */
describe("Button 계약", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function render(node: React.ReactNode) {
    await act(async () => {
      root.render(node);
      await Promise.resolve();
    });
  }

  it("type을 안 적어도 submit이 되지 않는다", async () => {
    // 지금 웹에는 type을 안 적은 버튼이 188개다. 오늘은 form 밖이라 무해하지만,
    // 언젠가 form 안으로 옮겨지면 조용히 submit 된다.
    await render(<Button>확인</Button>);
    expect(container.querySelector("button")?.getAttribute("type")).toBe("button");
  });

  it("모든 변형에 포커스 링이 붙는다", async () => {
    // 실측: 버튼 702개 중 포커스 스타일을 가진 것이 52개(7.4%)뿐이었다.
    for (const variant of ["primary", "secondary", "ghost"] as const) {
      await render(<Button variant={variant}>확인</Button>);
      const cls = container.querySelector("button")?.className ?? "";
      expect(cls, `${variant}에 포커스 링이 없습니다`).toContain("focus-visible:ring-2");
    }

    await render(
      <Button variant="icon" label="닫기">
        <span aria-hidden>×</span>
      </Button>,
    );
    expect(container.querySelector("button")?.className).toContain("focus-visible:ring-2");
  });

  it("아이콘 버튼은 접근명을 갖는다", async () => {
    // 실측: 아이콘 전용 버튼 133개 중 58개에 접근명이 없었다.
    // `label`은 타입상 필수라 여기서는 값이 실제로 전달되는지만 본다.
    await render(
      <Button variant="icon" label="닫기">
        <span aria-hidden>×</span>
      </Button>,
    );
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("닫기");
  });

  it("loading은 보조기술에도 말하고 두 번 눌리지 않게 한다", async () => {
    await render(<Button loading>저장 중</Button>);
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.disabled).toBe(true);
  });

  it("앱 안 이동은 next/link로, 커스텀 스킴은 평범한 a로 낸다", async () => {
    // `hanbang://invite#CODE`를 next/link에 넘기면 라우터가 가로채서 이동이 안 된다.
    await render(<Button href="/wedding/onboarding">계속</Button>);
    expect(container.querySelector("a")?.getAttribute("data-next-link")).toBe("true");

    await render(<Button href="hanbang://invite#WH-DEMO24">앱에서 열기</Button>);
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("hanbang://invite#WH-DEMO24");
    expect(anchor?.getAttribute("data-next-link")).toBeNull();
  });

  it("호출자가 준 aria-label을 지우지 않는다", async () => {
    // 2026-08-20 적대 검토가 잡은 블로커. `aria-label={label}`이 스프레드 **뒤에**
    // 있어서, 호출자가 준 aria-label을 undefined로 덮어썼다. React는 undefined 속성을
    // 빼므로 접근명이 통째로 사라진다 — 접근성을 고치겠다고 만든 컴포넌트가
    // 접근명을 **가지고 있던** 버튼 122개를 통과시키는 순간 잃게 만들 뻔했다.
    await render(<Button aria-label="닫기">×</Button>);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("닫기");

    await render(<Button href="/wedding/onboarding" aria-label="온보딩으로">계속</Button>);
    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("온보딩으로");

    await render(<Button href="hanbang://invite#WH-DEMO24" aria-label="앱으로">열기</Button>);
    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("앱으로");
  });

  it("클릭 핸들러가 실제로 불린다", async () => {
    // 계약 테스트가 onClick 전달을 안 봐서, 스프레드를 없애도 초록불이었다.
    const onClick = vi.fn();
    await render(<Button onClick={onClick}>확인</Button>);
    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("호출자가 type=\"submit\"을 주면 그대로 제출 버튼이 된다", async () => {
    // 기본값이 `"button"`인 것과 **호출자를 덮어쓰는 것**은 다르다. `type="button"`을
    // 스프레드 뒤로 옮기면 폼 제출 버튼이 조용히 아무것도 안 하는 버튼이 된다 —
    // 이 프리미티브가 막겠다고 선언한 결함(type 미표기 188개)의 정반대 방향 사고다.
    await render(<Button type="submit">보내기</Button>);
    expect(container.querySelector("button")?.getAttribute("type")).toBe("submit");
  });

  it("호출자가 준 disabled를 무시하지 않는다", async () => {
    // `disabled={loading}`으로 줄여 쓰면 비활성이어야 할 버튼이 눌린다.
    const onClick = vi.fn();
    await render(
      <Button disabled onClick={onClick}>
        확인
      </Button>,
    );
    const button = container.querySelector("button");
    expect(button?.disabled).toBe(true);
    await act(async () => {
      button?.click();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("링크 변형에도 스타일이 붙는다", async () => {
    // 지금 이 프리미티브의 유일한 실제 도입처가 링크 변형이다. 링크 분기에서
    // className을 빠뜨리면 버튼처럼 생기지 않은 링크가 남는다.
    for (const href of ["/wedding/onboarding", "hanbang://invite#WH-DEMO24"]) {
      await render(
        <Button variant="primary" href={href}>
          계속
        </Button>,
      );
      const cls = container.querySelector("a")?.className ?? "";
      expect(cls, `${href}에 스타일이 없습니다`).toContain("inline-flex");
      expect(cls).toContain("focus-visible:ring-2");
    }
  });

  it("링크에 넘긴 부가 속성이 사라지지 않는다", async () => {
    // /invite의 "웹에서 계속하기"는 onClick으로 코드를 보관하고 data-testid로 테스트된다.
    const onClick = vi.fn();
    await render(
      <Button href="/wedding/onboarding" onClick={onClick} data-testid="continue">
        계속
      </Button>,
    );
    expect(container.querySelector("a")?.getAttribute("data-testid")).toBe("continue");
  });
});

describe("Button은 색 리터럴을 다시 들이지 않는다", () => {
  it("모든 색이 역할 변수로만 온다", () => {
    // 이 프리미티브가 존재하는 이유가 리터럴 색을 걷어내는 것이다. 여기에 `#RRGGBB`가
    // 들어오면 466종으로 흩어진 그 문제가 프리미티브 안에서 다시 시작된다.
    const source = readFileSync(
      path.join(process.cwd(), "src/components/ui/Button.tsx"),
      "utf8",
    );
    const literals = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(
      literals,
      `Button.tsx에 색 리터럴이 있습니다. --hb-* 역할 변수를 쓰세요.`,
    ).toEqual([]);
  });
});
