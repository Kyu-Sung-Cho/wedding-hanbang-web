// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { MANNERS_PARTS } from "../data";

/**
 * 2026-08-26 정독에서 고친 것들을 지킨다.
 *
 * 25편 138,617자를 한 문장씩 읽고, 주장된 오류를 세 방향으로 반증한 뒤 살아남은 것만
 * 고쳤다. 여기 있는 것은 **되돌아가면 사람이 다치거나 돈을 잃는 것** 순서다.
 */

/** 주석을 지우고 읽는다 — 설명문이 검사를 좌우하면 안 된다. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const part = (slug: string) => MANNERS_PARTS.find((p) => p.slug === slug);
const textOf = (slug: string) => JSON.stringify(part(slug));

describe("측정기가 살아 있다", () => {
  it("25편을 읽는다", () => {
    expect(MANNERS_PARTS.length).toBe(25);
    expect(textOf("first-family-visit").length).toBeGreaterThan(3000);
  });
});

describe("술을 사양할 말이 있다", () => {
  // 예전에는 술 대사가 딱 하나였고, 그 note 가 「운전해야 해서요」를 **덜 부드러운 선택지**로
  // 깎아내렸다. 첫인사는 대개 차로 가고 밤에 돌아온다. 코퍼스 전체에 「못 마신다」는 대사가
  // 0개였다.
  const visit = textOf("first-family-visit");

  it("운전을 이유로 거절하는 말이 있다", () => {
    expect(visit).toContain("제가 오늘 운전을 해서요");
  });

  it("몸이 못 받아서 거절하는 말이 있다", () => {
    expect(visit).toContain("술이 잘 안 받아서요");
  });

  it("운전을 이유로 든 거절을 열등한 선택지로 깎지 않는다", () => {
    expect(
      visit,
      "「운전해야 해서요」보다 부드럽다는 비교가 되살아났다",
    ).not.toContain("운전해야 해서요라고 말하는 것보다");
  });
});

describe("못 먹는 음식을 숨기라고 하지 않는다", () => {
  // 같은 코퍼스의 `family-meeting` 은 정반대를 지시한다 —
  // 「알레르기나 종교적으로 피하는 음식이 있는 분이 계신지 확인합니다」.
  it("가려 먹는 티를 내지 말라는 금기가 없다", () => {
    expect(textOf("first-family-visit")).not.toContain("가려 먹는 티");
  });

  it("미리 알려두라고 말한다", () => {
    expect(textOf("first-family-visit")).toContain("못 먹는 음식이 있으면");
  });
});

describe("아는 것을 모른다고 말하지 않는다", () => {
  // 「합산 한도가 얼마인지는 확인하지 못했습니다」라고 써 놓고 **두 줄 뒤에** 그 규칙을
  // 적고 있었다. 자기 출처의 supports 에도 답이 적혀 있었다.
  it("합산 한도를 모른다고 하지 않는다", () => {
    expect(textOf("invitation-sending")).not.toContain("합산 한도가 얼마인지는");
  });

  it("두 편이 같은 합산 규칙을 말한다", () => {
    for (const slug of ["invitation-sending", "gift-money"]) {
      expect(textOf(slug), `${slug}: 합산 규칙이 없다`).toContain("현금은 5만원을 넘을 수 없습니다");
    }
  });

  it("축의금 편 출처가 없는 절을 가리키지 않는다", () => {
    // 이 편은 절이 11개이고 청탁금지법 안내는 3번 절이다. 8번은 「정산과 양가 분배」다.
    const money = part("gift-money");
    expect(money?.sections.length).toBe(11);
    expect(money?.sections[7]?.heading).toContain("정산");
    for (const source of money?.sources ?? []) {
      expect(source.supports, `${source.label}: 8번 섹션을 가리킨다`).not.toContain("8번 섹션");
    }
  });
});

describe("아직 안 한 결혼식에 누가 왔다고 하지 않는다", () => {
  // 세 곳에서 소유격이 뒤집혀 있었다. 이 편의 독자는 아직 결혼식을 안 한 사람이다.
  const invitation = textOf("invitation-sending");

  it("「내 결혼식에 왔던」 프레임이 없다", () => {
    for (const wrong of ["내 결혼식에 왔던", "너도 내 결혼식 와줬으니까", "너도 내 결혼식 왔었지"]) {
      expect(invitation, `뒤집힌 소유격이 남아 있다: ${wrong}`).not.toContain(wrong);
    }
  });

  it("내가 축의를 했던 분을 빠뜨리는 쪽도 경고한다", () => {
    // 한국에서 실제로 다툼이 나는 지점인데 경고가 통째로 없었다.
    expect(invitation).toContain("그분이 갚을 기회를 잃으니");
  });
});

describe("위약금 표에서 내 줄을 찾을 수 있다", () => {
  it("여러 줄에 걸릴 때 어느 줄인지 말한다", () => {
    // 기준 자체의 표현이 「29일 전 이후」·「9일 전 이후」라 한 시점이 여러 줄에 걸린다.
    // 표는 정부 자료와 한 글자도 다르지 않으므로 값은 건드리지 않고 읽는 법만 붙였다.
    expect(textOf("cost-saving")).toContain("예식일에 가장 가까운 줄");
  });
});

describe("가족 구성을 하나로 전제하지 않는다", () => {
  // 「한 분만 계시거나」는 138,617자에 딱 한 번 있었다. 정작 신호가 더 센 자리 —
  // 부모 앞에 절하는 폐백, 혼주 인사말, 상견례 좌석표 — 에는 없었다.
  it("절하고 인사하는 편들이 그 말을 갖고 있다", () => {
    for (const slug of ["first-family-visit", "family-meeting", "traditional-greetings", "wedding-day"]) {
      expect(part(slug)?.caveat, `${slug}: caveat 에 가족 구성 안내가 없다`).toContain("가족 구성도 집집마다");
    }
  });
});

describe("호칭 비대칭을 이름 붙여 말한다", () => {
  // 두 표를 나란히 놓으면 같은 관계인데 격이 다르다(도련님/처남, 아가씨/처제, 형님/처형).
  // 코퍼스 전체가 이걸 한 번도 말하지 않았다.
  const address = part("family-address");

  it("그 절이 있다", () => {
    expect(address?.sections.map((s) => s.heading)).toContain("이렇게 부르는 게 불편하다면");
  });

  it("표보다 앞에 온다", () => {
    const headings = address?.sections.map((s) => s.heading) ?? [];
    expect(headings.indexOf("이렇게 부르는 게 불편하다면"))
      .toBeLessThan(headings.indexOf("남편 쪽 가족을 부르는 호칭"));
  });

  it("불편이 예민함이 아니라고 말한다", () => {
    expect(JSON.stringify(address)).toContain("예민한 것이 아니라");
  });

  it("근거가 붙어 있다", () => {
    // 이 편은 출처 0건이었다. 국립국어원은 1차 자료라 출처 계약을 통과한다.
    expect(address?.sources.length, "출처가 없다").toBeGreaterThan(0);
    expect(address?.sources.map((s) => s.label).join(" ")).toContain("국립국어원");
  });

  it("확인하지 못한 대안을 국립국어원의 말로 인용하지 않는다", () => {
    // 구체 대안은 보도 페이지에서 이미지로만 제공돼 텍스트로 확인하지 못했다.
    const body = JSON.stringify(address?.sections);
    expect(body).not.toContain("국립국어원은 도련님");
    expect(body).not.toContain("국립국어원이 제시한 대안");
  });
});

describe("읽는 시간을 절반으로 말하지 않는다", () => {
  it("JSON 길이가 아니라 사람이 읽는 글자를 센다", () => {
    const view = stripComments(
      readFileSync(resolve(process.cwd(), "src/components/manners/MannersPartView.tsx"), "utf8"),
    );
    expect(view, "JSON 길이로 읽기 시간을 계산한다").not.toContain("JSON.stringify(part.sections).length");
    expect(view).toContain("readableCharCount");
    expect(view).toContain("KOREAN_CHARS_PER_MINUTE");
  });
});

describe("긴 글에서 목차가 따라온다", () => {
  it("모바일에서도 고정된다", () => {
    // 예전에는 `lg:sticky` 라 큰 화면에서만 따라왔다. 모바일이 주 제품이고,
    // 「축의금」은 절이 11개에 17분짜리다.
    const view = stripComments(
      readFileSync(resolve(process.cwd(), "src/components/manners/MannersPartView.tsx"), "utf8"),
    );
    const aside = view.slice(view.indexOf("<aside"), view.indexOf("</aside>"));
    expect(aside.length).toBeGreaterThan(200);
    expect(aside, "목차가 모바일에서 스크롤과 함께 사라진다").toContain("sticky top-0");
  });
});

describe("접수처에서 자기 항목을 찾을 수 있다", () => {
  // 요건 목록에는 미성년자 동의만 있고 피성년후견인이 없는데, 준비물에는 그 서류가 있었다.
  // 이 목록은 「접수처에서 막히는 일을 줄이려고」 만든 것이다 — 성년후견을 받는 당사자와
  // 가족이 여기서 자기 줄을 못 찾고 헛걸음한다. 민법 제808조 제2항 실재 확인(국가법령정보센터).
  const registration = part("marriage-registration");

  it("피성년후견인 동의가 요건 목록에 있다", () => {
    const requirements = registration?.sections.find((s) => s.heading.includes("요건"));
    expect(requirements, "요건 절을 못 찾았다").toBeTruthy();
    expect(JSON.stringify(requirements)).toContain("제808조 제2항");
  });

  it("그 조문을 지는 출처가 있다", () => {
    const labels = (registration?.sources ?? []).map((s) => s.label).join(" | ");
    expect(labels, "민법 조문 출처가 없다").toMatch(/민법.*제808조|제808조.*민법/);
  });
});

describe("예산을 잡으라고 만든 표가 예산을 잡게 한다", () => {
  // 두 줄 다 「1인당」인데 7~15만과 5~10만대라, 여섯 분 예산을 30만원대로 잡을지
  // 90만원대로 잡을지 이 표로는 못 정했다. 값은 관행 정리라 건드리지 않고 읽는 법을 붙였다.
  it("두 줄의 관계를 말한다", () => {
    const table = part("family-meeting")?.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.kind === "table");
    expect(table, "상견례 표를 못 찾았다").toBeTruthy();
    expect(table && "limits" in table ? table.limits : "").toContain("포함 관계가 아니라");
  });

  it("참고란이 값과 상관있는 말을 한다", () => {
    // 「음식을 고르는 시간이 없어 대화에 집중하기 좋습니다」는 다른 팁과 한 글자도 다르지
    // 않은 복사본이었고, 금액 표의 참고란에 들어갈 말이 아니었다.
    expect(JSON.stringify(part("family-meeting")?.sections))
      .not.toContain("음식을 고르는 시간이 없어 대화에 집중하기 좋습니다\", \"");
  });
});
