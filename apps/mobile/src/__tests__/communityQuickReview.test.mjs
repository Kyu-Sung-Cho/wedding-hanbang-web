// 15초 후기 — 앱에서 누른 「후기 등록하기」가 실제로 글이 되는가.
//
// 확인한 것(2026-09-18, 3df494c35):
//   - 앱은 `Idempotency-Key` 헤더 없이 보냈다. 서버(`/api/community/posts` POST)는 헤더가 UUID 가
//     아니면 **본문을 읽기도 전에** 400 `COMMUNITY_POST_IDEMPOTENCY_REQUIRED` 를 낸다. 즉 일반·협찬
//     가리지 않고 앱의 15초 후기는 **한 건도 저장되지 않았다.**
//   - 헤더를 붙여도 「협찬」은 400 「협찬 내용을 5자 이상 입력해주세요.」 — 앱에 그 입력칸이 없었다.
//   - 고른 카테고리는 요청에 실리지 않았다(웹은 `tags: [category]`).
//   - `vendor_tags` 는 **업체 UUID 배열**이다. 저장 RPC(`community_create_post_service`)가 UUID 가 아닌
//     값을 `COMMUNITY_POST_PAYLOAD_INVALID` 로 거절한다. 그래서 적어 넣은 업체 **이름**을 여기에 넣으면
//     모든 후기가 다시 실패한다. 이름은 제목(「○○ 후기」)으로만 간다.
//   - 성공해도 방금 쓴 글이 아니라 이전 화면으로 돌아갔다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import * as quickReview from "../lib/communityQuickReview.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POST_ID = "5b0c3d2e-1f4a-4b6c-8d7e-9f0a1b2c3d4e";
const SERVER_SPONSOR_ERROR = "협찬 내용을 5자 이상 입력해주세요.";

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const baseDraft = {
  vendorName: "  라벨르 스튜디오 ",
  category: "studio",
  rating: 5,
  review: " 실장님이 친절해요 ",
  adDisclosure: "general",
  sponsorshipDetail: "",
};

test("요청 본문은 서버 계약과 같다 — 카테고리는 tags 로, 업체 이름은 vendor_tags 에 넣지 않는다", () => {
  const body = quickReview.buildQuickReviewPostBody(baseDraft);
  assert.deepEqual(body, {
    category: "tour_review",
    title: "라벨르 스튜디오 후기",
    content: "실장님이 친절해요",
    visibility: "public",
    is_quick_review: true,
    rating: 5,
    ad_disclosure: "general",
    tags: ["studio"],
    vendor_tags: [],
  });
  assert.equal(Object.hasOwn(body, "sponsorship_detail"), false, "일반 글에 협찬 내용을 싣지 않는다");

  const sponsored = quickReview.buildQuickReviewPostBody({
    ...baseDraft,
    adDisclosure: "sponsored",
    sponsorshipDetail: "  드레스 대여비 1회 제공  ",
  });
  assert.equal(sponsored.ad_disclosure, "sponsored");
  assert.equal(sponsored.sponsorship_detail, "드레스 대여비 1회 제공");

  // 협찬을 골랐다가 다시 일반으로 바꾸면 적어 둔 협찬 내용은 보내지 않는다.
  const switchedBack = quickReview.buildQuickReviewPostBody({
    ...baseDraft,
    sponsorshipDetail: "드레스 대여비 1회 제공",
  });
  assert.equal(Object.hasOwn(switchedBack, "sponsorship_detail"), false);
});

test("vendor_tags 는 저장 RPC 가 받는 업체 UUID 만 담는다 — 서버 SQL 계약과 맞춰 본다", () => {
  const sql = readSource(
    "../../../../supabase/migrations/20260804200000_community_post_service_write_boundary.sql",
  );
  // 이 정규식이 SQL 에서 빠지면 이 테스트의 전제가 바뀐 것이다. 그때 다시 판단한다.
  assert.match(sql, /p_payload -> 'vendor_tags'[\s\S]{0,400}\[0-9a-f\]\{8\}-/u);
  for (const vendorName of ["라벨르 스튜디오", "Studio A", "a"]) {
    const body = quickReview.buildQuickReviewPostBody({ ...baseDraft, vendorName });
    assert.ok(Array.isArray(body.vendor_tags));
    for (const tag of body.vendor_tags) assert.match(tag, UUID, `${tag} 는 업체 UUID 가 아니다`);
  }
});

test("협찬은 5자 이상 — 서버·웹과 같은 규칙과 같은 문구", () => {
  const server = readSource("../../../web/src/app/api/community/posts/route.ts");
  const webModal = readSource("../../../web/src/components/community/AdDisclosureModal.tsx");
  assert.ok(server.includes(SERVER_SPONSOR_ERROR), "서버 문구가 바뀌었다");
  assert.ok(webModal.includes(SERVER_SPONSOR_ERROR), "웹 문구가 바뀌었다");
  assert.match(server, /d\.length < 5/u);
  assert.equal(quickReview.QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN, 5);

  const sponsored = { ...baseDraft, adDisclosure: "sponsored" };
  for (const detail of ["", "    ", "무료", "abcd", "  abcd  "]) {
    assert.equal(
      quickReview.validateQuickReviewDraft({ ...sponsored, sponsorshipDetail: detail }),
      SERVER_SPONSOR_ERROR,
      JSON.stringify(detail),
    );
  }
  assert.equal(quickReview.validateQuickReviewDraft({ ...sponsored, sponsorshipDetail: " abcde " }), null);
  assert.equal(quickReview.validateQuickReviewDraft(baseDraft), null);
  // 일반·광고는 협찬 내용이 없어도 된다.
  assert.equal(quickReview.validateQuickReviewDraft({ ...baseDraft, adDisclosure: "ad" }), null);
});

test("빠진 칸은 순서대로 한 가지만 알린다", () => {
  assert.equal(quickReview.validateQuickReviewDraft({ ...baseDraft, vendorName: "  " }), "업체명을 입력해주세요.");
  assert.equal(quickReview.validateQuickReviewDraft({ ...baseDraft, category: "" }), "카테고리를 선택해주세요.");
  assert.equal(quickReview.validateQuickReviewDraft({ ...baseDraft, rating: 0 }), "별점을 선택해주세요.");
  assert.equal(quickReview.validateQuickReviewDraft({ ...baseDraft, review: " " }), "한줄 후기를 입력해주세요.");
});

test("같은 내용을 다시 보내면 같은 요청 키를 쓴다 — 응답을 잃어도 글이 두 번 생기지 않는다", () => {
  let n = 0;
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const submission = quickReview.createQuickReviewSubmission(() => ids[n++]);
  const first = submission.commandFor(baseDraft);
  assert.match(first.idempotencyKey, UUID);
  assert.equal(submission.commandFor({ ...baseDraft }).idempotencyKey, first.idempotencyKey);
  const changed = submission.commandFor({ ...baseDraft, review: "다른 후기" });
  assert.notEqual(changed.idempotencyKey, first.idempotencyKey, "내용이 바뀌면 새 요청이다");
  assert.equal(submission.clearIf(changed.idempotencyKey), true);
  assert.notEqual(submission.commandFor({ ...baseDraft, review: "다른 후기" }).idempotencyKey, changed.idempotencyKey);
  assert.throws(() => quickReview.createQuickReviewSubmission(() => "not-a-uuid").commandFor(baseDraft));
});

test("새 글 id 는 서버 영수증에서만 읽는다", () => {
  assert.equal(quickReview.readCreatedQuickReviewPostId({ post: { id: POST_ID }, poll_id: null, post_count: 1 }), POST_ID);
  for (const value of [null, {}, { post: null }, { post: { id: "abc" } }, { post: { id: 7 } }, { id: POST_ID }]) {
    assert.equal(quickReview.readCreatedQuickReviewPostId(value), null, JSON.stringify(value));
  }
});

// ── 화면 ────────────────────────────────────────────────────────────────

function createHooks() {
  const slots = [];
  let cursor = 0;
  return {
    reset() { cursor = 0; },
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
        const slot = slots[index];
        return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useCallback: (fn) => fn,
      useMemo: (factory) => factory(),
      useEffect: () => {},
    },
  };
}

function mountQuickReview({ respond }) {
  const hooks = createHooks();
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const token = new Proxy({}, {
    get: (_target, key) => (typeof key === "string" ? new Proxy({}, { get: () => "#000000" }) : undefined),
  });
  const alerts = [];
  const requests = [];
  const navigation = [];
  let uuid = 0;
  const source = readSource("../../app/community/quick-review.tsx");
  const compiled = ts.transpileModule(source, {
    fileName: "quick-review.tsx",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const deps = {
    react: hooks.react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      View: "View",
      ScrollView: "ScrollView",
      Pressable: "Pressable",
      ActivityIndicator: "ActivityIndicator",
      StyleSheet: { create: (value) => value },
      Alert: { alert: (...args) => alerts.push(args) },
    },
    "@/components/ui/AppText": { Text: "Text", TextInput: "TextInput" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": {
      router: {
        back: () => navigation.push(["back"]),
        replace: (to) => navigation.push(["replace", to]),
        push: (to) => navigation.push(["push", to]),
      },
    },
    "expo-crypto": {
      randomUUID: () => `0000000${uuid++}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.slice(-36),
    },
    "lucide-react-native": { Star: "Star" },
    "@hanbang/design-tokens": { colors: token, amoraIdentity: token },
    "@hanbang/shared/constants": {
      PLANNING_CATEGORY_LABELS: new Proxy({}, { get: (_target, key) => `라벨:${String(key)}` }),
    },
    "@/lib/api": {
      apiFetch: async (path, init) => {
        requests.push({ path, init });
        return respond(requests.length, { path, init });
      },
    },
    "@/components/ui/AppUI": { AppHeader: "AppHeader", PrimaryButton: "PrimaryButton" },
    "@/lib/errorCopy": {
      toKoreanErrorMessage: (error, fallback) => (error instanceof Error && /[가-힣]/u.test(error.message) ? error.message : fallback),
    },
    "@/lib/communityQuickReview.mjs": quickReview,
  };
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  const Screen = module.exports.default;

  const render = () => {
    hooks.reset();
    return Screen();
  };
  const all = (tree) => {
    const nodes = [];
    (function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      nodes.push(node);
      walk(node.props.children);
    })(tree);
    return nodes;
  };
  const textOf = (node) => {
    const parts = [];
    (function walk(value) {
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value === "string" || typeof value === "number") return void parts.push(String(value));
      if (value && typeof value === "object") walk(value.props.children);
    })(node);
    return parts.join("");
  };
  const ui = {
    alerts,
    requests,
    navigation,
    tree: () => render(),
    texts: () => all(render()).map(textOf),
    input(placeholder) {
      return all(render()).find((node) => node.type === "TextInput" && node.props.placeholder === placeholder) ?? null;
    },
    inputs: () => all(render()).filter((node) => node.type === "TextInput"),
    type(placeholder, value) {
      const input = ui.input(placeholder);
      assert.ok(input, `입력칸 「${placeholder}」 이 없다`);
      input.props.onChangeText(value);
    },
    press(label) {
      const target = all(render()).find((node) => node.type === "Pressable" && textOf(node) === label);
      assert.ok(target, `「${label}」 버튼이 없다`);
      target.props.onPress();
    },
    star(n) {
      const stars = all(render()).filter((node) => node.type === "Pressable" && all(node.props.children).some((child) => child.type === "Star"));
      assert.equal(stars.length, 5);
      stars[n - 1].props.onPress();
    },
    async submit() {
      const button = all(render()).find((node) => node.type === "PrimaryButton");
      assert.ok(button, "등록 버튼이 없다");
      button.props.onPress();
      for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
    },
  };
  return ui;
}

function fillBasics(ui) {
  ui.type("업체 이름을 입력하세요", "라벨르 스튜디오");
  ui.press("라벨:studio");
  ui.star(4);
  ui.type("한 줄로 후기를 남겨주세요", "실장님이 친절해요");
}

const created = () => ({
  ok: true,
  status: 201,
  json: async () => ({ post: { id: POST_ID, author_id: "x" }, poll_id: null, post_count: 1 }),
});

function sponsorInput(ui) {
  return ui.inputs().find((node) => node.props.accessibilityLabel === "받은 협찬 내용") ?? null;
}

test("「협찬」을 고르면 협찬 내용 입력칸이 열리고, 5자 미만이면 보내지 않는다", async () => {
  const ui = mountQuickReview({ respond: created });
  fillBasics(ui);
  assert.equal(sponsorInput(ui), null, "일반 글에는 협찬 입력칸이 없다");

  ui.press("협찬");
  const input = sponsorInput(ui);
  assert.ok(input, "협찬을 골랐는데 협찬 내용을 적을 곳이 없다 — 서버가 400 으로 거절한다");
  assert.ok(ui.texts().includes("어떤 혜택을 받았나요?"), "웹과 같은 질문으로 묻는다");
  assert.ok((input.props.maxLength ?? Infinity) <= 500, "서버는 500자에서 자른다");

  input.props.onChangeText("무료");
  await ui.submit();
  assert.equal(ui.requests.length, 0, "서버가 거절할 요청을 보내지 않는다");
  assert.deepEqual(ui.alerts.at(-1), ["알림", SERVER_SPONSOR_ERROR]);

  sponsorInput(ui).props.onChangeText("드레스 대여비 1회 제공");
  await ui.submit();
  assert.equal(ui.requests.length, 1);
  const [{ path, init }] = ui.requests;
  assert.equal(path, "/api/community/posts");
  assert.equal(init.method, "POST");
  assert.match(init.headers?.["Idempotency-Key"] ?? "", UUID, "요청 키가 없으면 서버는 무조건 400 이다");
  const body = JSON.parse(init.body);
  assert.deepEqual(body.tags, ["studio"], "고른 카테고리가 실린다");
  assert.deepEqual(body.vendor_tags, []);
  assert.equal(body.rating, 4);
  assert.equal(body.ad_disclosure, "sponsored");
  assert.equal(body.sponsorship_detail, "드레스 대여비 1회 제공");
  assert.equal(body.is_quick_review, true);

  assert.deepEqual(
    ui.navigation,
    [["replace", { pathname: "/community/post/[id]", params: { id: POST_ID } }]],
    "등록한 뒤에는 방금 쓴 글을 연다",
  );
});

test("일반 후기도 요청 키와 카테고리를 싣고, 응답을 잃으면 같은 키로 다시 보낸다", async () => {
  let attempt = 0;
  const ui = mountQuickReview({
    respond: () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Network request failed");
      return created();
    },
  });
  fillBasics(ui);
  await ui.submit();
  assert.equal(ui.navigation.length, 0, "실패했는데 글로 이동하지 않는다");
  assert.equal(ui.alerts.at(-1)?.[0], "오류");

  await ui.submit();
  assert.equal(ui.requests.length, 2);
  const [first, second] = ui.requests.map(({ init }) => init);
  assert.match(first.headers["Idempotency-Key"], UUID);
  assert.equal(second.headers["Idempotency-Key"], first.headers["Idempotency-Key"], "재시도가 글을 두 번 만들지 않는다");
  const body = JSON.parse(second.body);
  assert.deepEqual(body.tags, ["studio"]);
  assert.equal(Object.hasOwn(body, "sponsorship_detail"), false);
  assert.deepEqual(ui.navigation, [["replace", { pathname: "/community/post/[id]", params: { id: POST_ID } }]]);
});

test("서버가 성공 코드만 주고 글 id 를 안 주면 등록됐다고 말하지 않는다", async () => {
  const ui = mountQuickReview({ respond: () => ({ ok: true, status: 201, json: async () => ({ post: null }) }) });
  fillBasics(ui);
  await ui.submit();
  assert.equal(ui.navigation.length, 0);
  const [title, message] = ui.alerts.at(-1) ?? [];
  assert.equal(title, "오류");
  assert.doesNotMatch(message ?? "", /등록되었|등록됐|올렸어요/u);
});

test("서버가 거절하면 서버 문구를 보여 주고 이동하지 않는다", async () => {
  const ui = mountQuickReview({
    respond: () => ({ ok: false, status: 422, json: async () => ({ error: "연락처처럼 보이는 내용이 있어요." }) }),
  });
  fillBasics(ui);
  await ui.submit();
  assert.equal(ui.navigation.length, 0);
  assert.deepEqual(ui.alerts.at(-1), ["오류", "연락처처럼 보이는 내용이 있어요."]);
});
