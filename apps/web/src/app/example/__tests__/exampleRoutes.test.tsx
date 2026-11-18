import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPARE_COPY,
  EXAMPLE_COPY,
  EXAMPLE_PHOTO_KEYS,
  FIRST_CHAT_COPY,
  HOME_COPY,
  JOURNEY_COPY,
  LETTER_COPY,
  STATUS_COPY,
} from "@hanbang/shared/invitation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import robots from "@/app/robots";
import {
  buttonNamed,
  cleanup,
  click,
  linkNamed,
  render,
  text,
} from "@/components/invitation/__tests__/dom";

import ExampleLayout, { metadata as layoutMetadata } from "../layout";
import ExampleHomeClient from "../ExampleHomeClient";
import ExampleChatClient from "../chat/ExampleChatClient";
import { metadata as chatMetadata } from "../chat/page";
import ExampleJourneyClient from "../journey/ExampleJourneyClient";
import { metadata as journeyMetadata } from "../journey/page";
import ExampleHallsClient from "../halls/ExampleHallsClient";
import { metadata as hallsMetadata } from "../halls/page";
import ExampleLetterClient from "../halls/letter/ExampleLetterClient";
import { metadata as letterMetadata } from "../halls/letter/page";
import ExampleConsultationClient from "../consultation/ExampleConsultationClient";
import { metadata as consultationMetadata } from "../consultation/page";
import { EXAMPLE_PAGE_TITLES, EXAMPLE_ROUTES, examplePhotoSrc } from "../exampleRoutes";

/**
 * 예시 커플 화면(`/example/**`). 로그인 없이 보는 화면이라 검색에 뜨지 않아야 하고, 아티팩트의
 * 화면 사이 이동을 그대로 따라야 하며, 누르는 것은 이 화면 안에서만 바뀐다.
 */
describe("예시 커플 주소와 사진", () => {
  it("주소는 명세의 여섯 개다", () => {
    expect(EXAMPLE_ROUTES).toEqual({
      home: "/example",
      chat: "/example/chat",
      journey: "/example/journey",
      compare: "/example/halls",
      letter: "/example/halls/letter",
      status: "/example/consultation",
    });
  });

  it("사진 이름은 웹 자산으로 바뀌고 그 파일이 실제로 있다. 모르는 이름은 그리지 않는다", () => {
    for (const key of EXAMPLE_PHOTO_KEYS) {
      const src = examplePhotoSrc(key);
      expect(src).toBe(`/images/amora/${key}.webp`);
      expect(existsSync(path.join(process.cwd(), "public", src ?? "")), `${src} 파일이 없다`).toBe(true);
    }
    expect(examplePhotoSrc("https://example.com/x.webp")).toBeNull();
    expect(examplePhotoSrc("../../secret")).toBeNull();
  });
});

describe("검색에 뜨지 않는다", () => {
  it("레이아웃이 noindex·nofollow 이고 모든 화면이 그것을 물려받는다", () => {
    expect(layoutMetadata.robots).toEqual({ index: false, follow: false });
    for (const pageMetadata of [chatMetadata, journeyMetadata, hallsMetadata, letterMetadata, consultationMetadata]) {
      // 화면이 robots 를 따로 적으면 레이아웃 값을 덮는다. 적지 않아야 물려받는다.
      expect(pageMetadata.robots).toBeUndefined();
    }
  });

  it("robots.txt 도 예시 화면을 막는다", () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    const disallow = list.flatMap((rule) => (Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow]));
    expect(disallow).toContain("/example");
  });

  it("탭 제목은 아티팩트 화면 제목이고 예시 커플이라고 붙는다", () => {
    expect(layoutMetadata.title).toEqual({ default: "예시 커플 | 웨딩한방", template: "%s | 예시 커플 | 웨딩한방" });
    expect([chatMetadata, journeyMetadata, hallsMetadata, letterMetadata, consultationMetadata].map((m) => m.title)).toEqual([
      EXAMPLE_PAGE_TITLES.chat,
      EXAMPLE_PAGE_TITLES.journey,
      EXAMPLE_PAGE_TITLES.compare,
      EXAMPLE_PAGE_TITLES.letter,
      EXAMPLE_PAGE_TITLES.status,
    ]);
  });
});

describe("예시 표시 줄", () => {
  afterEach(cleanup);

  it("모든 화면 맨 위에 예시라는 줄이 있고, 화면은 main 안에 들어간다", async () => {
    const { container } = await render(
      <ExampleLayout>
        <div data-child>화면</div>
      </ExampleLayout>,
    );

    const banner = container.querySelector("[data-example-banner]");
    expect(text(banner)).toContain(EXAMPLE_COPY.banner);
    expect(linkNamed(container, EXAMPLE_COPY.leave).getAttribute("href")).toBe("/");
    expect(container.querySelector("main [data-child]")).not.toBeNull();
    expect(banner?.compareDocumentPosition(container.querySelector("main") as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("예시 홈은 폭에 따라 두 모습 중 하나다", () => {
  afterEach(cleanup);

  it("1024px 아래는 앱 홈, 그 위는 웹 두 칸 화면이다", async () => {
    const { container } = await render(<ExampleHomeClient />);

    const narrow = container.querySelector('[data-example-view="narrow"]');
    const wide = container.querySelector('[data-example-view="wide"]');
    expect(narrow?.className.split(" ")).toContain("lg:hidden");
    expect(wide?.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "lg:flex"]));
    expect(narrow?.querySelector('[data-invitation-screen="home"]')).not.toBeNull();
    expect(wide?.querySelector('[data-invitation-screen="web"]')).not.toBeNull();
    // 폰 홈은 넓은 화면에서 480px 단 가운데에 놓인다.
    expect(narrow?.querySelector(".max-w-\\[480px\\]")).not.toBeNull();
  });
});

describe("화면 사이 이동은 아티팩트의 링크를 따른다", () => {
  afterEach(cleanup);

  it("홈: 3곳 비교하기 → 비교, 상담 갈 시간 고르기 → 편지, 하단 메뉴 → 홈·대화·순서·상담", async () => {
    const { container } = await render(<ExampleHomeClient />);
    const narrow = container.querySelector('[data-example-view="narrow"]') as HTMLElement;

    expect(linkNamed(narrow, "3곳 비교하기").getAttribute("href")).toBe("/example/halls");
    expect(narrow.querySelector('[data-decision="consult-time"]')?.getAttribute("href")).toBe("/example/halls/letter");
    const nav = narrow.querySelector("nav");
    expect(Array.from(nav?.querySelectorAll("a") ?? []).map((link) => link.getAttribute("href"))).toEqual([
      "/example",
      "/example/chat",
      "/example/journey",
      "/example/consultation",
    ]);
  });

  it("뒤로 가기는 모두 예시 홈으로 간다", async () => {
    for (const [screen, label] of [
      [<ExampleChatClient key="chat" />, FIRST_CHAT_COPY.back],
      [<ExampleJourneyClient key="journey" />, JOURNEY_COPY.back],
      [<ExampleHallsClient key="halls" />, COMPARE_COPY.back],
      [<ExampleConsultationClient key="status" />, STATUS_COPY.back],
    ] as const) {
      const { container } = await render(screen);
      expect(linkNamed(container, label).getAttribute("href")).toBe("/example");
      await cleanup();
    }
  });

  it("비교의 문의 → 편지, 편지의 보내기 → 상담 확정, 나중에 → 비교", async () => {
    const halls = await render(<ExampleHallsClient />);
    expect(linkNamed(halls.container, COMPARE_COPY.inquire(2)).getAttribute("href")).toBe("/example/halls/letter");
    await cleanup();

    const letter = await render(<ExampleLetterClient />);
    expect(linkNamed(letter.container, LETTER_COPY.send).getAttribute("href")).toBe("/example/consultation");
    expect(linkNamed(letter.container, LETTER_COPY.later).getAttribute("href")).toBe("/example/halls");
  });

  it("첫 대화와 준비 순서의 확인 단추는 예시 홈으로 간다", async () => {
    const chat = await render(<ExampleChatClient />);
    expect(linkNamed(chat.container, FIRST_CHAT_COPY.confirm).getAttribute("href")).toBe("/example");
    await cleanup();

    const journey = await render(<ExampleJourneyClient />);
    expect(linkNamed(journey.container, JOURNEY_COPY.confirm).getAttribute("href")).toBe("/example");
  });

  it("넓은 화면의 정할 것 줄도 같은 주소 체계를 쓴다", async () => {
    const { container } = await render(<ExampleHomeClient />);
    const wide = container.querySelector('[data-example-view="wide"]');
    expect(wide?.querySelector('[data-decision="gaon-time"]')?.getAttribute("href")).toBe("/example/consultation");
    expect(wide?.querySelector('[data-hall="b"] img')?.getAttribute("src")).toBe("/images/amora/hall-sample-garden.webp");
  });
});

describe("누르는 것은 그 화면 안에서 바뀐다", () => {
  afterEach(cleanup);

  it("첫 대화: 달을 고르면 초안의 달이 바뀌고, 단계를 고르면 대답이 바뀐다", async () => {
    const { container } = await render(<ExampleChatClient />);
    const draft = () => text(container.querySelector('[data-invitation-card="draft"]'));
    expect(draft()).toContain("2027. 05. __");

    await click(buttonNamed(container, "10월"));
    expect(buttonNamed(container, "10월").getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed(container, "5월").getAttribute("aria-pressed")).toBe("false");
    expect(draft()).toContain("2027. 10. __");

    await click(buttonNamed(container, "조금 알아봤어요"));
    expect(container.textContent).toContain("조금씩 알아보는 중이에요");
  });

  it("준비 순서: 빼기와 다시 넣기, 넣기", async () => {
    const { container } = await render(<ExampleJourneyClient />);
    const families = () => container.querySelector('li[data-step="families"]') as HTMLElement;

    await click(families().querySelector("button"));
    expect(text(families().querySelector("button"))).toBe(JOURNEY_COPY.restore);
    expect(text(families())).toContain(JOURNEY_COPY.removedSub);

    await click(families().querySelector("button"));
    expect(text(families().querySelector("button"))).toBe(JOURNEY_COPY.remove);

    await click(buttonNamed(container, "반지와 예물 넣기"));
    expect(buttonNamed(container, "반지와 예물 넣기").getAttribute("aria-pressed")).toBe("true");
  });

  it("비교: 하트를 누르면 문의 단추의 곳 수가 바뀌고, 하나도 없으면 잠긴다", async () => {
    const { container } = await render(<ExampleHallsClient />);

    await click(buttonNamed(container, COMPARE_COPY.heartLabel("루체 컨벤션")));
    expect(buttonNamed(container, COMPARE_COPY.heartLabel("루체 컨벤션")).getAttribute("aria-pressed")).toBe("true");
    expect(linkNamed(container, COMPARE_COPY.inquire(3)).getAttribute("href")).toBe("/example/halls/letter");

    for (const name of ["소담 하우스", "가온 웨딩홀", "루체 컨벤션"]) {
      await click(buttonNamed(container, COMPARE_COPY.heartLabel(name)));
    }
    expect(buttonNamed(container, COMPARE_COPY.inquire(0)).disabled).toBe(true);

    await click(buttonNamed(container, "보증 인원"));
    expect(buttonNamed(container, "보증 인원").getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed(container, "총액 순").getAttribute("aria-pressed")).toBe("false");
  });

  it("편지: 예산 스위치를 켜면 켜짐과 알려줄 문장이 함께 바뀐다", async () => {
    const { container } = await render(<ExampleLetterClient />);
    const budget = () => buttonNamed(container, LETTER_COPY.switchLabel("예산"));

    expect(budget().getAttribute("aria-checked")).toBe("false");
    await click(budget());
    expect(budget().getAttribute("aria-checked")).toBe("true");
    expect(text(container.querySelector('[data-share="budget"]'))).toContain(LETTER_COPY.budgetUnset);
  });

  it("홈: 무엇을 했나요? 는 펼치고 접힌다", async () => {
    const { container } = await render(<ExampleHomeClient />);
    const narrow = container.querySelector('[data-example-view="narrow"]') as HTMLElement;

    await click(buttonNamed(narrow, HOME_COPY.whatDidYouDo));
    expect(buttonNamed(narrow, HOME_COPY.fold).getAttribute("aria-expanded")).toBe("true");
  });
});
