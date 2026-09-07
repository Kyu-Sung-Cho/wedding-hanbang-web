import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import * as presentation from "@hanbang/shared/place-search-presentation";

const sourcePath = fileURLToPath(
  new URL("../components/chat/placeCardsModel.ts", import.meta.url),
);
const sourceText = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(sourceText, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const module = { exports: {} };
new Function("module", "exports", "require", compiled.outputText)(module, module.exports, (name) => {
  assert.equal(name, "@hanbang/shared/place-search-presentation");
  return presentation;
});
const { getPlaceCardsModel, withRoParticle } = module.exports;

test("search presentation counts rendered candidates, rejects malformed facts and keeps calendar dates across restore", () => {
  const summary = presentation.getPlaceSearchPresentation({ requestedCount: 3, resultCount: 99, orderBasis: "kind_distance" }, 2);
  assert.equal(summary.countLabel, "요청 3곳 중 2곳 표시");
  assert.ok(summary.shortageLabel.includes("요청보다 적어요"));
  assert.ok(summary.orderLabel.includes("직선거리"));
  assert.ok(summary.verificationLabel.includes("수용인원·예약 가능일·가격은 확인되지 않았어요"));
  const empty = presentation.getPlaceSearchPresentation({ requestedCount: 10 }, 0);
  assert.ok(empty.shortageLabel.includes("최대 5곳"));
  for (const requestedCount of [null, "3", 0, -1, 1.5, 21, Infinity]) {
    const safe = presentation.getPlaceSearchPresentation({ requestedCount, orderBasis: "광고 순" }, 2);
    assert.equal(safe.countLabel, "검색 결과 2곳");
    assert.equal(safe.shortageLabel, null);
    assert.ok(!safe.orderLabel.includes("광고 순"));
  }
  assert.equal(presentation.formatPlaceSearchDate("2026-09-03T15:00:00Z"), "2026.09.04 00:00");
  assert.equal(presentation.formatPlaceSearchDate("invalid"), null);
  assert.equal(presentation.formatPlaceSearchDate(null), null);
});

test("place search result keeps the fields and Naver destinations used by mobile cards", () => {
  const model = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: { query: "강남 상견례 식당" },
    toolOutput: {
      query: "강남 상견례 식당",
      places: [{
        id: "naver-1",
        name: "한방정식",
        address: "서울 강남구 테헤란로 1",
        category: "한식",
        description: "조용한 한정식 식당",
        telephone: "02-1234-5678",
        // 옛 서버가 보내던 칸들이다. 아직 흘러 들어와도 모델이 삼켜야 한다 —
        // 채울 수 없는 숫자(블로그 글 수)를 리뷰 수인 양 카드에 올리지 않는다.
        priceRange: "1인 약 5만원",
        hasPrivateRoom: true,
        blogReviewCount: 128,
        blogSnippet: "룸이 조용해서 상견례하기 좋았어요.",
        imageUrl: "https://search.pstatic.net/place.jpg",
        searchUrl: "https://search.naver.com/search.naver?query=한방정식",
        mapsUrl: "https://map.naver.com/p/search/한방정식",
        blogSearchUrl: "https://search.naver.com/search.naver?where=blog&query=한방정식",
      }],
    },
    success: true,
    displayMessage: "식당 1곳을 찾았어요.",
  });

  assert.equal(model.state, "places");
  assert.equal(model.query, "강남 상견례 식당");
  assert.deepEqual(model.places[0], {
    id: "naver-1",
    name: "한방정식",
    address: "서울 강남구 테헤란로 1",
    category: "한식",
    description: "조용한 한정식 식당",
    telephone: "02-1234-5678",
    imageUrl: "https://search.pstatic.net/place.jpg",
    searchUrl: "https://search.naver.com/search.naver?query=한방정식",
    mapsUrl: "https://map.naver.com/p/search/한방정식",
    blogSearchUrl: "https://search.naver.com/search.naver?where=blog&query=한방정식",
    regionLabel: null,
  });
});

// 2026-09-03 — 카드가 광고·제휴인지, 언제 조회한 것인지 말하지 않았다. 조회 시각은
// 실행기가 넣은 우리 값이고, 지역 딱지는 두 지역을 함께 찾았을 때만 붙는다.
test("place cards carry the KST search time and the region label the server attached", () => {
  const model = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: { query: "대전이나 청주 한정식" },
    toolOutput: {
      query: "대전이나 청주 한정식",
      // 2026-09-03 20:20 KST
      searchedAt: "2026-09-03T11:20:00.000Z",
      places: [
        { id: "naver-r0-0", name: "대전한상", address: "대전 서구 둔산로 1", category: "한정식", regionLabel: "대전" },
        { id: "naver-r1-0", name: "청주한상", address: "청주 흥덕구 대농로 1", category: "한정식", regionLabel: "청주" },
      ],
    },
    success: true,
    displayMessage: "2곳을 찾았어요.",
  });

  assert.equal(model.state, "places");
  assert.equal(model.searchedAtLabel, "2026.09.03 20:20");
  assert.deepEqual(model.places.map((place) => place.regionLabel), ["대전", "청주"]);

  const withoutTime = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: { query: "대전 한정식" },
    toolOutput: {
      query: "대전 한정식",
      places: [{ id: "naver-0", name: "대전한상", address: "대전 서구 둔산로 1", category: "한정식" }],
    },
    success: true,
    displayMessage: "1곳을 찾았어요.",
  });
  assert.equal(withoutTime.searchedAtLabel, null);
  assert.equal(withoutTime.places[0].regionLabel, null);
});

test("failed place search exposes displayMessage and invalid external URLs are discarded", () => {
  const failed = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: {},
    toolOutput: {},
    success: false,
    displayMessage: "네이버 장소 검색을 잠시 사용할 수 없어요.",
  });
  assert.deepEqual(failed, {
    state: "error",
    message: "네이버 장소 검색을 잠시 사용할 수 없어요.",
  });

  const success = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: {},
    toolOutput: {
      places: [{
        id: "unsafe-1",
        name: "테스트 식당",
        address: "서울",
        category: "한식",
        imageUrl: "https://example.com/untrusted.jpg",
        searchUrl: "https://example.com/not-naver",
        mapsUrl: "https://map.naver.com/p/search/test",
        blogSearchUrl: "data:text/html,bad",
      }],
    },
    success: true,
    displayMessage: "",
  });

  assert.equal(success.state, "places");
  assert.equal(success.places[0].imageUrl, null);
  assert.equal(success.places[0].searchUrl, null);
  assert.equal(success.places[0].mapsUrl, "https://map.naver.com/p/search/test");
  assert.equal(success.places[0].blogSearchUrl, null);
});

test("API HUB outage becomes a safe Naver search handoff", () => {
  const model = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: { query: "강남 상견례 식당" },
    toolOutput: {
      query: "강남 상견례 식당",
      places: [],
      providerUnavailable: true,
      handoff: {
        searchUrl: "https://search.naver.com/search.naver?query=강남",
        mapsUrl: "https://map.naver.com/p/search/강남",
      },
    },
    success: false,
    displayMessage: "네이버 검색으로 바로 이어드릴게요.",
  });

  assert.deepEqual(model, {
    state: "handoff",
    query: "강남 상견례 식당",
    searchUrl: "https://search.naver.com/search.naver?query=강남",
    mapsUrl: "https://map.naver.com/p/search/강남",
    message: "검색 결과 연결이 지연되고 있어 네이버의 최신 검색 화면으로 바로 이어드려요.",
  });
});

test("place cards only accept HTTPS Naver links and HTTPS pstatic images", () => {
  const model = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: {},
    toolOutput: {
      places: [{
        id: "secure-1",
        name: "보안 테스트",
        address: "서울",
        category: "한식",
        imageUrl: "http://search.pstatic.net/insecure.jpg",
        searchUrl: "http://search.naver.com/search.naver?query=test",
        mapsUrl: "https://naver.com.evil.example/p/search/test",
        blogSearchUrl: "https://m.search.naver.com/search.naver?where=blog&query=test",
      }],
    },
    success: true,
    displayMessage: "",
  });

  assert.equal(model.state, "places");
  assert.equal(model.places[0].imageUrl, null);
  assert.equal(model.places[0].searchUrl, null);
  assert.equal(model.places[0].mapsUrl, null);
  assert.equal(
    model.places[0].blogSearchUrl,
    "https://m.search.naver.com/search.naver?where=blog&query=test",
  );
});

test("mobile place cards expose accessible Naver links and a broken-image fallback", () => {
  const componentPath = fileURLToPath(
    new URL("../components/chat/PlaceCards.tsx", import.meta.url),
  );
  const component = readFileSync(componentPath, "utf8");

  assert.ok(component.includes("Linking.openURL"));
  assert.ok(component.includes('accessibilityRole="link"'));
  assert.ok(component.includes('accessibilityRole="alert"'));
  assert.ok(component.includes("onError="));
  assert.ok(component.includes("사진을 불러오지 못했어요"));
  assert.ok(component.includes("네이버 검색"));
  assert.ok(component.includes("네이버 지도에서 보기"));
  assert.ok(component.includes("지도"));
  assert.ok(component.includes("블로그"));
  assert.ok(!component.includes(">단독룸<"));
  assert.ok(component.includes("전화"));

  // 리뷰 수·별점은 네이버 지역 API 가 주지 않는다. 블로그 글 수를 그 자리에
  // 놓으면 다른 숫자를 리뷰 수로 읽게 된다 — 카드는 대신 어디서 볼 수 있는지
  // 말한다(2026-08-23 파운더 결정).
  assert.ok(component.includes("눌러서 네이버에서 리뷰·별점 보기"));
  assert.ok(component.includes("리뷰 수·별점과 가격은 카드를 눌러 네이버에서 확인해 주세요"));
  // 광고·제휴가 아니라는 사실과 조회 시각은 웹 카드와 같은 문장으로 나간다 —
  // 한쪽만 고치면 표면이 갈린다(2026-09-03).
  assert.ok(component.includes("네이버 지역검색 일반 결과예요(광고·제휴 아님)"));
  assert.ok(component.includes("조회 시각은 ${model.searchedAtLabel} (한국 시간)입니다"));
  for (const dead of ["블로그 검색 {", "블로그 언급", "룸 언급 있음", "blogSnippet", "priceRange"]) {
    assert.ok(!component.includes(dead), `카드에 남아 있으면 안 되는 표시: ${dead}`);
  }
});

// 2026-09-03 감사 — 새로고침하면 카드가 통째로 사라졌다. 네이버 항목은 여전히
// 저장하지 않고, 우리 값만(질의·조회 시각·개수) 저장해 자리표시 카드를 그린다.
test("saved place search results become a placeholder card, not an empty search", () => {
  const model = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: {},
    toolOutput: {
      places: [],
      query: "대전 식당 예식",
      resultCount: 4,
      // 2026-09-03 10:20 KST
      searchedAt: "2026-09-03T01:20:00.000Z",
      displayOnlyPlaceholder: true,
    },
    success: true,
    displayMessage: "",
  });

  assert.deepEqual(model, {
    state: "placeholder",
    query: "대전 식당 예식",
    resultCount: 4,
    searchedAtLabel: "2026.09.03 10:20",
  });
});

test("wedding venue queries render as a neutral notice, not an error card", () => {
  const model = getPlaceCardsModel({
    toolName: "search_nearby_places",
    toolInput: { query: "대전 웨딩홀" },
    toolOutput: {
      places: [],
      query: "대전 웨딩홀",
      reason: "wedding_vendor_query_blocked",
      resultCount: 0,
    },
    success: false,
    displayMessage: "예식장·웨딩홀은 여기서 검색하지 않고 업체 탐색에서 볼 수 있어요.",
  });

  assert.deepEqual(model, {
    state: "notice",
    title: "예식장·웨딩홀은 업체 탐색에서 볼 수 있어요",
    message: "예식장·웨딩홀은 여기서 검색하지 않고 업체 탐색에서 볼 수 있어요.",
  });
});

test("the restore card picks the particle the way the web card does", () => {
  assert.equal(withRoParticle("대전 식당 예식"), "으로");
  assert.equal(withRoParticle("대전 카페"), "로");
  // 받침이 ㄹ 이면 '로'. "서울"로.
  assert.equal(withRoParticle("서울"), "로");
  assert.equal(withRoParticle(""), "로");
});

test("mobile place cards draw the placeholder and the neutral notice", () => {
  const componentPath = fileURLToPath(
    new URL("../components/chat/PlaceCards.tsx", import.meta.url),
  );
  const component = readFileSync(componentPath, "utf8");

  assert.ok(component.includes('model.state === "placeholder"'));
  assert.ok(component.includes('model.state === "notice"'));
  assert.ok(component.includes("검색 결과 카드는 저장하지 않아서 다시 열면 사라져요"));
  assert.ok(component.includes("withRoParticle(model.query)"));
});
