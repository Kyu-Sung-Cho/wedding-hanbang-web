// 저장 기능을 실사용자 경로 그대로 밟는 E2E.
//
// 왜 따로 두는가: 최초 검증이 message_id=null 로만 돌아 "9/9 통과"였는데 정작
// 기능은 외래키 위반으로 실패하고 있었다(2026-07-27). 실제 chat_messages 행을
// 만들고 그 id로 저장까지 가야 이 경로가 검증된다.
//
// 실행: node scripts/audit/saved-notes-real-path-e2e.mjs
// 주의: 운영에 임시 계정·커플·메시지를 만들고 끝에서 전부 지운다.
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REF = "slrtobkksjmxgzatjyqb";
const env = readFileSync(path.resolve(ROOT, "..", "wedding", "apps", "web", ".env.local"), "utf8");
const ANON = env.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY="?([^"\r\n]+)"?/m)[1].trim();
const SERVICE = env.match(/^SUPABASE_SERVICE_ROLE_KEY="?([^"\r\n]+)"?/m)[1].trim();
const BASE = `https://${REF}.supabase.co`;
const email = "saved-realpath@hanbang-test.invalid";
const password = "Test!RealPath#2026";

const results = [];
const check = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); };

const admin = (p, init = {}) => fetch(`${BASE}${p}`, {
  ...init,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
});

console.log("=== 준비 ===");
await admin("/auth/v1/admin/users", {
  method: "POST",
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const session = await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
})).json();
const userId = session.user.id;

await admin("/rest/v1/profiles", {
  method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify({ id: userId, email, name: "실경로 테스트", role: "bride" }),
});
await fetch(`${BASE}/rest/v1/rpc/create_couple_for_current_user`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_role: "bride" }),
});
const [profile] = await (await admin(`/rest/v1/profiles?select=couple_id&id=eq.${userId}`)).json();
const coupleId = profile.couple_id;
console.log(`  user=${userId.slice(0, 8)} couple=${coupleId?.slice(0, 8)}`);

// 실제 아모라 메시지 한 건을 만든다 — 사용자가 저장 버튼을 누를 대상.
const msgRes = await admin("/rest/v1/chat_messages", {
  method: "POST", headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    couple_id: coupleId,
    sender_type: "ai",
    sender_role: "ai",
    // role은 NOT NULL이고 기본값이 없다 — 첫 시도에서 이걸 빠뜨려 메시지가 안 만들어졌고,
    // message_id=null로 저장되는 바람에 실경로를 또 못 밟았다.
    role: "assistant",
    content: "촬영일 30일 전 취소 시 상품가의 50% 위약금이 발생해요.",
    visibility: "shared",
  }),
});
const msgBody = await msgRes.json();
const messageId = Array.isArray(msgBody) ? msgBody[0]?.id : null;
check("아모라 메시지 생성", Boolean(messageId), `status=${msgRes.status} ${messageId ? "" : JSON.stringify(msgBody).slice(0, 150)}`);

console.log("\n=== 실경로: 저장 (message_id 포함) ===");
const userHeaders = {
  apikey: ANON, Authorization: `Bearer ${session.access_token}`,
  "Content-Type": "application/json", Prefer: "return=representation",
};
const save = await fetch(`${BASE}/rest/v1/amora_saved_notes`, {
  method: "POST", headers: userHeaders,
  body: JSON.stringify({ couple_id: coupleId, saved_by: userId, message_id: messageId, content: "촬영일 30일 전 취소 시 상품가의 50% 위약금이 발생해요." }),
});
const saveBody = await save.json();
check("실제 메시지 id로 저장", save.status === 201, `status=${save.status} ${save.status !== 201 ? JSON.stringify(saveBody).slice(0, 200) : ""}`);
const noteId = Array.isArray(saveBody) ? saveBody[0]?.id : null;

console.log("\n=== 같은 메시지 두 번 저장은 막히는가 ===");
const dup = await fetch(`${BASE}/rest/v1/amora_saved_notes`, {
  method: "POST", headers: userHeaders,
  body: JSON.stringify({ couple_id: coupleId, saved_by: userId, message_id: messageId, content: "중복" }),
});
check("중복 저장 차단(23505)", dup.status === 409, `status=${dup.status}`);

console.log("\n=== 목록 조회 ===");
const list = await (await fetch(`${BASE}/rest/v1/amora_saved_notes?select=id,message_id,content`, { headers: userHeaders })).json();
check("본인 저장본 1건 조회", Array.isArray(list) && list.length === 1, `${Array.isArray(list) ? list.length : "?"}건`);
check("메시지 연결 보존", list?.[0]?.message_id === messageId);

console.log("\n=== 정리 ===");
await admin(`/rest/v1/amora_saved_notes?couple_id=eq.${coupleId}`, { method: "DELETE" });
await admin(`/rest/v1/chat_messages?couple_id=eq.${coupleId}`, { method: "DELETE" });
await admin(`/rest/v1/profiles?id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ couple_id: null }) });
await admin(`/rest/v1/couples?id=eq.${coupleId}`, { method: "DELETE" });
const del = await admin(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
const [left] = await (await admin("/rest/v1/amora_saved_notes?select=id")).json().then((r) => [Array.isArray(r) ? r.length : "?"]);
check("테스트 잔여물 없음", left === 0, `저장본 ${left}건 / 계정삭제 ${del.status}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n═══ ${results.length - failed.length}/${results.length} 통과 ═══`);
if (failed.length) { for (const f of failed) console.log("  ✗", f.n); process.exitCode = 1; }
