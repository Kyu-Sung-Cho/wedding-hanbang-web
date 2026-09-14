// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **처리방침 제6조가 가리키는 설정 화면이 실제로 그 화면이어야 한다.**
 *
 * 2026-09-14 까지 제6조 2항은 "이용 내역은 설정 페이지에서 확인할 수 있습니다"
 * 라고 적혀 있었다. 그런데 `/settings` 에는 이용 내역·접속 기록을 보여주는
 * 화면이 없다 — 프로필, 웨딩 스타일, 커플 연결, 알림 설정, 아모라 도움 방식,
 * 아모라가 기억하는 것뿐이다. 사용자는 없는 화면을 찾아다니게 된다.
 *
 * 그래서 문장을 고정하지 않고 **문서가 이름 부른 화면이 설정 소스에 실제로
 * 있는지**를 본다. 설정 화면의 이름이 바뀌면 여기가 빨개지고 문서를 같이
 * 고치게 된다. 반대로 설정에 이용 내역 화면이 생기면 아래 마지막 검사가
 * 빨개져 문서를 다시 쓰게 된다 — 한 방향만 보면 문서가 다시 낡는다.
 *
 * 주석은 걷어내고 본다. 이 저장소에서 주석이 코드 대신 답해 잘못된 초록불이
 * 난 이력이 있다(설정 소스의 `{/* 프로필 카드 *\/}` 처럼).
 */
const PRIVACY = "src/app/privacy/page.tsx";
const SETTINGS = "src/app/(app)/settings/page.tsx";

function read(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

/**
 * JSX 주석·블록 주석·`//` 줄 주석을 지운 소스 — 화면에 나가는 문구만 남긴다.
 *
 * `//` 는 줄 처음이나 공백 뒤에서만 지운다. 아무 데서나 지우면 `"https://…"` 가
 * 망가진다. 줄 끝 주석(`코드; // 설명`)도 이 조건에 걸려 같이 지워진다.
 */
function visible(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|\s)\/\/.*$/gmu, "$1");
}

/** 제6조 섹션만 떼어 낸다. 문서 전체에서 세면 다른 조항의 같은 낱말이 대신 답한다. */
function rightsSection(): string {
  const section = visible(read(PRIVACY)).match(
    /제6조 \(정보주체의 권리\)[\s\S]*?<\/section>/u,
  )?.[0];
  expect(section, "제6조 (정보주체의 권리) 섹션을 찾지 못했다").toBeTruthy();
  return section ?? "";
}

/** 제6조 안에서 "이용 내역" 을 말하는 항목 하나. */
function usageHistoryItem(): string {
  const items = rightsSection().match(/<li>[\s\S]*?<\/li>/gu) ?? [];
  const item = items.find((candidate) => candidate.includes("이용 내역"));
  expect(item, "제6조에 이용 내역을 말하는 항목이 없다").toBeTruthy();
  return item ?? "";
}

/** 문서가 설정 페이지에서 볼 수 있다고 이름 부르는 화면들. 설정 소스의 눈에 보이는 라벨과 같아야 한다. */
const SETTINGS_SURFACES_NAMED_IN_POLICY = [
  "웨딩 스타일",
  "커플 연결",
  "알림 설정",
  "아모라 도움 방식",
  "아모라가 기억하는 것",
] as const;

describe("처리방침 제6조 — 설정 페이지가 실제로 보여주는 것만 말한다", () => {
  it("이용 내역을 설정 페이지에서 확인할 수 있다고 말하지 않는다", () => {
    // 2026-09-14 실측: /settings 에 이용 내역·접속 기록 화면이 없다.
    expect(rightsSection()).not.toMatch(/이용 내역[^<]{0,40}설정 페이지에서 확인/u);
  });

  it("이용 내역·접속 기록 요청을 고객센터 창구로 보낸다", () => {
    const item = usageHistoryItem();
    expect(item).toContain("접속 기록");
    expect(item).toContain("고객센터");
    // 주소는 축자로 박지 않고 한 곳(CONTACT.email)에서 가져온다 — 제6조 4항과 같은 창구.
    expect(item).toContain("CONTACT.email");
  });

  it("문서가 이름 부른 설정 화면이 설정 소스에 실제로 있다", () => {
    const item = usageHistoryItem();
    const settings = visible(read(SETTINGS));
    for (const surface of SETTINGS_SURFACES_NAMED_IN_POLICY) {
      expect(item, `제6조가 "${surface}" 를 말하지 않는다`).toContain(surface);
      expect(settings, `설정 화면에 "${surface}" 가 없다 — 문서가 없는 화면을 가리킨다`).toContain(surface);
    }
  });

  it("설정에 이용 내역 화면이 생기면 문서를 다시 쓰게 만든다", () => {
    // 이 검사가 빨개지면 위 첫 검사의 전제가 바뀐 것이다. 그때는 문서를 고치고
    // 이 검사를 지운다 — 거꾸로 문서를 그대로 두고 이 검사만 지우면 안 된다.
    expect(visible(read(SETTINGS))).not.toContain("이용 내역");
  });

  it("주석 제거기가 `//` 줄 주석과 줄 끝 주석도 걷어낸다", () => {
    // 설정 소스에는 `// 웨딩 스타일 4필드 선택지 …` 같은 줄 주석이 실제로 있다.
    // 줄 주석을 남겨 두면 화면 제목 <h3>웨딩 스타일</h3> 을 지워도 주석이 대신
    // 답해 위 검사가 초록으로 남는다(2026-09-14 실측). 반대로 `https://` 는 살아야 한다.
    const sample = [
      "// 웨딩 스타일 4필드 선택지 — 온보딩과 동일",
      'const href = "https://hanbang.ai/settings"; // 알림 설정 은 주석에만 있다',
      "<h3>커플 연결</h3>",
    ].join("\n");
    const seen = visible(sample);
    expect(seen).not.toContain("웨딩 스타일");
    expect(seen).not.toContain("알림 설정");
    expect(seen).toContain('"https://hanbang.ai/settings"');
    expect(seen).toContain("<h3>커플 연결</h3>");
  });
});
