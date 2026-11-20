// 읽기와 쓰기가 엇갈릴 때 옛 읽기가 방금 저장한 것을 덮지 않게 한다(2026-11-17).
//
// 화면은 다시 읽기(화면에 돌아올 때, 당겨서 새로 고침, 정렬 바꾸기)와 쓰기(하트, 준비 순서 빼기·넣기, 상담을
// 일정에 넣기)를 함께 한다. 쓰기 앞에 출발한 읽기가 쓰기가 끝난 뒤 도착하면, 서버가 쓰기 전에 만든 답일 수 있다.
// 그 답을 그리면 방금 담은 하트가 빠진 것처럼 보인다. 그래서:
//   - 쓰기를 기다리는 동안에는 읽지 않는다. 쓰기가 모두 끝나면 한 번 읽는다.
//   - 읽는 동안 쓰기가 시작되거나 끝났으면 그 답은 버린다(쓰기가 남았으면 끝난 뒤, 아니면 바로 다시 읽는다).
//   - 더 뒤에 시작한 읽기가 있으면 앞 읽기의 답은 버린다(앞 답이 늦게 와도 뒤 답을 덮지 않는다).

/** 화면 하나에 하나. `useRef(createReadGate())` 로 둔다. */
export function createReadGate() {
  let readTurn = 0;
  // 쓰기가 시작할 때마다 오른다. 쓰기를 기다리는 동안에는 읽기 표를 주지 않으므로, 표를 받은 뒤 이 값이 바뀌었으면
  // 그 읽기와 겹친 쓰기가 있었다는 뜻이다.
  let writeEpoch = 0;
  let pendingWrites = 0;
  let readAfterWrites = false;
  return {
    /** 읽어도 되면 표를 준다. 쓰기를 기다리는 중이면 null(쓰기가 모두 끝나면 `endWrite` 가 다시 읽으라고 한다). */
    beginRead() {
      readTurn += 1;
      if (pendingWrites > 0) {
        readAfterWrites = true;
        return null;
      }
      return { turn: readTurn, epoch: writeEpoch };
    },
    /** "apply": 그린다. "drop": 버린다(뒤 읽기나 쓰기 뒤 읽기가 대신한다). "reread": 버리고 바로 다시 읽는다. */
    endRead(ticket) {
      if (!ticket || ticket.turn !== readTurn) return "drop";
      if (ticket.epoch === writeEpoch) return "apply";
      if (pendingWrites > 0) {
        readAfterWrites = true;
        return "drop";
      }
      return "reread";
    },
    beginWrite() {
      pendingWrites += 1;
      writeEpoch += 1;
    },
    /** 쓰기 하나가 끝났다. 마지막 쓰기였고 미뤄 둔 읽기가 있으면 true(지금 읽는다). */
    endWrite() {
      pendingWrites = Math.max(0, pendingWrites - 1);
      if (pendingWrites > 0 || !readAfterWrites) return false;
      readAfterWrites = false;
      return true;
    },
  };
}
