// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT,
  WEDDING_CODE_RESEARCH_RETENTION_DAYS,
  WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS,
} from "@/lib/weddingCode/contribution/contract";
import { V40_STORAGE, V40_STRENGTH, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import {
  WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT,
  analyticsCaptureTouchesLikertPath,
  sanitizeWeddingCodeFunnelCapture,
} from "@/lib/analyticsPrivacy";
import { LOCAL_TTL_MS, V31_CLEAR_LOCAL_LABEL } from "@/lib/weddingCode/v31LocalProgress";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { V40_GUESS_COPY } from "@/lib/weddingCode/v40/guess/guessCopy";
import { V40_LETTER_GUESS_COPY } from "@/lib/weddingCode/v40/letterGuess/letterGuessCopy";
import { PAIR_SESSION_RETENTION_DAYS } from "@/lib/weddingCode/pairSessionContract";
import { LIKERT_RETENTION_MS } from "@/lib/weddingCode/likert/io";
import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import PrivacyPage from "../page";

const SECRET = "test-secret-that-is-at-least-thirty-two-chars";

function render(): string {
  return renderToStaticMarkup(<PrivacyPage />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function kstDateLabel(iso: string): string {
  const kst = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일부터`;
}

/**
 * 처리방침의 웨딩코드 답 보태기 고지는 **실제로 지키는 것만** 말해야 한다.
 *
 * 2026-09-16 적대 검토에서 두 가지가 잡혔다. "백업에서 복원돼도 다시 지운다"는 문장은
 * 그런 코드가 없는데 쓰여 있었고, 수집 플래그를 끄면 이미 받은 답이 남아 있는데도
 * 고지가 사라졌다. 그래서 고지는 **저장소를 지키는 스위치(비밀값)** 로 켜고, 문장은
 * 계약 상수에서 온 기간·날짜와 맞는지 렌더 결과로 본다.
 */
describe("privacy notice for WeddingCode research contributions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("연구 저장소가 없으면 연구 수집을 말하지 않고, 별도 동의한 함께 보기만 안내한다", () => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", "");
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "true");
    const text = render();
    expect(text).not.toContain("답 보태기");
    expect(text).toContain("웨딩코드: 답은 기기 안에서 계산하며 세션 녹화를 하지 않습니다");
    expect(text).toContain("아래 ‘함께 보기’에 별도로 동의한 경우에만 해당 기능에 필요한 답을 서버에 저장합니다");
  });

  it.each(["", SECRET])("연구 저장소와 독립적으로 두 사람 공유 동의·만료·철회·확인 주소의 권한을 안내한다 (%#)", (secret) => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", secret);
    const text = render();
    expect(text).toContain(`각자 보관·공유에 동의하면 초대 생성 후 ${PAIR_SESSION_RETENTION_DAYS}일까지 서로의 답과 결과를 볼 수 있습니다`);
    expect(text).toContain("만료 즉시 접근을 막고 하루 안에 기록을 삭제합니다");
    expect(text).toContain("‘연결 끝내기’를 누르면 두 사람의 공유 답을 즉시 지웁니다");
    expect(text).toContain("이미 상대가 읽거나 따로 보관한 내용은 회수할 수 없습니다");
    expect(text).toContain("저장 끄기는 이 영구 확인 주소를 지우지만 서버 연결을 끝내지는 않습니다");
    expect(text).toContain("확인 주소를 가진 사람은 해당 참여자의 권한으로 결과를 보고 연결을 끝낼 수 있으므로 본인만 보관해야 합니다");
  });

  it.each(["", SECRET])("연구 저장소 유무와 별개로 본인 브라우저 보관 범위와 제어를 알린다 (%#)", (secret) => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", secret);
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "false");
    const text = render();
    const localNotice = text.slice(text.indexOf("기본 웨딩코드(v3.1) 이어하기:"), text.indexOf("지워 주세요.") + "지워 주세요.".length);

    expect(text.indexOf("기본 웨딩코드(v3.1) 이어하기:")).toBeGreaterThan(text.indexOf("로그인 없이 이용하는 공개 웨딩코드:"));
    expect(localNotice).toContain("본인 답과 현재 단계·수정 상태를 같은 브라우저에 보관합니다");
    expect(localNotice).toContain(`마지막으로 답이나 진행을 저장한 때부터 ${LOCAL_TTL_MS / (24 * 60 * 60 * 1000)}일`);
    expect(localNotice).toContain("읽거나 재방문만 해서는 기간이 늘어나지 않습니다");
    expect(localNotice).toContain("기한이 지난 답은 불러오지 않습니다");
    expect(localNotice).toContain("상대 답·공유 동의·자유 메모는 이 기록에 넣지 않습니다");
    expect(localNotice).toContain("받은 두 사람 결과 링크에서는 개인 저장 기록을 읽거나 쓰지 않습니다");
    expect(localNotice).toContain("자동저장을 끄면 저장된 답을 지우고 이후 저장을 멈추며, 꺼짐 설정만 브라우저에 남깁니다");
    expect(localNotice).toContain("이때 현재 화면의 답은 유지됩니다");
    // 방침이 부르는 버튼 이름은 화면 버튼과 같은 상수다. 예전엔 ‘저장된 답 지우기’라 적어 화면에 없는 버튼을 가리켰다.
    expect(localNotice).toContain(`‘${V31_CLEAR_LOCAL_LABEL}’는 저장 기록과 현재 진행을 함께 초기화합니다`);
    expect(localNotice).toContain("공용 기기에서는 같은 브라우저를 쓰는 사람이 답을 볼 수 있으므로");
  });

  it("수집 플래그를 꺼도 저장소를 지키는 동안에는 고지·기간·삭제 방법을 계속 알린다", () => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", SECRET);
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "false");
    const text = render();
    const dateLabel = kstDateLabel(WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT);

    expect(text).toContain("아래 ‘함께 보기’ 또는 답 보태기에 별도로 동의한 경우에만 해당 기능에 필요한 답을 서버에 저장합니다");
    // 제1조 항목, 제3조 보관, 부칙 — 세 곳 모두 같은 적용일
    expect(text).toContain(`웨딩코드 답 보태기에 동의한 경우(${dateLabel.replace(/부터$/, "")}부터, 선택)`);
    expect(text).toContain(`웨딩코드 답 보태기(선택, ${dateLabel})`);
    expect(text).toContain("개정분(제1조·제3조의 웨딩코드 답 보태기)은 같은 날부터 적용합니다");
    // 고지와 같은 날 열더라도, 화면·방침의 시작일은 한 상수에서 나온다.
    expect(text).toContain(`웨딩코드 답 보태기(선택, ${dateLabel})`);
    expect(text).toContain(`보낸 날부터 ${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 삭제합니다`);
    expect(text).toContain(`${WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS}일간 보관합니다`);
    expect(text).toContain("저장 시각은 날짜 단위로만 남기며");
    expect(text).toContain("새 답 받기를 멈춘 뒤에도 이미 받은 답의 자동 삭제와 삭제 요청은 계속 처리합니다");
    // 코드가 하지 않는 약속은 쓰지 않는다. (방침의 다른 조항에는 "익명"이 원래 있으므로 이 문단만 본다.)
    const paragraph = text.slice(
      text.indexOf("웨딩코드 답 보태기(선택"),
      text.indexOf("계속 처리합니다") + "계속 처리합니다".length,
    );
    expect(paragraph.length).toBeGreaterThan(100);
    expect(paragraph).not.toMatch(/백업[^.]*다시 지우/);
    expect(paragraph).not.toContain("익명");
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** 문단이 「최근 세 번」처럼 쓰는 우리말 수 낱말. V40_STORAGE.historyMax 로 찾는다. */
const COUNT_WORDS = ["영", "한", "두", "세", "네", "다섯"] as const;
const V4_LABEL = "새 웨딩코드(v4.0-tendency) 이어하기·링크 보내기:";
const V4_CLOSING = "지워 주세요.";

function v4Paragraph(text: string): string {
  const start = text.indexOf(V4_LABEL);
  expect(start, "v4 문단을 못 찾았다. 이 검사가 헛돈다").toBeGreaterThan(-1);
  const end = text.indexOf(V4_CLOSING, start);
  expect(end, "v4 문단의 끝 문장을 못 찾았다").toBeGreaterThan(start);
  return text.slice(start, end + V4_CLOSING.length);
}

/**
 * 새 웨딩코드(v4.0-tendency) 문단 (설계 문서 9절 8항).
 *
 * v3.1 문단은 그대로 두고 옆에 더한 문단이다. 이 문단이 하는 말은 **v4 코드가 실제로 하는 일**이어야 해서, 기간과 최근 몇 번은
 * 저장 상수(V40_STORAGE)에서, 버튼 이름은 화면 문구(V40_COPY)에서 읽는다. 화면이 버튼 이름을 바꾸거나 기간을 바꾸면 이 검사가
 * 빨개져서 방침을 함께 고치게 한다. 처리방침 최종 수정일과 부칙은 이 문단으로 올리지 않는다(동의 판과 한 값이라 파운더 결정).
 */
describe("privacy notice for the WeddingCode v4.0-tendency paragraph", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function renderWithoutResearch(secret: string): string {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", secret);
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "false");
    return render();
  }

  it.each(["", SECRET])("v3.1 문단 뒤에 놓이고, 보관 항목·기간·끄기와 지우기가 저장 상수와 화면 버튼 이름 그대로다 (%#)", (secret) => {
    const text = renderWithoutResearch(secret);
    const notice = v4Paragraph(text);
    const days = V40_STORAGE.ttlMs / DAY_MS;
    const keepWord = COUNT_WORDS[V40_STORAGE.historyMax];
    expect(keepWord, "V40_STORAGE.historyMax 가 바뀌었다. 방침의 「최근 ○ 번」을 고칠 것").toBeTruthy();

    // v3.1 문단은 그대로 남고 v4 문단은 그 뒤에 온다.
    const v31Start = text.indexOf("기본 웨딩코드(v3.1) 이어하기:");
    expect(v31Start).toBeGreaterThan(-1);
    expect(text.indexOf(V4_CLOSING, v31Start)).toBeLessThan(text.indexOf(V4_LABEL));

    // 보관하는 것과 기간
    expect(notice).toContain(
      "자동저장이 켜져 있으면 본인 답과 질문 화면의 위아래·좌우·보기 순서를 정하는 값(폼 비트), 이어 할 위치(질문 또는 결과 화면)와 넘어간 질문 다시 보기 상태를 같은 브라우저에 보관합니다",
    );
    expect(notice).toContain(
      `마지막으로 답이나 진행을 저장한 때부터 ${days}일 동안 이어서 이용할 수 있고, 읽거나 재방문만 해서는 기간이 늘어나지 않으며, 기한이 지난 답은 불러오지 않습니다`,
    );

    // 지난번과 비교하는 기록: 글자와 세기 낱말은 상수, 답은 넣지 않는다.
    const strengthWords = `${V40_STRENGTH.clear.label}·${V40_STRENGTH.lean.label}·${V40_STRENGTH.even.label}`;
    expect(notice).toContain(
      `결과의 글자와 세기(${strengthWords}), 임시 글자 여부, 결과를 만든 시각, 폼 비트를 최근 ${keepWord} 번까지 함께 보관하며`,
    );
    expect(notice).toContain(`이 기록에는 답을 넣지 않고 결과를 만든 때부터 ${days}일이 지나면 비교에 쓰지 않습니다`);

    // 끄기·지우기·다시 하기: 방침이 부르는 버튼 이름은 화면 버튼과 같은 상수다.
    expect(notice).toContain(
      `자동저장은 처음에는 켜져 있고(이전 판에서 꺼 두었다면 꺼진 채로 시작합니다), ‘${V40_COPY.autosave.turnOffButton}’를 누르면 저장된 답과 지난번 비교 기록, 이전 판(v3.1)의 저장된 답을 지우고 이후 저장을 멈추며 꺼짐 설정만 브라우저에 남깁니다`,
    );
    expect(notice).toContain(`‘${V40_COPY.manage.clear.button}’는 저장된 답과 지난번 비교 기록을 함께 지우고`);
    expect(notice).toContain(`‘${V40_COPY.manage.restart.button}’는 저장된 답을 지우되 지난번 비교 기록은 남깁니다`);
    expect(notice).toContain("공용 기기에서는 같은 브라우저를 쓰는 사람이 답을 볼 수 있으므로 자동저장을 끄거나 저장된 답을 지워 주세요");

    // 방침이 지우거나 남긴다고 말한 것은 화면이 사용자에게 말하는 것과 같아야 한다.
    expect(V40_COPY.autosave.turnedOffNote, "끄면 비교 기록도 지운다는 화면 문구가 바뀌었다").toMatch(/비교[^.]*기록[^.]*지웠/);
    expect(V40_COPY.manage.clear.confirmBody, "저장 지우기가 비교 기록도 지운다는 화면 문구가 바뀌었다").toMatch(/지난번[^.]*기록[^.]*지워/);
    expect(V40_COPY.manage.restart.confirmBody, "다시 하기가 비교 기록을 남긴다는 화면 문구가 바뀌었다").toMatch(/지난번[^.]*남아요/);
  });

  it.each(["", SECRET])("서버에 답을 보관하지 않고, 받은 링크는 저장하지 않으며, 링크 공유는 되돌릴 수 없음을 알린다 (%#)", (secret) => {
    const notice = v4Paragraph(renderWithoutResearch(secret));

    expect(notice).toContain("보관한 답과 기록은 서버·계정으로 보내지 않으며 이 판에서는 서버에 답을 보관하는 ‘함께 보기’도 제공하지 않습니다");
    expect(notice).toContain(
      "받은 두 사람 결과 링크에서는 어느 쪽이 본인인지 ‘나’로 표시하려고 이 브라우저에 저장된 본인 답을 읽어 링크의 답과 견주기만 하고(읽어도 보관 기간이 늘거나 저장된 내용이 바뀌지 않습니다) 아무것도 쓰지 않으며, 링크에 든 두 사람의 답은 저장하지 않고, 초대 링크로 받은 상대의 답은 이 브라우저에 저장하지 않고 화면에만 둡니다",
    );
    // 옛 문장(「개인 저장 기록을 읽거나 쓰지 않으며」)은 설계와 어긋났다: 이 화면은 「나」 표시를 위해 저장된 본인 답을 읽는다.
    // 읽는다는 사실을 빼는 문장으로 되돌아가면 방침이 거짓이 된다.
    expect(notice).not.toContain("개인 저장 기록을 읽거나 쓰지 않으며");
    // 방침이 「나」 표시라고 말하는 그 기능이 화면 문구에 실제로 있다(없으면 방침이 없는 기능을 설명한다).
    expect(V40_COPY.couple.perspective.autoNote, "이 브라우저에 저장된 내 답으로 「나」를 표시한다는 화면 문구가 바뀌었다").toMatch(/이 브라우저에 저장된 내 답[^.]*「나」/);

    // 두 곳의 링크 보내기 단추는 같은 이름이고, 방침은 그 이름과 두 라디오 이름을 그대로 부른다.
    expect(V40_COPY.coupleSend.sendButton).toBe(V40_COPY.send.sendButton);
    expect(notice).toContain(
      `‘${V40_COPY.send.sendButton}’로 만드는 링크에는 ‘${V40_COPY.send.withAnswersOption}’를 고른 경우 본인의 답 전체가, 두 사람 결과 화면에서는 두 사람의 답 전체가 링크 주소의 # 뒤에 담깁니다`,
    );
    expect(notice).toContain(
      "링크는 이 브라우저 안에서 만들어지고 # 뒤의 내용은 서버 요청에 포함되지 않지만, 링크를 가진 사람은 누구나 답을 읽고 다시 전달할 수 있고 이미 보낸 링크는 되돌릴 수 없으며 답을 고쳐 새 링크를 만들어도 예전 링크는 남습니다",
    );
    expect(notice).toContain(`‘${V40_COPY.send.questionsOnlyOption}’ 링크에는 답이 들어 있지 않습니다`);
  });

  it.each(["", SECRET])("현재 구판 화면도 통계를 중단하며 기존 속성 정리기는 보존한다 (%#)", (secret) => {
    const text = renderWithoutResearch(secret);
    const notice = v4Paragraph(text);

    // 가리키는 문장이 실제로 있다. (항목별 고지는 analyticsPrivacy.test.ts 가 그 문장 안에서 센다.)
    expect(text).toContain("로그인 없이 이용하는 공개 웨딩코드:");
    expect(notice).toContain(
      "이 판의 이용 통계는 현재 기록하지 않으며, 고른 답·글자·세기·링크 주소는 통계에 넣지 않습니다",
    );

    // 말한 대로 정리기는 고지한 속성만 통과시킨다: v4 판 이름은 지나가고, 글자·세기·링크 주소는 실수로 실려도 떨어진다.
    const now = Date.parse(WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT) + 1;
    const sent = sanitizeWeddingCodeFunnelCapture(
      {
        event: "wedding_code_share_copied",
        properties: {
          version: WEDDING_CODE_V40_VERSION,
          placement: "result",
          result_kind: "solo",
          letters: "SWUA",
          strength: "lean",
          share_url: `https://hanbang.ai/wedding-code#v=${WEDDING_CODE_V40_VERSION}&a=0000000000000000000000000000000000000000000000000000000000000000000000`,
        },
      },
      now,
    );
    expect(sent?.properties).toEqual({ version: WEDDING_CODE_V40_VERSION, placement: "result", result_kind: "solo" });
    expect(analyticsCaptureTouchesLikertPath(sent, "/wedding-code")).toBe(true);
  });

  it.each(["", SECRET])("# 뒤가 오류 수집 도구로 나가지 않는다는 말은 정제 수정이 운영에서 확인되기 전에는 쓰지 않는다 (%#)", (secret) => {
    // 설계 문서 9절 7항: # 뒤가 성능 이벤트의 주소로 나가는 문제(PR #473)가 운영에서 확인되기 전에는
    // 「# 뒤는 보내지 않는다」를 쓰지 않는다. 문단은 v3.1 문장과 같이 사실인 「서버 요청에 포함되지 않는」만 말한다.
    // 정제 수정이 운영에서 확인되면 이 검사는 그 문장을 더하는 변경에서 함께 바꾼다.
    const notice = v4Paragraph(renderWithoutResearch(secret));
    expect(notice).toContain("서버 요청에 포함되지 않지만");
    expect(notice).not.toMatch(/오류 수집|Sentry|센트리/);
    expect(notice).not.toMatch(/# 뒤[^.]{0,30}(어디에도|모두|절대)[^.]{0,20}보내지 않/);
  });

  /**
   * 4.1 단계 2(서로 짐작하기, 결과 전 글자 고르기)가 이 문단의 끝 문장 바로 앞에 더한 여섯 문장(서로 짐작하기 셋, 먼저 고른 글자 셋. 빌드 계획 10.4, 선택 2부 문장은 이 단계에 없다).
   * 문장은 글자 그대로 고정하고, 단추와 구역 이름과 기간은 상수에서 읽는다. 이름이나 기간이 바뀌면 이 시험이 빨개져서 방침을 함께 고치게 한다.
   * 끝 문장 「지워 주세요.」는 첫 등장에서 문단을 자르므로 끼운 문장에는 그 말이 없어야 한다(있으면 문단이 일찍 끊긴다).
   */
  it.each(["", SECRET])("4.1 단계 2: 서로 짐작하기의 답은 링크에 담기고 저장하지 않으며, 먼저 고른 글자는 이 브라우저에만 남고 링크에 넣지 않는다고 말한다 (%#)", (secret) => {
    const notice = v4Paragraph(renderWithoutResearch(secret));
    const days = V40_STORAGE.ttlMs / DAY_MS;
    const guessName = V40_GUESS_COPY.entry.title.replace(/\s*\(선택\)$/u, "");
    expect(guessName, "서로 짐작하기 진입 카드의 이름이 바뀌었다. 방침의 ‘서로 짐작해 보기’를 고칠 것").toBe("서로 짐작해 보기");

    const guessSentences = [
      `‘${guessName}’(선택)를 하면 여러 장면에서 본인이 고른 쪽과 상대가 고를 것이라고 짐작한 쪽이 ‘${V40_COPY.send.withAnswersOption}’ 링크와 두 사람 결과 링크의 # 뒤에 함께 담기고, 두 사람 결과 링크에는 받은 링크에 든 상대의 짐작도 다시 담깁니다.`,
      "이 답은 이 브라우저에 저장하지 않고 화면에만 두며, 상대가 하지 않았거나 나란히 놓을 장면이 없어도 링크에는 들어 있습니다.",
      "링크를 가진 사람은 누구나 읽고 다시 전달할 수 있습니다.",
    ];
    const letterSentences = [
      `결과를 보기 전에 주제마다 가까운 글자를 골라 보면(선택) 고른 글자는 자동저장이 켜져 있을 때만 이 브라우저에 ${days}일 동안 보관하고, 결과 화면의 ‘${V40_LETTER_GUESS_COPY.lines.heading}’ 구역에서 결과와 나란히 놓는 데만 쓰며 링크에는 넣지 않습니다.`,
      `‘${V40_COPY.autosave.turnOffButton}’는 이 브라우저에 보관한 먼저 고른 글자도 지우며, 화면에 열려 있는 먼저 고른 글자는 새로고침하기 전까지 남아 있습니다.`,
      `‘${V40_COPY.manage.clear.button}’와 ‘${V40_COPY.manage.restart.button}’는 먼저 고른 글자를 보관본과 화면에서 모두 지웁니다.`,
    ];
    for (const sentence of [...guessSentences, ...letterSentences]) expect(notice).toContain(sentence);

    // 자리: 이용 통계 문장 뒤, 문단의 끝 문장 앞. 순서는 서로 짐작하기, 글자 고르기(보관, 끄기, 지우기).
    const statsAt = notice.indexOf("고른 답·글자·세기·링크 주소는 통계에 넣지 않습니다.");
    const positions = [...guessSentences, ...letterSentences].map((sentence) => notice.indexOf(sentence));
    const closingAt = notice.indexOf("공용 기기에서는 같은 브라우저를 쓰는 사람이 답을 볼 수 있으므로");
    expect(statsAt).toBeGreaterThan(-1);
    expect(closingAt).toBeGreaterThan(-1);
    expect([statsAt, ...positions, closingAt]).toEqual([statsAt, ...positions, closingAt].sort((a, b) => a - b));
    expect(notice.endsWith("공용 기기에서는 같은 브라우저를 쓰는 사람이 답을 볼 수 있으므로 자동저장을 끄거나 저장된 답을 지워 주세요.")).toBe(true);
    expect(notice.indexOf("지워 주세요.")).toBe(notice.length - "지워 주세요.".length);

    // 기존 문장은 한 글자도 바뀌지 않았다(이 단계는 끼우기만 한다).
    expect(notice).toContain("‘링크 보내기’로 만드는 링크에는");
    expect(notice).toContain("이 판의 이용 통계는 현재 기록하지 않으며, 고른 답·글자·세기·링크 주소는 통계에 넣지 않습니다");
  });

  it.each(["", SECRET])("4.1 단계 2: 방침이 말하는 것을 화면도 같은 말로 한다 (%#)", () => {
    // 방침이 「링크에 담긴다」 「이 브라우저에 저장하지 않는다」고 말한 기능이 화면 문구에 실제로 있다(없으면 방침이 없는 기능을 설명한다).
    expect(V40_GUESS_COPY.entry.body, "진입 카드가 짐작이 링크에 들어간다고 말하지 않는다").toMatch(/내 답과 함께 보내기[^.]*링크에 들어가요/);
    expect(V40_GUESS_COPY.entry.body, "진입 카드가 저장하지 않는다고 말하지 않는다").toMatch(/이 브라우저에는 저장하지 않아요/);
    expect(V40_GUESS_COPY.shareInfo, "보내기 직전 안내가 링크에 짐작이 들어간다고 말하지 않는다").toMatch(/링크에 들어가요/);
    expect(V40_LETTER_GUESS_COPY.screen.storageOn, "글자 고르기 화면이 이 브라우저에만 남는다고 말하지 않는다").toMatch(/이 브라우저에만 남아요/);
    expect(V40_LETTER_GUESS_COPY.screen.storageOn, "글자 고르기 화면이 링크에 안 들어간다고 말하지 않는다").toMatch(/링크에는 들어가지 않아요/);
    expect(V40_LETTER_GUESS_COPY.screen.storageOff, "자동 저장을 끄면 저장하지 않는다는 화면 문구가 바뀌었다").toMatch(/자동 저장을 꺼 두어서[^.]*저장하지 않아요/);
  });

  it.each(["", SECRET])("4.1 단계 2: 이 단계에 없는 선택 2부(내 답 나란히 놓기)와 이 창의 임시 저장소는 방침이 말하지 않는다 (%#)", (secret) => {
    // 만들지 않은 기능을 방침이 설명하면 거짓이다. 후속 PR 이 2부를 더할 때 이 단언을 문장과 함께 바꾼다.
    const notice = v4Paragraph(renderWithoutResearch(secret));
    expect(notice).not.toMatch(/내 답 나란히 놓기|겹쳐 놓은 답|세션 저장소|임시 저장소/);
  });
});

describe("30문항 개편본의 브라우저 보관과 무전송 안내", () => {
  it("실제 보관 기간과 제공하는 제어, 받은 링크와 구판 기록의 범위를 알린다", () => {
    const text = render();
    const start = text.indexOf(`30문항 웨딩코드 개편본(${MEASUREMENT_VERSION})`);
    const end = text.indexOf("공용 기기에서는 자동저장을 끄거나 이 개편본의 저장과 현재 답을 지워 주세요.", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const notice = text.slice(start, end);
    expect(notice).toContain(`${LIKERT_RETENTION_MS / (24 * 60 * 60 * 1000)}일 동안 이어하기에 사용`);
    expect(notice).toContain("읽거나 다시 방문하는 것만으로 기간을 늘리지 않습니다");
    expect(notice).toContain("저장된 기록은 사용자가 지우거나 새 답으로 덮어쓰기 전까지 브라우저 저장소에 남을 수 있습니다");
    expect(notice).toContain("이 브라우저에 내 답 자동 저장");
    expect(notice).toContain("이 개편본의 저장과 현재 답 지우기");
    expect(notice).toContain("기존 판의 답은 지우지 않습니다");
    expect(notice).toContain("초대와 두 사람 링크로 받은 답은 화면에만 두고 브라우저에 저장하지 않습니다");
    expect(notice).toContain("이미 전달한 링크는 회수되지 않으며");
    expect(text).toContain("현재 공개 웨딩코드와 기존 판의 링크 화면에서는 페이지 조회와 흐름 이벤트를 기록하지 않습니다");
    expect(text).toContain("브라우저 오류·성능 이벤트도 수집 서비스로 전송하지 않습니다");
  });
});
