// 읽기와 쓰기가 엇갈릴 때(2026-11-17, 청첩장 디자인 2단계 코드 검토 M3).
//
// 쓰기(하트, 준비 순서, 상담을 일정에 넣기) 앞에 출발한 읽기가 쓰기 뒤에 도착하면 서버가 쓰기 전에 만든 답일 수
// 있다. 그 답을 그리면 방금 저장한 것이 되돌아간 것처럼 보인다. `readGate.mjs` 가 그 답을 버리고 다시 읽게 한다.
import assert from "node:assert/strict";
import test from "node:test";

import { createReadGate } from "../lib/readGate.mjs";

test("a read with no write around it is drawn", () => {
  const gate = createReadGate();
  const ticket = gate.beginRead();
  assert.ok(ticket);
  assert.equal(gate.endRead(ticket), "apply");
});

test("a later read wins over an earlier one that answers late", () => {
  const gate = createReadGate();
  const first = gate.beginRead();
  const second = gate.beginRead();
  assert.equal(gate.endRead(second), "apply");
  assert.equal(gate.endRead(first), "drop", "늦게 온 앞 읽기가 뒤 읽기를 덮었다");
  assert.equal(gate.endRead(null), "drop");
});

test("no read goes out while a write is waiting; one read follows the last write", () => {
  const gate = createReadGate();
  gate.beginWrite();
  gate.beginWrite();
  assert.equal(gate.beginRead(), null, "쓰기를 기다리는 동안 읽으면 쓰기 전 값을 받을 수 있다");
  assert.equal(gate.endWrite(), false, "아직 쓰기가 남았다");
  assert.equal(gate.endWrite(), true, "마지막 쓰기가 끝나면 한 번 읽는다");
  assert.equal(gate.endWrite(), false, "미룬 읽기는 한 번뿐이다(음수로 내려가지도 않는다)");
  assert.equal(gate.endRead(gate.beginRead()), "apply");
});

test("a read that a write overtook is dropped, and read again once the writes are done", () => {
  // 읽는 동안 쓰기가 시작돼 아직 끝나지 않았다 → 버리고, 쓰기가 끝나면 읽는다.
  const waiting = createReadGate();
  const ticket = waiting.beginRead();
  waiting.beginWrite();
  assert.equal(waiting.endRead(ticket), "drop");
  assert.equal(waiting.endWrite(), true);

  // 읽는 동안 쓰기가 시작되고 끝났다 → 그 답은 쓰기 전 것일 수 있으니 바로 다시 읽는다.
  const overtaken = createReadGate();
  const stale = overtaken.beginRead();
  overtaken.beginWrite();
  assert.equal(overtaken.endWrite(), false, "아무도 읽기를 기다리지 않았다");
  assert.equal(overtaken.endRead(stale), "reread");
  assert.equal(overtaken.endRead(overtaken.beginRead()), "apply");
});
