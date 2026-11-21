// @vitest-environment node

/**
 * 서버가 직접 부르는 외부 사업자가 처리방침 제5조 위탁표에 있는가.
 *
 * ## 무엇이 있었나 (2026-11-22)
 *
 * 아모라의 장소 찾기(`lib/ai/tools/placeSearchTools.ts`)는 사용자 검색어를 NAVER API HUB
 * (`naverapihub.apigw.ntruss.com`, 운영 사업자 네이버클라우드)로 보낸다. 그런데 처리방침에는
 * "네이버"가 한 번도 나오지 않았다(origin/main `c8d8c952c` 에서 확인). API HUB 약관 일반조건
 * 7.4 ⑦ 은 이용고객 개인정보가 네이버·네이버클라우드로 갈 수 있으면 처리위탁 또는 제3자 제공에
 * 맞는 고지·동의를 거치라고 정한다.
 *
 * ## 왜 기존 검사가 못 잡았나
 *
 * `crossBorderTransferNotice.test.ts` 는 CSP 에서 외부 호스트를 유도한다. 서버가 직접 부르는
 * 곳은 CSP 에 나오지 않으므로 손으로 고정한 `SERVER_SIDE_PROCESSORS`(Vercel·OpenAI·Resend)만
 * 봤다. CSP 에 있는 `*.pstatic.net` 은 장소 사진을 브라우저가 받아 오는 CDN 이고 검색어를 받는
 * 곳이 아니다. 그래서 검색어가 나가는 길은 어느 목록에도 없었다.
 *
 * ## 이 검사는 코드를 돌린다
 *
 * 소스에서 주소를 긁지 않는다. 장소 찾기 실행기를 실제로 부르고 `fetch` 가 받은 주소의 호스트를
 * 모은다. 호스트마다 `SERVER_HOST_DISCLOSURE` 에 분류가 있어야 하고, 분류한 사업자는 위탁표에
 * 자기 줄이 있어야 한다. 실행기가 다른 곳으로 보내기 시작하면(예: 다른 네이버 API 로 옮기면)
 * 분류되지 않은 호스트가 생겨 여기서 멈춘다.
 *
 * 방침은 파일을 읽어서 보되 주석은 걷어낸다. 이 파일의 주석은 왜 바꿨는지 적느라 사업자 이름을
 * 그대로 쓰므로, 걷어내지 않으면 주석이 표 대신 대답한다.
 *
 * ### 못 잡는 것
 *
 * - 돌리는 실행기는 `PROBES` 에 적은 것뿐이다. 다른 기능이 서버에서 새 외부 사업자를 부르면 그
 *   실행기를 `PROBES` 에 더해야 여기서 보인다.
 * - `fetch` 로 나가는 요청만 센다.
 * - 표에 그 사업자의 줄이 있고 위탁 업무 칸이 비어 있지 않은지까지만 본다. 그 칸의 문장이
 *   실제 업무와 맞는지는 사람이 본다(방침 문장은 파운더 승인 대상이다).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { executeSearchNearbyPlaces } from "@/lib/ai/tools/placeSearchTools";

const source = readFileSync(
  resolve(process.cwd(), "src/app/privacy/page.tsx"),
  "utf8",
);

/** 주석을 걷어낸 소스. `crossBorderTransferNotice.test.ts` 와 같은 규칙이다. */
const visible = source
  .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
  .replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * 머리 칸 글자로 표를 하나 골라 줄마다 칸 글자를 돌려준다.
 *
 * 몇 번째 표인지로 고르지 않는다. 표가 늘거나 자리가 바뀌면 다른 표를 재게 된다.
 * 칸 안의 태그(연락처 링크 등)는 벗기고 글자만 남긴다.
 */
function tableRows(header: string): string[][] {
  const tables = (visible.match(/<table[\s\S]*?<\/table>/gu) ?? [])
    .filter((table) => table.includes(`>${header}</th>`));
  expect(tables, `머리 칸이 "${header}" 인 표가 정확히 하나여야 합니다`).toHaveLength(1);

  const body = tables[0].match(/<tbody[\s\S]*?<\/tbody>/u)?.[0] ?? "";
  return (body.match(/<tr[\s\S]*?<\/tr>/gu) ?? []).map((row) =>
    [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)].map((cell) =>
      cell[1].replace(/<[^>]+>/gu, "").trim(),
    ),
  );
}

type ServerHostDisclosure = {
  /** 제5조 위탁표의 "수탁 업체" 칸에 적힌 이름 그대로. */
  processor: string;
  /** 국외 이전표에도 올리는 사업자인가. 국내 사업자는 false 이고, 그러면 국외 이전표에 없어야 한다. */
  crossBorder: boolean;
};

/**
 * 서버가 직접 요청을 보내는 외부 호스트와 그 사업자.
 *
 * 여기 없는 호스트로 요청이 나가면 빨간불이다. 그게 요점이다.
 */
const SERVER_HOST_DISCLOSURE: Record<string, ServerHostDisclosure> = {
  // NAVER API HUB 지역·이미지 검색. 사용자 검색어가 쿼리 문자열로 간다. 국내 사업자다.
  "naverapihub.apigw.ntruss.com": { processor: "네이버클라우드(주)", crossBorder: false },
};

type Probe = { name: string; run: () => Promise<unknown> };

/** 서버에서 외부로 요청을 보내는 실행기. 새 실행기가 외부 사업자를 부르면 여기 더한다. */
const PROBES: readonly Probe[] = [
  {
    name: "아모라 장소 찾기(search_nearby_places)",
    // 기준점("강남역")이 있는 검색어라 본 검색·기준점 조회·사진 검색이 모두 나간다.
    run: () => executeSearchNearbyPlaces({ query: "강남역 한정식" }),
  },
];

/** 실행기가 "설정됨" 으로 판단하게 하는 가짜 자격증명. 요청은 모두 아래 가짜 fetch 가 받는다. */
const PROBE_ENV: Record<string, string> = {
  NAVER_API_HUB_CLIENT_ID: "processor-notice-probe-id",
  NAVER_API_HUB_CLIENT_SECRET: "processor-notice-probe-secret",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** 지역 검색에는 식당 한 곳을, 그 밖에는 빈 목록을 준다. 후보가 있어야 사진 검색까지 나간다. */
function fakeResponse(url: URL): Response {
  if (!url.pathname.endsWith("/local")) return jsonResponse({ items: [] });
  return jsonResponse({
    items: [
      {
        title: "<b>시험한정식</b>",
        link: "https://example.com/place",
        category: "음식점>한식>한정식",
        description: "한정식",
        telephone: "02-000-0000",
        address: "서울 강남구 테헤란로 1",
        roadAddress: "서울 강남구 테헤란로 1",
        mapx: "1270276000",
        mapy: "374979000",
      },
    ],
  });
}

type ObservedRequest = { probe: string; url: URL };

/**
 * 실행기를 하나씩 돌리고 `fetch` 가 받은 주소를 실행기 이름과 함께 돌려준다.
 * 실행기를 차례로 돌리므로 요청마다 어느 실행기가 보냈는지 정확하다.
 * 환경변수와 전역 fetch 는 되돌린다.
 */
async function observeRequests(): Promise<ObservedRequest[]> {
  const saved = Object.fromEntries(
    Object.keys(PROBE_ENV).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, PROBE_ENV);

  const requests: ObservedRequest[] = [];
  let running = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ probe: running, url });
      return fakeResponse(url);
    }),
  );

  try {
    for (const probe of PROBES) {
      running = probe.name;
      await probe.run();
    }
  } finally {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return requests;
}

describe("서버가 직접 부르는 외부 사업자와 처리방침 제5조", () => {
  let requests: ObservedRequest[] = [];

  beforeAll(async () => {
    requests = await observeRequests();
  });

  it("실행기마다 실제로 외부에 요청을 보낸다", () => {
    // 0건이면 아래 검사가 전부 헛초록불이다. 자격증명 이름이 바뀌어 실행기가 요청 전에
    // 돌아가 버려도 여기서 멈춘다.
    for (const probe of PROBES) {
      const sent = requests.filter((request) => request.probe === probe.name).length;
      expect(sent, `${probe.name} 가 요청을 하나도 보내지 않았습니다`).toBeGreaterThan(0);
    }
  });

  it("요청이 나간 호스트가 모두 분류돼 있다", () => {
    const hosts = [...new Set(requests.map((request) => request.url.host))].sort();
    const unclassified = hosts.filter((host) => !(host in SERVER_HOST_DISCLOSURE));
    expect(
      unclassified,
      `서버가 새 외부 호스트로 요청을 보냅니다: ${unclassified.join(", ")}. `
        + "그 사업자를 처리방침 제5조 위탁표에 적고 SERVER_HOST_DISCLOSURE 에 더하세요.",
    ).toEqual([]);
  });

  it("분류표가 실제 요청과 붙어 있다", () => {
    // 요청이 더는 안 나가는데 분류만 남으면, 그 분류는 아무것도 지키지 않는다.
    const hosts = new Set(requests.map((request) => request.url.host));
    const stale = Object.keys(SERVER_HOST_DISCLOSURE).filter((host) => !hosts.has(host));
    expect(
      stale,
      `요청이 나가지 않는 호스트가 분류표에 남아 있습니다: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("두 표를 칸 단위로 읽어 낸다", () => {
    // 읽기가 조용히 빈 목록을 내면 "국외 이전표에 없다" 가 무조건 통과한다. 모양과
    // 늘 있는 줄 하나(Supabase)로 하한을 박는다.
    const entrusted = tableRows("위탁 업무");
    const transferred = tableRows("이전받는 자");
    expect(entrusted.every((cells) => cells.length === 2)).toBe(true);
    expect(transferred.every((cells) => cells.length === 4)).toBe(true);
    expect(entrusted.map((cells) => cells[0])).toContain("Supabase, Inc.");
    expect(transferred.map((cells) => cells[0])).toContain("Supabase, Inc.");
  });

  it("분류한 사업자마다 위탁표에 자기 줄이 있다", () => {
    const rows = tableRows("위탁 업무");
    for (const { processor } of Object.values(SERVER_HOST_DISCLOSURE)) {
      const row = rows.find((cells) => cells[0] === processor);
      expect(row, `위탁표에 ${processor} 줄이 없습니다`).toBeDefined();
      expect(row?.[1] ?? "", `${processor} 줄의 위탁 업무 칸이 비어 있습니다`).not.toBe("");
    }
  });

  it("국외 이전표에 오르는지가 분류와 맞다", () => {
    const transferees = tableRows("이전받는 자").map((cells) => cells[0]);
    for (const { processor, crossBorder } of Object.values(SERVER_HOST_DISCLOSURE)) {
      expect(
        transferees.includes(processor),
        crossBorder
          ? `${processor} 는 국외 사업자인데 국외 이전표에 없습니다`
          : `${processor} 는 국내 사업자인데 국외 이전표에 있습니다`,
      ).toBe(crossBorder);
    }
  });
});
