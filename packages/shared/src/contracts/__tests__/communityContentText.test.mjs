import assert from "node:assert/strict";
import test from "node:test";
import { communityContentText } from "../communityContentText.mjs";

test("일반 한글과 기호를 그대로 보존한다", () => {
  for (const text of ["A & B", "예산 < 300", "한글과 💛 메모", ""]) {
    assert.equal(communityContentText(text), text);
  }
});

test("저장된 앰퍼샌드와 비교 기호를 평문으로 표시한다", () => {
  assert.equal(communityContentText("A &amp; B"), "A & B");
  assert.equal(communityContentText("예산 &lt; 300 &amp; 일정 &gt; 2"), "예산 < 300 & 일정 > 2");
  assert.equal(communityContentText("<p>한글 &amp; 서식</p>"), "한글 & 서식");
});

test("십진수와 16진수 엔티티를 해독한다", () => {
  assert.equal(communityContentText("&#38; &#60; &#x3e; &#54620; &#x1f49b;"), "& < > 한 💛");
});

test("이름 있는 HTML 엔티티를 보존된 문자로 표시한다", () => {
  assert.equal(communityContentText("&quot;메모&quot; &apos;확인&apos; &nbsp; &copy;"), '"메모" \'확인\' \u00a0 ©');
});

test("이중 인코딩된 문자열은 정확히 한 번만 해독한다", () => {
  assert.equal(communityContentText("&amp;lt;img&amp;gt; &amp;amp;"), "&lt;img&gt; &amp;");
});

test("이스케이프된 이미지 태그는 실행하지 않는 평문으로 남긴다", () => {
  assert.equal(
    communityContentText("&lt;img src=x onerror=alert(1)&gt;"),
    "<img src=x onerror=alert(1)>",
  );
});

test("실제 태그를 제거한 뒤 해독하므로 원래 글자였던 태그는 잃지 않는다", () => {
  assert.equal(
    communityContentText("<p>&lt;b&gt;문자 그대로&lt;/b&gt; &amp; <strong>서식</strong></p>"),
    "<b>문자 그대로</b> & 서식",
  );
});

test("기존 태그 제거와 줄바꿈·공백 보존 방식을 유지한다", () => {
  assert.equal(communityContentText("첫째\n\n<p>둘째 <strong>강조</strong></p>\n셋째"), "첫째\n\n둘째 강조\n셋째");
});

test("호출자가 지정한 태그 구분자를 유지한다", () => {
  assert.equal(communityContentText("<p>첫째</p><p>둘째</p>", " "), " 첫째  둘째 ");
});
