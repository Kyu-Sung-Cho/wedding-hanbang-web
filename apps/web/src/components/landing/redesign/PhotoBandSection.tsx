import { landingContent } from "./landingContent";
import { band, noteText, shell } from "./notebook";

/**
 * ⑧ 전면 사진 자리.
 *
 * 2026-09-03 시안이 다크 밴드 **바로 위**에 둔 가로 띠다.
 *
 * ## 왜 빈 자리를 화면에 내보내나
 *
 * 이 랜딩에는 사람 사진이 한 장도 없다. 결혼 준비를 파는 화면에서 그건 큰 구멍이고,
 * 시안이 자리를 두 곳(여기와 ④ 섹션) 잡아 둔 이유다. 지금은 사진이 없으니 **무엇을
 * 넣어야 하는지 화면이 스스로 말하게** 둔다 — 자리만 비워 두면 다음 사람이 아무
 * 스톡 사진이나 채운다.
 *
 * 출시 전에 실제 사진으로 바꾼다. 그때 이 컴포넌트와 `photoBand` 블록이 함께 없어진다.
 */
export default function PhotoBandSection() {
  const { photoBand } = landingContent;
  // 사진이 들어오기 전에는 제작 안내문을 방문자에게 내보내지 않는다(landingContent 주석).
  if (!photoBand.visible) return null;

  return (
    // 랜드마크에는 이름이 있어야 한다 — 이름 없는 <section> 이 여럿이면 스크린리더
    // 목록에서 "section" 만 줄줄이 나온다. 화면에 제목을 두지 않으므로 sr-only 로 준다.
    <section
      aria-labelledby="photo-band-title"
      className={`${band} bg-[var(--color-paper-tint)]`}
    >
      <div className={shell}>
        <div className="rounded-[12px] border border-dashed border-[var(--color-paper-outline)] px-6 py-12 text-center">
          {/* h2 는 랜드마크 이름이라 화면에 안 나간다 — 표시 타입이 아니므로 공유
              제목 스케일을 쓰지 않는다. 보이는 글자는 아래 <p> 가 그린다. */}
          <h2 id="photo-band-title" className="sr-only">
            {photoBand.title}
          </h2>
          <p aria-hidden className="text-[14px] font-semibold text-[var(--color-paper-ink-soft)]">
            {photoBand.title}
          </p>
          {photoBand.captions.map((caption) => (
            <p
              key={caption}
              className={`mx-auto mt-2 max-w-[52ch] ${noteText}`}
            >
              {caption}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
