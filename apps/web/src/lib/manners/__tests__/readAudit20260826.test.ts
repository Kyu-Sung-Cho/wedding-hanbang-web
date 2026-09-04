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
    const readingTime = stripComments(
      readFileSync(resolve(process.cwd(), "src/lib/manners/readingTime.ts"), "utf8"),
    );
    expect(readingTime, "JSON 길이로 읽기 시간을 계산한다").not.toContain("JSON.stringify");
    expect(readingTime).toContain("KOREAN_CHARS_PER_MINUTE");
  });

  it("목록 카드와 본문이 같은 함수를 쓴다", () => {
    // 카드는 「17분」, 본문은 「8분」 처럼 갈리면 안 된다. 두 화면이 각자 계산하면
    // 반드시 갈린다 — 예전에 본문이 실제의 절반을 말한 것도 계산이 한 곳에만 있었기 때문이다.
    for (const path of [
      "src/components/manners/MannersPartView.tsx",
      "src/app/manners/page.tsx",
    ]) {
      const source = stripComments(readFileSync(resolve(process.cwd(), path), "utf8"));
      expect(source, `${path}: 공유 계산을 안 쓴다`).toContain("readingMinutesOf");
      expect(source, `${path}: 자기 계산식을 따로 갖고 있다`).not.toContain("/ 1800");
    }
  });

  it("목록 카드가 분량을 문 앞에서 알려준다", () => {
    // 예전에는 오디언스·제목·부제뿐이라 3분짜리와 18분짜리가 같은 카드였다.
    const index = stripComments(
      readFileSync(resolve(process.cwd(), "src/app/manners/page.tsx"), "utf8"),
    );
    expect(index).toContain("개 절");
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

describe("기관 이름을 대고 말한 것은 그 기관 자료로 받친다", () => {
  // 식약처를 대고 건강 수치 둘을 말하는데 출처 8건에 식약처가 없었다. 확인해 보니
  // 「2시간 이내」는 실재하고, 「32~43℃」는 그 자료에 없다 — 같은 페이지는 다른 균의
  // 43~47℃를 말한다. 확인된 것만 남겼다.
  const wedding = part("small-wedding");

  it("2시간 권고에 식약처 출처가 붙어 있다", () => {
    expect(JSON.stringify(wedding?.sections)).toContain("2시간 이내에 먹도록");
    expect((wedding?.sources ?? []).map((s) => s.label).join(" | "))
      .toContain("식품의약품안전처");
  });

  it("확인 못 한 온도 구간을 식약처가 말한 것처럼 적지 않는다", () => {
    expect(JSON.stringify(wedding?.sections), "확인되지 않은 온도 구간이 되살아났다")
      .not.toContain("32~43℃");
  });
});

describe("확인 못 한 범위를 그 자리에서 밝힌다", () => {
  it("대출 신청 기한과 대상주택 요건의 한계를 적는다", () => {
    // 기한을 넘기면 대출 자체가 불가능해지고, 대상주택 요건에 안 맞으면 계약금을 잃는다.
    // 주택도시기금 안내가 자바스크립트로 그려져 1차 자료로 확인하지 못했다.
    expect(JSON.stringify(part("cost-saving")?.sections))
      .toContain("대상주택 요건은 저희가 1차 자료로 확인하지 못했습니다");
  });
});

describe("부모 없이 치러도 가장 비싼 절차를 찾을 수 있다", () => {
  // 예식장 비용 정산 — 그날 가장 큰 금액이 오가는 절차 — 이 「양가 어른(혼주)의 당일」
  // 절 안에만 있었다. 「두 사람 — 식이 끝난 뒤」에는 0줄이었다. 내용을 옮기지 않고
  // 누가 맡든 해야 하는 일로 자리를 잡아 줬다.
  const sectionOf = (heading: string) =>
    part("wedding-day")?.sections.find((s) => s.heading === heading);

  it("두 사람 절에서 정산으로 가는 길이 있다", () => {
    const after = sectionOf("두 사람 — 식이 끝난 뒤");
    expect(after, "절을 못 찾았다").toBeTruthy();
    expect(JSON.stringify(after)).toContain("예식장 비용 정산");
  });

  it("혼주 절이 부모만의 일이 아니라고 말한다", () => {
    expect(JSON.stringify(sectionOf("양가 어른(혼주)의 당일")))
      .toContain("두 사람이 직접 맡거나");
  });
});

describe("빽빽함 — 눈이 구별할 수 있게", () => {
  const view = () =>
    stripComments(
      readFileSync(resolve(process.cwd(), "src/components/manners/MannersPartView.tsx"), "utf8"),
    );

  it("절과 절 사이에 선이 있다", () => {
    // 예전에는 이 파일 전체에서 border-t 가 맨 아래 출처 절 **한 곳**뿐이었다.
    // 본문 171개 절 사이 구분선이 0개라, 스크롤하면 34개 블록이 균질한 기둥으로 지나갔다.
    // **어느 divide-y 인지 지목한다.** 첫 판은 문자열만 물었는데, 모바일 표 행의
    // `divide-y divide-[#243832]/10` 이 대신 답해서 절 구분선을 지워도 통과했다
    // (변형 시험이 잡음). 절을 감싸는 그 한 줄을 정확히 집는다.
    //
    // 2026-09-03: 절이 **카드**가 됐다(시안). 구분선 대신 카드마다 테두리가 있고
    // 사이에 여백이 있다 — 지키려던 것("스크롤하면 균질한 기둥으로 지나간다")은 더
    // 강하게 지켜진다. 그래서 표기가 아니라 **뜻**을 잰다: 절을 그리는 `<section>` 이
    // 자기 테두리를 갖고, 그것들을 감싼 줄이 사이 여백을 준다.
    const source = view();
    const sectionTag = source.slice(
      source.indexOf("<section", source.indexOf("part.sections.map")),
      source.indexOf(">", source.indexOf("scroll-mt-28")) + 1,
    );
    expect(sectionTag, "절 <section> 을 못 찾았다").toContain("scroll-mt-28");
    expect(sectionTag, "절마다 경계가 없다 — 스크롤하면 균질한 기둥이 된다")
      .toMatch(/\bborder\b/u);
    const wrapper = source
      .split(String.fromCharCode(10))
      .find((line) => line.includes("part.sections.map") || line.includes('className="mt-6 space-y-'));
    expect(wrapper, "절 컨테이너 줄을 못 찾았다").toBeTruthy();
    expect(source, "절 사이 여백이 없다").toMatch(/className="mt-6 space-y-\d/u);
  });

  it("절 제목이 본문보다 확실히 크다", () => {
    // 17px 대 14px = 1.21배였다. 제목이 제목으로 안 보였다.
    //
    // ⚠️ 클래스 **순서**에 묶지 마라. 첫 판은 `<h2 className="text-[Npx] font-semibold` 로
    // 물었는데, 2026-09-03 에 카드 배치를 넣으며 `min-w-0 flex-1` 이 앞에 붙자 정규식이
    // 못 읽어 "h2 를 못 찾았다" 로 죽었다 — 크기는 멀쩡했는데도. 절 제목 h2 를 먼저
    // 집고, 그 안에서 크기를 읽는다.
    const sectionH2 = view().match(
      /<h2[^>]*className="[^"]*"[^>]*>\s*\{sectionLabel\(section\.heading\)\}/u,
    );
    expect(sectionH2, "절 제목 h2 를 못 찾았다").toBeTruthy();
    const heading = sectionH2![0].match(/text-\[(\d+(?:\.\d+)?)px\]/u);
    expect(heading, "절 제목에 고정 크기가 없다").toBeTruthy();
    expect(Number(heading![1]), "절 제목이 본문 14px 의 1.4배 미만이다")
      .toBeGreaterThanOrEqual(20);
  });

  it("「하면 편해요」와 「조심하세요」가 다른 색이다", () => {
    // 예전에는 안쪽 색이 서로 ΔE 1.57 — 사람이 알아채는 문턱 아래였고, 라벨 색까지 같았다.
    // 경고는 이 코퍼스에서 가장 중요한 블록인데 팁과 구별되지 않았다.
    const source = view();
    const tone = source.slice(source.indexOf("const BLOCK_TONE"), source.indexOf("} as const;"));
    expect(tone.length).toBeGreaterThan(100);

    // ⚠️ **hex 리터럴 개수로 세지 마라.** 옛 검사는 `bg-[#hex]` 를 둘 세고 있었는데,
    // 2026-08-28 색 개편에서 팁 쪽이 역할 변수(`bg-[var(--hb-primary)]/[0.05]`)로
    // 바뀌자 하나만 남아 실패했다 — **색은 여전히 서로 달랐는데도.** 지켜야 할 것은
    // 표기법이 아니라 "둘이 다른가" 이므로, 값을 통째로 꺼내 비교한다.
    const grab = (key: string): string[] => {
      const found = new RegExp(`${key}:\\s*"([^"]+)"`, "gu");
      return [...tone.matchAll(found)].map((m) => m[1]);
    };
    const boxes = grab("box");
    expect(boxes.length, "상자 색을 두 개 못 찾았다").toBe(2);
    expect(new Set(boxes).size, "팁과 경고가 같은 바탕색이다").toBe(2);
    // 바탕이 "다르다" 만으로는 부족하다 — 투명도만 다르고 색이 같으면 사람 눈에는 같다.
    // 그래서 **색 자리**(hex 또는 역할 변수 이름)를 뽑아 그것이 다른지 본다.
    const hueOf = (value: string): string =>
      (/bg-\[(?:var\((--[\w-]+)\)|(#[0-9A-Fa-f]{6}))\]/u.exec(value) ?? [])
        .slice(1)
        .find(Boolean)
        ?.toLowerCase() ?? value;
    expect(new Set(boxes.map(hueOf)).size, "팁과 경고의 바탕이 투명도만 다르다").toBe(2);

    // 라벨도 갈려야 한다 — 예전엔 둘 다 #8F5150 이었다.
    expect(tone, "라벨 색이 갈리지 않는다").toContain("labelColor");
    const labels = grab("labelColor");
    expect(labels.length, "라벨 색을 두 개 못 찾았다").toBe(2);
    expect(new Set(labels).size, "팁과 경고 라벨이 같은 색이다").toBe(2);
  });

  it("목록 항목 사이가 항목 안 줄 사이보다 넓다", () => {
    // space-y-1.5(6px) 는 항목 안 줄 사이 10.5px 보다 좁았다. 항목 79%가 2줄 이상이라
    // 불릿이 구분자 노릇을 못 하고 목록이 문단으로 뭉갰다.
    const ul = view().match(/<ul className="mt-[\d.]+ space-y-([\d.]+)">/);
    expect(ul, "목록 ul 을 못 찾았다").toBeTruthy();
    expect(Number(ul![1]), "항목 간격이 좁다").toBeGreaterThanOrEqual(2.5);
  });
});

describe("긴 편은 목차를 먼저 보여준다", () => {
  it("머리에 세로 차례가 있다", () => {
    // 상단 sticky 칩 띠는 실폭 1,776px 에 창 343px — 11개 중 2.3개만 보인다.
    // 첫 화면 812px 중 본문이 59px(7%)뿐이라, 한 번은 세로로 전부 보여준다.
    const source = stripComments(
      readFileSync(resolve(process.cwd(), "src/components/manners/MannersPartView.tsx"), "utf8"),
    );
    expect(source).toContain('aria-label="이 글의 차례"');
    expect(source, "절이 적은 편에도 그린다").toContain("part.sections.length >= 4");
  });

  it("읽은 뒤 CTA 가 읽은 뒤에 있다", () => {
    // 자기 문구가 「읽은 뒤 준비하기」인데 첫 화면 134px(16.5%)를 읽기 전에 먹고 있었다.
    const source = stripComments(
      readFileSync(resolve(process.cwd(), "src/components/manners/MannersPartView.tsx"), "utf8"),
    );
    const headerEnd = source.indexOf("</header>");
    const cta = source.indexOf("읽은 뒤 준비하기");
    expect(headerEnd, "header 를 못 찾았다").toBeGreaterThan(-1);
    expect(cta, "CTA 를 못 찾았다").toBeGreaterThan(-1);
    expect(cta, "CTA 가 아직 머리에 있다").toBeGreaterThan(headerEnd);
  });
});
