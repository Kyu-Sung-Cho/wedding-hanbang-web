import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

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
new Function("module", "exports", compiled.outputText)(module, module.exports);
const { getPlaceCardsModel } = module.exports;

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
  });
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
  for (const dead of ["블로그 검색 {", "블로그 언급", "룸 언급 있음", "blogSnippet", "priceRange"]) {
    assert.ok(!component.includes(dead), `카드에 남아 있으면 안 되는 표시: ${dead}`);
  }
});
