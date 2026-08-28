import { landingContent } from "./landingContent";
import { NoteCard, Section, bodyText, noteText, ruled } from "./notebook";

/**
 * ③ 함께 보는 자리에 한 말은, 둘 다에게 남는다.
 *
 * (2026-08-28 제목 변경. 옛 제목은 "같은 얘기를 두 번 하지 않아도 돼요"였고 같은
 * 약속을 없어진 수고 쪽에서 말했다. 지금은 일어나는 일 쪽에서 말한다.)
 *
 * 이 제품의 제일 큰 차별점이고, **1:1 챗봇이 구조적으로 못 하는 자리**다.
 * 근거: `api/chat/route.ts:1889-1905` 가 `.eq("couple_id", dataCoupleId)` 로 읽고
 * sender_id 필터가 없다. 상대에게 직접 보낸 줄만 provider 입력에서 뺀다.
 *
 * 말로 설명하면 안 와닿아서 **시간이 지나는 장면**으로 보여준다. 화요일 밤 한 사람이
 * 남긴 말이 수요일 아침 다른 사람 화면에 있는 것 — 그게 전부다.
 */
export default function OneRoomSection() {
  const { oneRoom } = landingContent;

  return (
    <Section id="oneroom" eyebrow={oneRoom.eyebrow} title={oneRoom.title} tinted>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <p className={bodyText}>{oneRoom.body}</p>
          <p className={`mt-5 ${noteText}`}>{oneRoom.note}</p>
        </div>

        <NoteCard tilt={0.6}>
          <ol className="space-y-6">
            <li>
              {/* 손글씨(Gaegu)에 가운뎃점 U+00B7 글리프가 없다 — 쓰면 그 글자만
                  다른 서체로 그려진다. `scripts/subset-gaegu.py` 가 경고로 알려준다. */}
              <p className="landing-hand text-[14px] text-[var(--color-paper-pen)]">화요일 밤, 신부</p>
              <p className={`mt-1 ${ruled} text-[var(--color-paper-ink)]`}>
                예식장 견적이 800 더 나왔어. 오늘은 얘기 못 하겠다.
              </p>
            </li>
            <li>
              <p className="landing-hand text-[14px] text-[var(--color-paper-pen)]">수요일 아침, 신랑</p>
              <p className={`mt-1 ${ruled} text-[var(--color-paper-ink)]`}>
                어제 그거 봤어. 어디를 줄이면 될까?
              </p>
            </li>
            <li className="border-t border-[var(--color-paper-divider)] pt-5">
              <p className="landing-hand text-[14px] text-[var(--color-paper-ink-faint)]">아모라</p>
              <p className={`mt-1 ${ruled}`}>
                두 분이 어제 남긴 견적부터 같이 볼게요. 800을 어디서 메울지는
                두 분이 정하시면 돼요.
              </p>
            </li>
          </ol>
          <p className="mt-6 border-t border-[var(--color-paper-divider)] pt-4 text-[12px] leading-[1.7] text-[var(--color-paper-ink-faint)]">
            이름·금액은 기능을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요.
          </p>
        </NoteCard>
      </div>
    </Section>
  );
}
