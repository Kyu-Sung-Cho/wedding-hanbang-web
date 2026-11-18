import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { PROFILE_AVATAR_EMOJIS, getProfileInitial } from "@hanbang/shared/profile-avatar";
import {
  EMPTY_CHAT_PARTICIPANT_PRESENTATION,
  chatSenderAvatarName,
  confirmedRoleBubbleTone,
  readChatParticipantPresentation,
  resolveChatSenderPresentation,
} from "../lib/chatParticipantPresentation.mjs";
import { parseProfileAvatarUrl, profileAvatarDisplay } from "../lib/profileAvatarPresentation.mjs";

// 2026-09-12 요청: 모바일 채팅도 웹처럼 각 사람이 직접 확인한 표시 역할로 말풍선을 칠하고,
// 상대 자리에 사람 아이콘 대신 이름 첫 글자·고른 이모지·사진을 보인다.

const SELF = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const COUPLE = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const photoPath = (userId, version = VERSION) => `/api/profile/avatar/image?userId=${userId}&version=${version}`;

function mePayload(overrides = {}) {
  return {
    user: { id: SELF },
    profile: { id: SELF, name: "나", role: "bride", couple_id: COUPLE, confirmed_role: "groom", avatar_url: "🌷" },
    partner: { id: PARTNER, name: "상대", role: "groom", couple_id: COUPLE, confirmed_role: "bride", avatar_url: photoPath(PARTNER) },
    ...overrides,
  };
}

test("tone follows the web rule: groom sky, bride rose, anything else neutral", () => {
  assert.equal(confirmedRoleBubbleTone("groom"), "sky");
  assert.equal(confirmedRoleBubbleTone("bride"), "rose");
  for (const value of [null, undefined, "", "partner", "GROOM", 1, {}]) {
    assert.equal(confirmedRoleBubbleTone(value), "neutral");
  }
  // 웹 정본과 같은 규칙인지 소스에서 확인한다 — 한쪽만 바뀌면 두 화면 색이 갈린다.
  const web = readFileSync(new URL("../../../web/src/components/app/chat/chatBubbleStyles.ts", import.meta.url), "utf8");
  assert.match(web, /confirmedRole === "groom" \? "sky" : confirmedRole === "bride" \? "rose" : "neutral"/u);
});

test("presentation reads confirmed roles, never the signup role slot", () => {
  const presentation = readChatParticipantPresentation(mePayload(), { selfId: SELF, partnerId: PARTNER, coupleId: COUPLE });
  assert.equal(presentation.selfConfirmedRole, "groom");
  assert.equal(presentation.partnerConfirmedRole, "bride");
  assert.equal(presentation.selfAvatarUrl, "🌷");
  assert.equal(presentation.partnerAvatarUrl, photoPath(PARTNER));

  const unconfirmed = readChatParticipantPresentation(mePayload({
    profile: { id: SELF, role: "bride", couple_id: COUPLE },
    partner: { id: PARTNER, role: "groom", couple_id: COUPLE },
  }), { selfId: SELF, partnerId: PARTNER, coupleId: COUPLE });
  assert.equal(unconfirmed.selfConfirmedRole, null, "role 슬롯만 있으면 확인 전이다");
  assert.equal(unconfirmed.partnerConfirmedRole, null);
});

test("presentation drops data that does not belong to the session, couple, or verified partner", () => {
  const expected = { selfId: SELF, partnerId: PARTNER, coupleId: COUPLE };
  assert.equal(readChatParticipantPresentation(mePayload({ user: { id: OTHER } }), expected), EMPTY_CHAT_PARTICIPANT_PRESENTATION);
  assert.equal(readChatParticipantPresentation(mePayload({ profile: { ...mePayload().profile, id: OTHER } }), expected), EMPTY_CHAT_PARTICIPANT_PRESENTATION);
  assert.equal(readChatParticipantPresentation(mePayload({ profile: { ...mePayload().profile, couple_id: OTHER } }), expected), EMPTY_CHAT_PARTICIPANT_PRESENTATION);
  assert.equal(readChatParticipantPresentation(null, expected), EMPTY_CHAT_PARTICIPANT_PRESENTATION);

  const swappedPartner = readChatParticipantPresentation(mePayload({ partner: { ...mePayload().partner, id: OTHER } }), expected);
  assert.equal(swappedPartner.partnerId, null);
  assert.equal(swappedPartner.partnerConfirmedRole, null);
  assert.equal(swappedPartner.partnerAvatarUrl, null);
  assert.equal(swappedPartner.selfConfirmedRole, "groom");

  const unlinked = readChatParticipantPresentation(mePayload(), { selfId: SELF, partnerId: null, coupleId: COUPLE });
  assert.equal(unlinked.partnerId, null);
  assert.equal(unlinked.partnerConfirmedRole, null);

  // 상대 응답에 다른 사람의 사진 경로가 섞이면 쓰지 않는다(토큰을 실어 보낼 주소를 응답이 고르지 못하게).
  const foreignPhoto = readChatParticipantPresentation(mePayload({ partner: { ...mePayload().partner, avatar_url: photoPath(OTHER) } }), expected);
  assert.equal(foreignPhoto.partnerAvatarUrl, null);
});

test("each message uses its own sender's tone; legacy messages without sender_id stay neutral", () => {
  const presentation = readChatParticipantPresentation(mePayload(), { selfId: SELF, partnerId: PARTNER, coupleId: COUPLE });
  assert.deepEqual(resolveChatSenderPresentation({ isAi: false, senderId: SELF, presentation }), { tone: "sky", avatarUrl: "🌷", avatarOwnerId: SELF });
  assert.deepEqual(resolveChatSenderPresentation({ isAi: false, senderId: PARTNER, presentation }), { tone: "rose", avatarUrl: photoPath(PARTNER), avatarOwnerId: PARTNER });
  assert.equal(resolveChatSenderPresentation({ isAi: true, senderId: null, presentation }).tone, "amora");
  assert.deepEqual(resolveChatSenderPresentation({ isAi: false, senderId: null, presentation }), { tone: "neutral", avatarUrl: null, avatarOwnerId: null });
  assert.equal(resolveChatSenderPresentation({ isAi: false, senderId: OTHER, presentation }).tone, "neutral");
  assert.equal(resolveChatSenderPresentation({ isAi: false, senderId: SELF, presentation: EMPTY_CHAT_PARTICIPANT_PRESENTATION }).tone, "neutral");
});

test("avatar name is given only to verified self or partner messages", () => {
  const base = { selfId: SELF, selfName: "나", partnerId: PARTNER, partnerName: "하늘" };
  assert.equal(chatSenderAvatarName({ ...base, senderId: PARTNER }), "하늘");
  assert.equal(chatSenderAvatarName({ ...base, senderId: SELF }), "나");
  assert.equal(chatSenderAvatarName({ ...base, senderId: null }), null);
  assert.equal(chatSenderAvatarName({ ...base, senderId: OTHER }), null);
  assert.equal(chatSenderAvatarName({ ...base, partnerId: null, senderId: PARTNER }), null);
});

test("avatar display falls back photo → emoji → initial, and unknown names show a person icon marker", () => {
  assert.deepEqual(profileAvatarDisplay({ name: "하늘", avatarUrl: null, ownerId: PARTNER }), { kind: "initial", initial: "하" });
  assert.deepEqual(profileAvatarDisplay({ name: "하늘", avatarUrl: "🐻", ownerId: PARTNER }), { kind: "emoji", emoji: "🐻" });
  assert.deepEqual(profileAvatarDisplay({ name: "하늘", avatarUrl: photoPath(PARTNER), ownerId: PARTNER }), { kind: "photo", path: photoPath(PARTNER), initial: "하" });
  assert.deepEqual(profileAvatarDisplay({ name: null, avatarUrl: null, ownerId: null }), { kind: "initial", initial: getProfileInitial(null) });
  assert.equal(getProfileInitial(null), "?");
  // 허용 목록 밖 이모지, 외부 주소, 다른 사람 경로는 이름 첫 글자로 둔다.
  for (const avatarUrl of ["🦄", "https://example.com/a.png", "//evil.test/api/profile/avatar/image?userId=x", photoPath(OTHER), photoPath(PARTNER, "not-a-uuid"), `${photoPath(PARTNER)}&extra=1`]) {
    assert.equal(profileAvatarDisplay({ name: "하늘", avatarUrl, ownerId: PARTNER }).kind, "initial", avatarUrl);
  }
  for (const { emoji } of PROFILE_AVATAR_EMOJIS) assert.equal(parseProfileAvatarUrl(emoji, PARTNER), emoji);
  assert.equal(PROFILE_AVATAR_EMOJIS.length, 20);
});

function relativeLuminance(hex) {
  const channels = hex.replace("#", "").match(/../gu).map((part) => parseInt(part, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test("every bubble tone keeps body text at WCAG AA contrast (>= 4.5:1)", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../../packages/design-tokens/src/chat.ts", import.meta.url)), "utf8");
  for (const tone of ["sky", "rose", "amora", "neutral"]) {
    const block = new RegExp(`${tone}:\\s*\\{([^}]*)\\}`, "u").exec(source)?.[1];
    assert.ok(block, `${tone} 팔레트가 있어야 한다`);
    const surface = /surface:\s*"(#[0-9A-Fa-f]{6})"/u.exec(block)?.[1];
    const ink = /ink:\s*"(#[0-9A-Fa-f]{6})"/u.exec(block)?.[1];
    assert.ok(surface && ink, `${tone} surface/ink 값`);
    assert.ok(contrast(ink, surface) >= 4.5, `${tone}: ${ink} on ${surface} = ${contrast(ink, surface).toFixed(2)}`);
  }
  // 이름 첫 글자 아바타(웹 ProfileAvatar 와 같은 색)도 같은 기준을 지킨다.
  assert.ok(contrast("#7D5753", "#EADDD8") >= 4.5);
});

test("mobile chat wires the resolver for the profile avatar and draws the artifact's conversation, not the old noir/ivory bubbles", () => {
  const chat = readFileSync(new URL("../../app/(tabs)/chat.tsx", import.meta.url), "utf8");
  assert.match(chat, /resolveChatSenderPresentation\(\{\s*isAi,\s*senderId: item\.sender_id,\s*presentation: participantPresentation,?\s*\}\)/u);
  assert.match(chat, /apiFetchForExpectedUserQuiet\(userId, "\/api\/auth\/me"\)/u);
  assert.match(chat, /<ProfileAvatar[\s\S]{0,400}avatarUrl=\{senderPresentation\.avatarUrl\}/u);
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 앱 대화의 말풍선은 아티팩트 모양이다 —
  // 아모라 말은 말풍선 없는 17px 문단(줄 높이 1.65, 잉크), 사람 말은 돌빛 말풍선(반경 20, 15px). 위 역할 색
  // (`chatPalette`, 웹 ChatBubble)은 웹에 그대로 있고, 앱 말풍선은 더 이상 그 색을 칠하지 않는다.
  // 누가 말했는지는 이름 줄과 상대의 얼굴 그림(위 ProfileAvatar)이 말한다.
  assert.doesNotMatch(chat, /chatPalette/u);
  assert.match(chat, /<View style=\{isAi \? st\.amoraLine : st\.personBubble\}>/u);
  assert.match(chat, /<AmoraMessageBody content=\{citationText\} textStyle=\{st\.amoraText\} \/>/u);
  assert.match(chat, /<Text style=\{st\.personText\}>\{citationText\}<\/Text>/u);
  assert.match(chat, /\n {2}amoraText: paragraph17,\n/u);
  assert.match(chat, /\n {2}personBubble: \{ backgroundColor: invitationPalette\.stone, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 16 \},\n/u);
  assert.match(chat, /\n {2}personText: \{ \.\.\.invitationType\.sans, fontSize: 15, lineHeight: invitationLineHeight\(15, 1\.5\) \},\n/u);
  const style = readFileSync(new URL("../components/invitation/invitationStyle.ts", import.meta.url), "utf8");
  assert.match(style, /export const paragraph17: TextStyle = \{ \.\.\.typo\.sans, fontSize: 17, lineHeight: lineHeight\(17, 1\.65\) \};/u);
  assert.doesNotMatch(chat, /isMe \? colors\.noir\[800\]/u);
  assert.doesNotMatch(chat, /isMe \? "#FFF"/u);
  assert.doesNotMatch(chat, /<User size=\{12\}/u);
});
