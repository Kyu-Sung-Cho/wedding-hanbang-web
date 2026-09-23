"use client";

import { ArrowRight, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import Button from "@/components/ui/Button";
import { WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { buildV31Profile, compareV31, v31ChoiceLabels, type V31Insight, type V31PairItem, type V31Profile } from "@/lib/weddingCode/v31";
import { v31Body, v31Surface, v31Title } from "./WeddingCodeV31Inputs";
import WeddingCodeV31Sharing from "./WeddingCodeV31Sharing";

type EditHandler = (id?: string) => void;

function hasResponse(draft: V31Draft, id: string) {
  const question = WEDDING_CODE_V31_QUESTIONS.find(item => item.id === id);
  if (question) return draft.answers[question.id] !== undefined;
  const taste = WEDDING_CODE_V31_TASTES.find(item => `taste.${item.key}` === id);
  if (taste) return draft.tastes[taste.key] !== undefined;
  return id === "avoidances" ? draft.avoidances !== undefined
    : id === "priorities" ? draft.priorities !== undefined
      : id === "spending" ? draft.spending !== undefined : false;
}

function Insight({ item, onEdit }: { item: V31Insight; onEdit?: EditHandler }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return <p className={`${v31Body} border-b border-[var(--hb-hairline)] py-3`}>이 설명을 접었어요. <Button variant="ghost" onClick={() => setHidden(false)}>다시 보기</Button></p>;
  return <article className="border-b border-[var(--hb-hairline)] py-5 first:pt-0 last:border-0 last:pb-0" data-insight={item.id}>
    <h3 className={`text-lg leading-relaxed ${v31Title}`}>{item.title}</h3>
    <p className={`mt-2 ${v31Body}`}>{item.body}</p>
    <div className="mt-4 flex gap-2 rounded-lg bg-[var(--hb-surface-hover)] p-4">
      <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--hb-success)]" />
      <div><p className="text-xs font-semibold text-[var(--hb-success)]">준비할 때 이렇게 해봐요</p><p className={`mt-1 ${v31Body}`}>{item.nextStep}</p></div>
    </div>
    <details className={`mt-3 ${v31Body}`}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">어떤 답에서 나온 설명인가요?</summary>
      <ul className="space-y-3 pt-2">{item.evidence.map(answer => <li key={answer.id}>
        <p>{answer.text}</p><p className="mt-1 font-semibold text-[var(--hb-text-strong)]">{answer.answer}</p>
      </li>)}</ul>
    </details>
    <details className={`mt-1 ${v31Body}`}>
      <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-4">내 생각과 달라요</summary>
      <p className="mt-1">같은 답이어도 상황에 따라 뜻이 다를 수 있어요. 답을 바꾸거나 이 설명만 접어둘 수 있어요.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {onEdit ? item.evidence.map(answer => <Button key={answer.id} variant="secondary" onClick={() => onEdit(answer.id)} className="max-w-full whitespace-normal! text-left!">
          <Pencil aria-hidden="true" className="size-4 shrink-0" /><span>{answer.text} 답 수정</span>
        </Button>) : null}
        <Button variant="ghost" onClick={() => setHidden(true)}>이 설명 접기</Button>
      </div>
    </details>
  </article>;
}

function RawAnswers({ profile, draft, onEdit }: { profile: V31Profile; draft: V31Draft; onEdit?: EditHandler }) {
  const topics = profile.topics.map(topic => ({ ...topic, responses: topic.responses.filter(response => hasResponse(draft, response.id)) }))
    .filter(topic => topic.responses.length > 0);
  return <details className={`${v31Surface} mt-5 p-5 sm:p-7`}>
    <summary className={`min-h-11 cursor-pointer text-base ${v31Title}`}>문장별로 내가 고른 답 모두 보기</summary>
    <p className={`mt-2 ${v31Body}`}>중간 응답, 아직 모름, 계획 없음, 답하지 않음은 각각 그대로 남겨요.</p>
    {topics.map(topic => <section key={topic.key} className="mt-5">
      <h3 className={`text-sm ${v31Title}`}>{topic.title}</h3>
      <ul className="mt-2 divide-y divide-[var(--hb-hairline)]">{topic.responses.map(response => <li key={response.id} className="py-3">
        <p className={v31Body}>{response.text}</p><div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--hb-text-strong)]">{response.answer}</p>
          {onEdit ? <Button variant="ghost" onClick={() => onEdit(response.id)} aria-label={`${response.text} 답 수정`} size="sm">수정</Button> : null}
        </div>
      </li>)}</ul>
    </section>)}
  </details>;
}

function PersonalProfile({ draft, onEdit, nested = false }: { draft: V31Draft; onEdit?: EditHandler; nested?: boolean }) {
  const profile = buildV31Profile(draft);
  const unresolved = profile.unresolved.filter(item => hasResponse(draft, item.id));
  const [memo, setMemo] = useState("");
  const priorityInsightIds = new Set(profile.priorityGuides.map(item => item.id
    .replace(/^priority-taste\./, "direct-").replace(/^priority-avoid\./, "avoid-").replace(/^priority-/, "single-")));
  const insights = profile.insights.filter(item => !priorityInsightIds.has(item.id));
  const priorityStatus = draft.priorities?.status === "skipped" ? "우선순위는 이번에 고르지 않았어요."
    : draft.priorities?.status === "no_preference" ? "특히 지킬 것을 따로 고르지 않았어요."
      : draft.priorities?.status === "undecided" ? "우선순위는 아직 정하지 않았어요."
        : v31ChoiceLabels(draft.priorities, []).join(" · ");
  return <div>
    {draft.priorities !== undefined ? <section className={`${v31Surface} p-5 sm:p-7`}>
      <p className="text-xs font-semibold text-[var(--hb-success)]">내가 직접 고른 우선순위</p>
      <h2 className={`mt-2 text-xl ${v31Title}`}>이번 결혼식에서 지키고 싶은 것</h2>
      {profile.priorityLabels.length ? <ul className="mt-4 space-y-2">{profile.priorityLabels.map((label, index) => <li key={`${label}-${index}`} className={`flex gap-2 ${v31Body}`}><span aria-hidden="true" className="text-[var(--hb-success)]">·</span>{label}</li>)}</ul>
        : <p className={`mt-4 ${v31Body}`}>{priorityStatus}</p>}
      <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">{profile.priorityLabels.length ? "직접 고른 내용이에요. 동의 점수가 높은 순서로 정하지 않았어요." : "직접 고르지 않은 우선순위는 만들어 넣지 않았어요."}</p>
      {onEdit ? <Button variant="ghost" onClick={() => onEdit("priorities")} className="mt-2">우선순위 수정</Button> : null}
      {profile.priorityGuides.length ? <div className="mt-5 border-t border-[var(--hb-hairline)] pt-5" data-priority-guides>
        <p className={`mb-4 text-base ${v31Title}`}>이 기준으로 준비를 시작해 봐요</p>
        {profile.priorityGuides.map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}
      </div> : null}
    </section> : null}
    {insights.length || !profile.priorityGuides.length ? <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-xl ${v31Title}`}>내 답을 함께 보면</h2>
      <p className={`mb-5 mt-2 ${v31Body}`}>내가 고른 답을 준비할 때 어떻게 활용할지 살펴봐요. 먼저 보이는 설명은 중요도 순위가 아니에요.</p>
      {insights.length ? <>
        {insights.slice(0, 3).map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}
        {insights.length > 3 ? <details className="mt-5 border-t border-[var(--hb-hairline)] pt-4"><summary className={`flex min-h-11 cursor-pointer items-center text-sm ${v31Title}`}>다른 설명 {insights.length - 3}개 더 보기</summary><div className="pt-4">{insights.slice(3).map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}</div></details> : null}
      </> : <p className={`rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v31Body}`}>아래에 내가 고른 답을 그대로 정리했어요. 낮게 답하거나 아직 정하지 않은 것을 반대 취향으로 바꾸지 않아요. 생각이 달라지면 다시 답해도 괜찮아요.</p>}
    </section> : null}
    <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-lg ${v31Title}`}>이번 결혼식에서 피하고 싶은 것</h2>
      <p className={`mt-3 ${v31Body}`} data-avoidance-summary>{profile.avoidanceLabels.join(" · ")}</p>
      {draft.avoidances?.status === "answered" ? <p className={`mt-3 ${v31Body}`}>후보를 알아볼 때 이 부분도 함께 확인해 보세요. 원하는 것과 피하고 싶은 것이 함께 있다면, 어느 정도까지 괜찮은지 이야기해 봐요.</p> : null}
      {onEdit ? <Button variant="ghost" onClick={() => onEdit("avoidances")} className="mt-2">피하고 싶은 것 수정</Button> : null}
    </section>
    <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-xl ${v31Title}`}>내가 그려본 결혼식</h2>
      <p className={`mt-2 ${v31Body}`}>사진이나 후보를 함께 볼 때 이 선택부터 꺼내 보세요. 실제 예약 조건이나 확정한 계획은 아니에요.</p>
      <dl className="mt-4 divide-y divide-[var(--hb-hairline)]">{profile.tastes.map(taste => <div key={taste.key} className="py-3">
        <div className="flex items-center justify-between gap-3"><dt className={`text-sm ${v31Title}`}>{taste.title}</dt>{onEdit ? <Button variant="ghost" onClick={() => onEdit(`taste.${taste.key}`)} size="sm" aria-label={`${taste.title} 취향 수정`}>수정</Button> : null}</div>
        <dd className={`mt-1 ${v31Body}`}>{taste.labels.join(" · ")}</dd>
      </div>)}</dl>
    </section>
    <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-lg ${v31Title}`}>다른 곳을 줄여서라도 더 쓰고 싶은 곳</h2>
      <p className={`mt-3 ${v31Body}`}>{draft.spending?.status === "no_preference" ? "더 쓰고 싶은 곳은 지금 없어요." : profile.spendingLabels.join(" · ")}</p>
      <p className={`mt-3 ${v31Body}`}>{draft.spending?.status === "no_preference" ? "지금은 다른 비용을 줄여서까지 더 쓰고 싶은 곳이 없다는 답이에요. 상대가 더 쓰고 싶은 곳이 있다면, 그 이유와 전체 예산 안에서 가능한지 함께 살펴봐요." : draft.spending?.status === "answered" ? "전체 예산을 늘리겠다는 약속은 아니에요. 더 쓸 곳과 줄일 수 있는 곳을 함께 이야기해 보세요." : "이 질문에서는 실제 금액이나 전체 예산을 늘릴지를 정하지 않아요. 더 쓰고 싶은 곳이 생기면 다시 답해도 괜찮아요."}</p>
      {onEdit ? <Button variant="ghost" onClick={() => onEdit("spending")} className="mt-2">더 쓰고 싶은 곳 수정</Button> : null}
    </section>
    {unresolved.length ? <details className={`${v31Surface} mt-5 p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v31Title}`}>모르거나, 해당하지 않거나, 답하지 않은 내용</summary>
      <p className={`mt-2 ${v31Body}`}>안 정했다고 준비가 부족한 것은 아니에요. 상황이 생겼을 때 다시 생각해도 괜찮아요.</p>
      <ul className="mt-3 divide-y divide-[var(--hb-hairline)]">{unresolved.map(item => <li key={item.id} className="py-3"><p className={v31Body}>{item.text}</p><p className={`mt-1 text-sm ${v31Title}`}>{item.answer}</p>{onEdit ? <Button variant="ghost" onClick={() => onEdit(item.id)} className="mt-1" aria-label={`${item.text} 답 수정`}>다시 답하기</Button> : null}</li>)}</ul>
    </details> : null}
    <RawAnswers profile={profile} draft={draft} onEdit={onEdit} />
    {!nested ? <details className={`${v31Surface} mt-5 p-5 sm:p-7`} data-optional-personal-note>
      <summary className={`flex min-h-11 cursor-pointer items-center text-base ${v31Title}`}>내 메모 남기기 (선택)</summary>
      <label htmlFor="wedding-code-personal-note" className={`mt-3 block text-sm ${v31Title}`}>보기에는 없지만, 내가 남기고 싶은 것</label>
      <p className={`mb-3 mt-2 ${v31Body}`}>쓰지 않아도 결과를 보는 데는 문제가 없어요. 메모는 이 화면에서만 볼 수 있고, 자동 저장이나 공유 링크에는 포함되지 않아요. 새로고침하거나 답을 수정하면 지워져요.</p>
      <textarea id="wedding-code-personal-note" maxLength={500} value={memo} onChange={event => setMemo(event.target.value)} rows={3}
        className="w-full resize-y rounded-lg border border-paper-outline bg-[var(--hb-surface-raised)] p-3 text-sm leading-relaxed text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--hb-focus-ring)]" placeholder="예: 입장할 때는 우리 둘이 같이 걷고 싶어요." />
    </details> : null}
  </div>;
}

function PairItem({ item }: { item: V31PairItem }) {
  return <article className="border-b border-[var(--hb-hairline)] py-5 first:pt-0 last:border-0 last:pb-0" data-comparison={item.id}>
    {item.isPriority ? <p className="mb-2 text-xs font-semibold text-[var(--hb-success)]">둘 중 한 사람이 우선순위로 고른 내용</p> : null}
    <h3 className={`text-base leading-relaxed ${v31Title}`}>{item.title}</h3>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      {[{ label: "먼저 답한 사람", value: item.first }, { label: "나중에 답한 사람", value: item.second }].map(answer => <div key={answer.label} className="rounded-lg bg-[var(--hb-surface-hover)] p-3"><dt className="text-xs text-[var(--hb-text-muted)]">{answer.label}</dt><dd className={`mt-1 text-sm font-semibold leading-relaxed ${v31Title}`}>{answer.value}</dd></div>)}
    </dl>
    {item.sharedLabels?.length ? <p className={`mt-3 ${v31Body}`}><span className={v31Title}>함께 고른 보기:</span> {item.sharedLabels.join(" · ")}</p> : null}
    <p className={`mt-3 ${v31Body}`}>{item.followUp}</p>
  </article>;
}

function PairSection({ title, description, items, empty }: { title: string; description: string; items: V31PairItem[]; empty: string }) {
  return <section className={`${v31Surface} mt-5 p-5 sm:p-7`}>
    <h2 className={`text-xl ${v31Title}`}>{title}</h2><p className={`mb-5 mt-2 ${v31Body}`}>{description}</p>
    {items.length ? <>{items.slice(0, 3).map(item => <PairItem key={item.id} item={item} />)}{items.length > 3 ? <details className="mt-4"><summary className={`flex min-h-11 cursor-pointer items-center text-sm ${v31Title}`}>나머지 {items.length - 3}개 보기</summary><div className="pt-3">{items.slice(3).map(item => <PairItem key={item.id} item={item} />)}</div></details> : null}</> : <p className={`rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v31Body}`}>{empty}</p>}
  </section>;
}

export default function WeddingCodeV31Results({ draft, first, received, shareOrigin, onEdit, onRestart, onMore, optionalCount = 0 }: {
  draft: V31Draft; first: V31Draft | null; received: boolean; shareOrigin: string;
  onEdit: EditHandler; onRestart: () => void;
  onMore?: () => void; optionalCount?: number;
}) {
  const profile = buildV31Profile(draft);
  const items = first ? compareV31(first, draft).filter(item => hasResponse(first, item.id) || hasResponse(draft, item.id)) : [];
  const editable = received ? undefined : onEdit;
  return <div data-result={first ? "couple-v31" : "solo-v31"} data-empty={!profile.hasContent || undefined}>
    <header className="mb-6">
      <p className="text-xs font-semibold text-[var(--hb-success)]">웨딩코드 · {first ? "두 사람의 결과" : "내 결과"}</p>
      <h1 className={`mt-3 text-3xl leading-snug ${v31Title}`}>{first ? "우리, 어디부터 맞춰볼까요?" : profile.hasContent ? "내가 바라는 결혼식과 준비 방식" : "아직 정하지 않아도 괜찮아요"}</h1>
      <p className={`mt-3 ${v31Body}`}>{first ? "함께 원하는 것부터, 서로 다르게 답한 것까지 나란히 봐요. 같은 답도 이유는 다를 수 있으니, 각자 떠올린 장면을 이야기해 보세요." : profile.hasContent ? "지금 직접 고른 취향과 답을 정리했어요. 맞는 설명인지 읽어보고, 내 생각과 다르면 답을 고칠 수 있어요." : "모르거나 해당하지 않는다고 답한 것을 취향으로 바꾸지는 않았어요. 관심 가는 질문 하나부터 다시 답해도 돼요."}</p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">{received ? "받은 링크에 담긴 답이에요. 이름이나 본인 여부는 확인하지 않아요." : `답을 남긴 질문은 ${profile.respondedCount}개예요. 동의 정도를 고른 문장은 ${profile.ratedCount}개예요.`} 취향과 바람은 달라질 수 있어요. 성격 진단이나 궁합 점수는 아니에요.</p>
    </header>
    {first ? <>
      <PairSection title="둘 다 원한다고 답한 것" description="문장에 둘 다 ‘그런 편’ 이상으로 답했거나, 구체 선택을 같게 고른 내용이에요. 중간 응답이나 둘 다 모르는 내용은 여기에 넣지 않았어요." items={items.filter(item => item.kind === "shared_wish")} empty={items.some(item => item.id !== "avoidances" && item.sharedLabels?.length) ? "일부 보기는 함께 골랐어요. 아래 차이에서 함께 고른 보기와 나머지 선택을 나란히 볼 수 있어요." : "이번 답에서는 함께 원한다고 확인한 내용이 없어요. 한 사람의 답부터 이유를 들어보세요."} />
      {items.some(item => item.kind === "shared_avoidance") ? <PairSection title="함께 피하고 싶은 것" description="피하고 싶은 것으로 같은 보기를 골랐어요. 구체적인 후보를 볼 때 어느 정도까지 괜찮은지 함께 확인해 보세요." items={items.filter(item => item.kind === "shared_avoidance")} empty="" /> : null}
      {items.some(item => item.kind === "open_preference") ? <PairSection title="열어 두고 있는 취향" description="한 사람 이상이 ‘어느 쪽도 괜찮아요’라고 답했어요. 모른다는 뜻이나 특정 선택에 합의했다는 뜻은 아니에요." items={items.filter(item => item.kind === "open_preference")} empty="" /> : null}
      <PairSection title="먼저 이야기해 볼 차이" description="누가 맞는지 정하지 않아요. 둘 중 한 사람이 우선순위로 고른 내용부터 보여줘요. 나머지는 질문 순서이며, 차이의 크기가 문제의 크기를 뜻하지 않아요." items={items.filter(item => item.kind === "different")} empty={items.every(item => item.kind === "unavailable") ? "두 사람이 같은 항목에 답한 내용이 없어 아직 차이를 비교할 수 없어요." : "지금 비교할 수 있는 답에서는 뚜렷한 차이가 나오지 않았어요. 그래도 실제 후보와 금액은 함께 정해야 해요."} />
      <details className={`${v31Surface} mt-5 p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v31Title}`}>낮게 답하거나 특별히 고르지 않은 내용</summary><p className={`my-3 ${v31Body}`}>둘 다 낮게 답했다고 반대 취향이 같다는 뜻은 아니에요. 중간 응답이나 따로 고르지 않은 답도 그대로 비교해요.</p>{items.filter(item => item.kind === "shared_distance" || item.kind === "middle").map(item => <PairItem key={item.id} item={item} />)}</details>
      {items.some(item => item.kind === "unavailable") ? <details className={`${v31Surface} mt-5 p-5 sm:p-7`}><summary className={`flex min-h-11 cursor-pointer text-base ${v31Title}`}>아직 함께 비교하지 않은 내용</summary><p className={`my-3 ${v31Body}`}>한 사람만 답했거나, 아직 모름·계획 없음·답하지 않음으로 남긴 내용이에요. 의견 차이로 해석하지 않아요.</p>{items.filter(item => item.kind === "unavailable").map(item => <PairItem key={item.id} item={item} />)}</details> : null}
      <section className="mt-5 space-y-3" aria-label="각자 답한 결과">
        <details className={`${v31Surface} p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v31Title}`}>먼저 답한 사람의 개인 결과</summary><div className="mt-4"><PersonalProfile draft={first} nested /></div></details>
        <details className={`${v31Surface} p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v31Title}`}>나중에 답한 사람의 개인 결과</summary><div className="mt-4"><PersonalProfile draft={draft} onEdit={editable} nested /></div></details>
      </section>
    </> : <PersonalProfile draft={draft} onEdit={editable} />}
    {!received && onMore && optionalCount > 0 ? <section className={`${v31Surface} mt-5 p-5 sm:p-7`} aria-label="선택 질문">
      <h2 className={`text-lg ${v31Title}`}>궁금한 부분이 더 있다면</h2>
      <p className={`mt-2 ${v31Body}`}>꽃 장식이나 세부 준비 방식까지 더 살펴볼 수 있어요. 남은 {optionalCount}개를 전부 답할 필요는 없고, 언제든 결과로 돌아올 수 있어요.</p>
      <Button variant="secondary" fullWidth onClick={onMore} className="mt-4 whitespace-normal!">원하면 더 알아보기 (선택)</Button>
    </section> : null}
    <p className={`mt-6 rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v31Body}`}>예약 전에는 추가 비용을 포함한 총액과 취소·변경 조건을 서면으로 확인해 주세요.</p>
    <WeddingCodeV31Sharing shareOrigin={shareOrigin} first={first ?? draft} second={first ? draft : undefined} received={received} />
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {editable ? <Button variant="secondary" onClick={() => onEdit()} className="whitespace-normal!"><Pencil aria-hidden="true" className="size-4 shrink-0" />{first ? "내가 방금 답한 내용 수정" : "내 답 수정하기"}</Button> : null}
      <Button variant="ghost" onClick={onRestart} className="whitespace-normal!"><RotateCcw aria-hidden="true" className="size-4 shrink-0" />{received ? "내 답으로 새로 시작하기" : "처음부터 다시 답하기"}</Button>
    </div>
  </div>;
}
