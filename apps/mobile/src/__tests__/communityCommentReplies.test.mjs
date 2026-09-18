// 커뮤니티 답글 — 서버가 보낸 답글이 앱 화면에 나오는가.
//
// 확인한 것(2026-09-18, 3df494c35):
//   - `GET /api/community/comments` 는 최상위 답변마다 `replies` 배열을 붙여 보낸다(1단계만).
//   - 앱 글 화면(`app/community/post/[id].tsx`)은 최상위 답변만 그렸다. 답글은 읽고 버렸다 —
//     웹에서 단 답글이 앱에서는 한 줄도 보이지 않았고, 답글의 작성 출처 표시·신고 메뉴도 없었다.
//   - 웹 `CommentItem` 은 지운 글을 「삭제된 답변입니다」·「삭제된 답글입니다」로 바꿔 그린다.
//     지금 서버 GET 은 지운 글을 아예 빼고 보내므로 이 자리표시는 서버가 `is_deleted` 를 실어 보낼
//     때만 쓰인다. 그래도 지운 글의 **본문을 그리지 않는 것**은 앱이 스스로 지킨다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

import * as thread from "../lib/communityCommentThread.mjs";

function readSource(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function raw(id, authorId, content, extra = {}) {
  return {
    id,
    post_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    author_id: authorId,
    parent_id: null,
    content,
    content_origin: "member",
    is_deleted: false,
    created_at: "2026-09-18T00:00:00.000Z",
    author: { nickname: `닉-${authorId.slice(0, 4)}`, rank: "member" },
    ...extra,
  };
}

const serverPayload = () => [
  {
    ...raw("c1", ALICE, "첫 답변"),
    replies: [
      raw("r1", BOB, "첫 답글", { parent_id: "c1" }),
      raw("r2", VIEWER, "내 답글", { parent_id: "c1", content_origin: "ai" }),
    ],
  },
  { ...raw("c2", BOB, "둘째 답변"), replies: [] },
];

test("서버가 보낸 답글을 버리지 않고 부모 아래에 순서대로 붙인다", () => {
  const comments = thread.parseCommunityCommentThread(serverPayload());
  assert.deepEqual(comments.map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(comments[0].replies.map((r) => [r.id, r.content, r.content_origin]), [
    ["r1", "첫 답글", "member"],
    ["r2", "내 답글", "ai"],
  ]);
  assert.deepEqual(comments[1].replies, []);
  // 답글의 답글은 서버가 막는다(1단계). 앱도 더 깊이 그리지 않는다.
  for (const reply of comments[0].replies) assert.deepEqual(reply.replies, []);
});

test("replies 가 없는 옛 응답은 답글 없음으로 읽는다", () => {
  const legacy = serverPayload().map((comment) => {
    const copy = { ...comment };
    delete copy.replies;
    return copy;
  });
  const comments = thread.parseCommunityCommentThread(legacy);
  assert.deepEqual(comments.map((c) => c.replies.length), [0, 0]);
});

test("답글의 작성 출처가 깨져 있으면 최상위 답변처럼 목록 전체를 실패로 처리한다", () => {
  const payload = serverPayload();
  payload[0].replies[0].content_origin = "verified_expert";
  assert.throws(() => thread.parseCommunityCommentThread(payload));
  assert.throws(() => thread.parseCommunityCommentThread({ comments: [] }));
});

test("지운 글은 본문을 들고 다니지 않고, 그 아래 답글은 남긴다", () => {
  const payload = serverPayload();
  payload[0].is_deleted = true;
  payload[0].content = "지우기 전 원문";
  payload[0].replies[0].is_deleted = true;
  payload[0].replies[0].content = "지운 답글 원문";
  const [deleted] = thread.parseCommunityCommentThread(payload);
  assert.equal(deleted.is_deleted, true);
  assert.equal(deleted.content, "");
  assert.equal(deleted.replies.length, 2);
  assert.equal(deleted.replies[0].is_deleted, true);
  assert.equal(deleted.replies[0].content, "");
  assert.equal(deleted.replies[1].content, "내 답글");
});

test("지운 글 자리표시는 웹과 같은 말이다", () => {
  const web = readSource("../../../web/src/components/community/CommentItem.tsx");
  assert.ok(web.includes('삭제된 {isReply ? "답글" : "답변"}입니다'), "웹 문구가 바뀌었다");
  assert.equal(thread.communityDeletedCommentLabel(false), "삭제된 답변입니다");
  assert.equal(thread.communityDeletedCommentLabel(true), "삭제된 답글입니다");
});

test("댓글 수는 답글까지 세고 지운 글은 세지 않는다", () => {
  const payload = serverPayload();
  assert.equal(thread.countVisibleCommunityComments(thread.parseCommunityCommentThread(payload)), 4);
  payload[0].is_deleted = true;
  assert.equal(thread.countVisibleCommunityComments(thread.parseCommunityCommentThread(payload)), 3);
});

test("차단하면 그 사람의 답변과 답글을 함께 숨긴다 — 웹 removeBlockedAuthors 와 같다", () => {
  const comments = thread.parseCommunityCommentThread(serverPayload());
  const hiddenBob = thread.hideCommunityCommentsByAuthor(comments, BOB.toUpperCase());
  assert.deepEqual(hiddenBob.comments.map((c) => c.id), ["c1"]);
  assert.deepEqual(hiddenBob.comments[0].replies.map((r) => r.id), ["r2"]);
  assert.equal(hiddenBob.removedCount, 2);

  // 부모를 숨기면 그 아래 답글도 함께 빠진다(웹과 같고, 다시 불러왔을 때 서버 결과와도 같다).
  const hiddenAlice = thread.hideCommunityCommentsByAuthor(comments, ALICE);
  assert.deepEqual(hiddenAlice.comments.map((c) => c.id), ["c2"]);
  assert.equal(hiddenAlice.removedCount, 3);
  assert.equal(comments[0].replies.length, 2, "원본 목록은 바꾸지 않는다");
});

// ── 그리기 ──────────────────────────────────────────────────────────────

function renderItem(comment, { viewerOwnerId = VIEWER } = {}) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const token = new Proxy({}, {
    get: (_target, key) => (typeof key === "string" ? new Proxy({}, { get: () => "#000000" }) : undefined),
  });
  const compiled = ts.transpileModule(readSource("../components/community/CommunityCommentItem.tsx"), {
    fileName: "CommunityCommentItem.tsx",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const deps = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "View", Pressable: "Pressable", StyleSheet: { create: (value) => value } },
    "@/components/ui/AppText": { Text: "Text" },
    "lucide-react-native": { MoreHorizontal: "MoreHorizontal" },
    "@hanbang/design-tokens": { colors: token },
    "@/components/community/CommunityAvatar": { CommunityAvatar: "CommunityAvatar" },
    "@/components/community/CommunityTrustBadges": { CommunityTrustBadges: "CommunityTrustBadges" },
    "@/lib/communityCommentThread.mjs": thread,
  };
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  const opened = [];
  const Item = module.exports.CommunityCommentItem;
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (node.type === Item) return expand(Item(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const tree = expand(Item({
    comment,
    viewerOwnerId,
    timeLabel: () => "방금",
    onOpenSafetyMenu: (target) => opened.push(target),
  }));
  const nodes = [];
  (function walk(node, path) {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, path));
    if (!node || typeof node !== "object") return;
    nodes.push({ node, path });
    walk(node.props.children, [...path, node]);
  })(tree, []);
  const textOf = (node) => {
    const parts = [];
    (function walk(value) {
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value === "string" || typeof value === "number") return void parts.push(String(value));
      if (value && typeof value === "object") walk(value.props.children);
    })(node);
    return parts.join("");
  };
  const texts = nodes.filter(({ node }) => node.type === "Text").map(({ node }) => textOf(node));
  return { nodes, texts, opened, textOf };
}

function indentOf(path) {
  return path.reduce((sum, node) => {
    const styles = [node.props.style].flat(Infinity).filter(Boolean);
    return sum + styles.reduce((acc, style) => acc + (style.marginLeft ?? 0) + (style.paddingLeft ?? 0), 0);
  }, 0);
}

test("답글은 부모 답변 아래에 들여 써서 그리고, 답글마다 작성 출처와 신고 메뉴가 있다", () => {
  const [comment] = thread.parseCommunityCommentThread(serverPayload());
  const { nodes, texts, opened, textOf } = renderItem(comment);

  assert.ok(texts.includes("첫 답변"));
  assert.ok(texts.includes("첫 답글"), "답글이 화면에 없다");
  assert.ok(texts.includes("내 답글"));

  const bodyNode = (content) => nodes.find(({ node }) => node.type === "Text" && textOf(node) === content);
  assert.ok(
    indentOf(bodyNode("첫 답글").path) > indentOf(bodyNode("첫 답변").path),
    "답글이 부모와 같은 깊이에 붙어 있으면 누구에게 단 말인지 알 수 없다",
  );

  const badges = nodes.filter(({ node }) => node.type === "CommunityTrustBadges").map(({ node }) => node.props.contentOrigin);
  assert.deepEqual(badges, ["member", "member", "ai"], "답글도 작성 출처(AI 여부)를 보인다");

  const menus = nodes.filter(({ node }) => node.type === "Pressable" && /안전 메뉴$/u.test(node.props.accessibilityLabel ?? ""));
  assert.deepEqual(menus.map(({ node }) => node.props.accessibilityLabel), [
    `닉-bbbb님 답변 안전 메뉴`,
    `닉-cccc님 답글 안전 메뉴`,
  ], "내가 쓴 답글에는 신고 메뉴를 달지 않는다");
  for (const { node } of menus) {
    assert.equal(node.props.accessibilityRole, "button");
    assert.ok((node.props.style?.width ?? 0) + 2 * (node.props.hitSlop ?? 0) >= 44, "누를 자리가 44pt 보다 작다");
    node.props.onPress();
  }
  assert.deepEqual(opened, [
    { kind: "comment", contentId: "c1", userId: ALICE, nickname: "닉-bbbb" },
    { kind: "comment", contentId: "r1", userId: BOB, nickname: "닉-cccc" },
  ]);
});

test("지운 답변은 자리표시만 남기고 작성자·본문·메뉴를 그리지 않는다. 답글은 계속 보인다", () => {
  const payload = serverPayload();
  payload[0].is_deleted = true;
  payload[0].content = "지우기 전 원문";
  const [comment] = thread.parseCommunityCommentThread(payload);
  const { nodes, texts, opened } = renderItem(comment);

  assert.ok(texts.includes("삭제된 답변입니다"));
  assert.ok(!texts.some((text) => text.includes("지우기 전 원문")));
  assert.ok(!texts.includes("닉-bbbb"), "지운 글의 작성자를 드러내지 않는다");
  assert.ok(texts.includes("첫 답글"), "부모를 지워도 다른 사람의 답글은 남는다");
  const menus = nodes.filter(({ node }) => node.type === "Pressable" && /안전 메뉴$/u.test(node.props.accessibilityLabel ?? ""));
  assert.deepEqual(menus.map(({ node }) => node.props.accessibilityLabel), ["닉-cccc님 답글 안전 메뉴"]);
  assert.deepEqual(opened, []);

  const deletedReply = thread.parseCommunityCommentThread([
    { ...raw("c9", ALICE, "살아 있는 답변"), replies: [raw("r9", BOB, "지운 답글 원문", { parent_id: "c9", is_deleted: true })] },
  ])[0];
  const reply = renderItem(deletedReply);
  assert.ok(reply.texts.includes("삭제된 답글입니다"));
  assert.ok(!reply.texts.some((text) => text.includes("지운 답글 원문")));
});

test("글 화면은 서버 답글을 읽어 CommunityCommentItem 으로 그리고, 차단도 답글까지 반영한다", () => {
  const screen = readSource("../../app/community/post/[id].tsx");
  const fetchStart = screen.indexOf("async function fetchCommentsFromApi");
  const fetchBody = screen.slice(fetchStart, screen.indexOf("export default function", fetchStart));
  assert.match(fetchBody, /parseCommunityCommentThread\(commentsData\.comments\)/u);
  assert.match(screen, /<CommunityCommentItem[\s\S]*?comment=\{c\}[\s\S]*?onOpenSafetyMenu=\{openSafetyMenu\}/u);
  // 화면 상태를 바꾸는 쪽이 답글까지 숨겨야 한다(개수만 세고 목록은 최상위만 거르면 안 된다).
  assert.match(
    screen,
    /setComments\(\(current\) => hideCommunityCommentsByAuthor\(current, target\.userId\)\.comments\)/u,
  );
  assert.doesNotMatch(screen, /setComments\(\(current\) => current\.filter/u);
  assert.match(screen, /countVisibleCommunityComments\(comments\)/u);
});
