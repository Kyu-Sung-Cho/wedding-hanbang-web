/**
 * 웨딩코드 4.0 입구 문구(작은 묶음).
 *
 * 기본 진입(v3.1) 화면의 입구(app/wedding-code/entry.ts, WeddingCodeEntryClient.tsx)가 v4 에서 가져오는 문구는 이 파일 하나뿐이다.
 * 화면 문구 전체(copy.ts)는 크기가 커서 입구가 가져오면 v4 를 쓰지 않는 방문자의 첫 화면에도 실린다. 그래서 입구가 쓰는 작은 문구만
 * 여기에 두고, copy.ts 는 같은 값을 그대로 가리킨다(같은 말을 두 곳에 쓰지 않는다). 이 파일은 다른 파일을 가져오지 않는다.
 *
 * 규칙은 copy.ts 와 같다: 해요체, 줄표와 백분율 기호 없음, 숫자 없음. 검증 여부를 알리는 고지 문장은 여기에 쓰지 않는다
 * (고지는 copy.ts 의 화면 묶음에만 있다).
 */
export const V40_ENTRY_COPY = {
  /**
   * 기본 진입이 v4 로 바뀐 뒤 ?v=v3.1-preferences(답 없음)로 연 예전 웨딩코드 시작 화면 위에 붙인다. 기본 진입이 v3.1 인 동안에는 보이지 않는다.
   * 새 웨딩코드로 가는 길은 이 단추 하나뿐이다(v3.1 화면의 다시 시작은 v3.1 빈 입구로 간다).
   * 단추 문구는 v4 시작 화면의 같은 이름 단추(copy.ts 의 intro.newVersionButton)와 같은 값이다.
   */
  olderVersion: {
    notice: "예전 웨딩코드예요. 질문이 바뀐 새 웨딩코드가 있어요.",
    startNewButton: "새 웨딩코드로 시작하기",
  },
  /**
   * 읽을 수 없는 v4 링크의 오류 화면(title, body, startButton). notice 는 title 과 같은 말로 시작해서 그 화면에서는 쓰지 않고,
   * WeddingCodeV40ClientProps.initialNotice 로 넘기는 한 줄로만 쓴다.
   */
  brokenLink: {
    title: "링크를 읽지 못했어요",
    notice: "링크를 읽지 못했어요. 처음부터 시작할 수 있어요.",
    body: "링크가 중간에 잘렸거나 끝에 글자가 더 붙었을 수 있어요. 끝의 글자를 지우고 다시 열어 보거나, 보낸 사람에게 링크를 다시 받아 주세요.",
    startButton: "처음부터 시작하기",
  },
  /** v4 화면을 늦게 불러오는 동안 자리에 두는 낭독용 글. */
  loadingLabel: "불러오는 중이에요",
} as const;
