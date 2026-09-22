"use client";

import { ArrowRight, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import Button from "@/components/ui/Button";
import { WEDDING_CODE_V30_QUESTIONS, WEDDING_CODE_V30_TASTES, type V30Draft } from "@/constants/weddingCodeV30";
import { buildV30Profile, compareV30, v30ChoiceLabels, type V30Insight, type V30PairItem, type V30Profile } from "@/lib/weddingCode/v30";
import { v30Body, v30Surface, v30Title } from "./WeddingCodeV30Inputs";
import WeddingCodeV30Sharing from "./WeddingCodeV30Sharing";

type EditHandler = (id?: string) => void;

function Insight({ item, onEdit }: { item: V30Insight; onEdit?: EditHandler }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return <p className={`${v30Body} border-b border-[var(--hb-hairline)] py-3`}>이 설명을 접었어요. <Button variant="ghost" onClick={() => setHidden(false)}>다시 보기</Button></p>;
  return <article className="border-b border-[var(--hb-hairline)] py-5 first:pt-0 last:border-0 last:pb-0" data-insight={item.id}>
    <h3 className={`text-lg leading-relaxed ${v30Title}`}>{item.title}</h3>
    <p className={`mt-2 ${v30Body}`}>{item.body}</p>
    <div className="mt-4 flex gap-2 rounded-lg bg-[var(--hb-surface-hover)] p-4">
      <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--hb-success)]" />
      <div><p className="text-xs font-semibold text-[var(--hb-success)]">준비할 때 이렇게 해봐요</p><p className={`mt-1 ${v30Body}`}>{item.nextStep}</p></div>
    </div>
    <details className={`mt-3 ${v30Body}`}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">어떤 답에서 나온 설명인가요?</summary>
      <ul className="space-y-3 pt-2">{item.evidence.map(answer => <li key={answer.id}>
        <p>{answer.text}</p><p className="mt-1 font-semibold text-[var(--hb-text-strong)]">{answer.answer}</p>
      </li>)}</ul>
    </details>
    <details className={`mt-1 ${v30Body}`}>
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

function RawAnswers({ profile, onEdit }: { profile: V30Profile; onEdit?: EditHandler }) {
  return <details className={`${v30Surface} mt-5 p-5 sm:p-7`}>
    <summary className={`min-h-11 cursor-pointer text-base ${v30Title}`}>답한 문장과 상태 모두 보기</summary>
    <p className={`mt-2 ${v30Body}`}>중간 응답, 아직 모름, 계획 없음, 답하지 않음은 각각 그대로 남겨요.</p>
    {profile.topics.map(topic => <section key={topic.key} className="mt-5">
      <h3 className={`text-sm ${v30Title}`}>{topic.title}</h3>
      <ul className="mt-2 divide-y divide-[var(--hb-hairline)]">{topic.responses.map(response => <li key={response.id} className="py-3">
        <p className={v30Body}>{response.text}</p><div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--hb-text-strong)]">{response.answer}</p>
          {onEdit ? <Button variant="ghost" onClick={() => onEdit(response.id)} aria-label={`${response.text} 답 수정`} size="sm">수정</Button> : null}
        </div>
      </li>)}</ul>
    </section>)}
  </details>;
}

function PersonalProfile({ draft, onEdit, nested = false }: { draft: V30Draft; onEdit?: EditHandler; nested?: boolean }) {
  const profile = buildV30Profile(draft);
  const [memo, setMemo] = useState("");
  const priorityLabels = profile.priorityLabels.length ? profile.priorityLabels : [draft.priorities?.status === "no_preference" ? "특히 지킬 것을 따로 고르지 않았어요." : draft.priorities?.status === "undecided" ? "우선순위는 아직 정하지 않았어요." : v30ChoiceLabels(draft.priorities, []).join(" · ")];
  return <div>
    <section className={`${v30Surface} p-5 sm:p-7`}>
      <p className="text-xs font-semibold text-[var(--hb-success)]">내가 직접 고른 우선순위</p>
      <h2 className={`mt-2 text-xl ${v30Title}`}>이번 결혼식에서 지키고 싶은 것</h2>
      <ul className="mt-4 space-y-2">{priorityLabels.map((label, index) => <li key={`${label}-${index}`} className={`flex gap-2 ${v30Body}`}><span aria-hidden="true" className="text-[var(--hb-success)]">·</span>{label}</li>)}</ul>
      <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">{profile.priorityLabels.length ? "직접 고른 내용이에요. 동의 점수가 높은 순서로 정하지 않았어요." : "직접 고르지 않은 우선순위는 만들어 넣지 않았어요."}</p>
      {onEdit ? <Button variant="ghost" onClick={() => onEdit("priorities")} className="mt-2">우선순위 수정</Button> : null}
    </section>
    <section className={`${v30Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-xl ${v30Title}`}>내 답을 함께 보면</h2>
      <p className={`mb-5 mt-2 ${v30Body}`}>따로 답한 내용을 연결해 봤어요. 먼저 보이는 설명은 중요도 순위가 아니에요.</p>
      {profile.insights.length ? <>
        {profile.insights.slice(0, 3).map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}
        {profile.insights.length > 3 ? <details className="mt-5 border-t border-[var(--hb-hairline)] pt-4"><summary className={`flex min-h-11 cursor-pointer items-center text-sm ${v30Title}`}>다른 연결 설명 {profile.insights.length - 3}개 더 보기</summary><div className="pt-4">{profile.insights.slice(3).map(item => <Insight key={item.id} item={item} onEdit={onEdit} />)}</div></details> : null}
      </> : <p className={`rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v30Body}`}>지금 답만으로 여러 내용을 연결한 설명을 만들지는 않았어요. 아래에 직접 고른 취향과 문장별 답을 그대로 정리했어요. 안 고른 것을 반대 취향으로 해석하지 않아요.</p>}
    </section>
    <section className={`${v30Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-xl ${v30Title}`}>내가 그려본 결혼식</h2>
      <p className={`mt-2 ${v30Body}`}>사진이나 후보를 함께 볼 때 이 선택부터 꺼내 보세요. 실제 예약 조건이나 확정한 계획은 아니에요.</p>
      <dl className="mt-4 divide-y divide-[var(--hb-hairline)]">{profile.tastes.map(taste => <div key={taste.key} className="py-3">
        <div className="flex items-center justify-between gap-3"><dt className={`text-sm ${v30Title}`}>{taste.title}</dt>{onEdit ? <Button variant="ghost" onClick={() => onEdit(`taste.${taste.key}`)} size="sm" aria-label={`${taste.title} 취향 수정`}>수정</Button> : null}</div>
        <dd className={`mt-1 ${v30Body}`}>{taste.labels.join(" · ")}</dd>
      </div>)}</dl>
    </section>
    <section className={`${v30Surface} mt-5 p-5 sm:p-7`}>
      <h2 className={`text-lg ${v30Title}`}>다른 곳을 줄여서라도 더 쓰고 싶은 곳</h2>
      <p className={`mt-3 ${v30Body}`}>{draft.spending?.status === "no_preference" ? "더 쓰고 싶은 곳은 지금 없어요." : profile.spendingLabels.join(" · ")}</p>
      <p className={`mt-3 ${v30Body}`}>이건 비용을 나눌 때의 희망이에요. 전체 예산을 늘리겠다는 약속은 아니에요. 더 쓸 곳과 줄일 수 있는 곳, 두 가지를 함께 이야기해 보세요.</p>
      {onEdit ? <Button variant="ghost" onClick={() => onEdit("spending")} className="mt-2">더 쓰고 싶은 곳 수정</Button> : null}
    </section>
    {profile.unresolved.length ? <details className={`${v30Surface} mt-5 p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v30Title}`}>모르거나, 해당하지 않거나, 답하지 않은 내용</summary>
      <p className={`mt-2 ${v30Body}`}>안 정했다고 준비가 부족한 것은 아니에요. 상황이 생겼을 때 다시 생각해도 괜찮아요.</p>
      <ul className="mt-3 divide-y divide-[var(--hb-hairline)]">{profile.unresolved.map(item => <li key={item.id} className="py-3"><p className={v30Body}>{item.text}</p><p className={`mt-1 text-sm ${v30Title}`}>{item.answer}</p>{onEdit ? <Button variant="ghost" onClick={() => onEdit(item.id)} className="mt-1" aria-label={`${item.text} 답 수정`}>다시 답하기</Button> : null}</li>)}</ul>
    </details> : null}
    <RawAnswers profile={profile} onEdit={onEdit} />
    {!nested ? <section className={`${v30Surface} mt-5 p-5 sm:p-7`}>
      <label htmlFor="wedding-code-personal-note" className={`text-base ${v30Title}`}>보기에는 없지만, 내가 꼭 남기고 싶은 것</label>
      <p className={`mb-3 mt-2 ${v30Body}`}>지금 화면에서만 쓰는 메모예요. 공유 링크에 넣거나 저장하지 않고, 새로고침하거나 답을 수정하면 지워져요.</p>
      <textarea id="wedding-code-personal-note" maxLength={500} value={memo} onChange={event => setMemo(event.target.value)} rows={3}
        className="w-full resize-y rounded-lg border border-paper-outline bg-[var(--hb-surface-raised)] p-3 text-sm leading-relaxed text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-[var(--hb-focus-ring)]" placeholder="예: 입장할 때는 우리 둘이 같이 걷고 싶어요." />
    </section> : null}
  </div>;
}

function PairItem({ item }: { item: V30PairItem }) {
  return <article className="border-b border-[var(--hb-hairline)] py-5 first:pt-0 last:border-0 last:pb-0" data-comparison={item.id}>
    {item.isPriority ? <p className="mb-2 text-xs font-semibold text-[var(--hb-success)]">둘 중 한 사람이 우선순위로 고른 내용</p> : null}
    <h3 className={`text-base leading-relaxed ${v30Title}`}>{item.title}</h3>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      {[{ label: "먼저 답한 사람", value: item.first }, { label: "나중에 답한 사람", value: item.second }].map(answer => <div key={answer.label} className="rounded-lg bg-[var(--hb-surface-hover)] p-3"><dt className="text-xs text-[var(--hb-text-muted)]">{answer.label}</dt><dd className={`mt-1 text-sm font-semibold leading-relaxed ${v30Title}`}>{answer.value}</dd></div>)}
    </dl>
    <p className={`mt-3 ${v30Body}`}>{item.followUp}</p>
  </article>;
}

function PairSection({ title, description, items, empty }: { title: string; description: string; items: V30PairItem[]; empty: string }) {
  return <section className={`${v30Surface} mt-5 p-5 sm:p-7`}>
    <h2 className={`text-xl ${v30Title}`}>{title}</h2><p className={`mb-5 mt-2 ${v30Body}`}>{description}</p>
    {items.length ? <>{items.slice(0, 3).map(item => <PairItem key={item.id} item={item} />)}{items.length > 3 ? <details className="mt-4"><summary className={`flex min-h-11 cursor-pointer items-center text-sm ${v30Title}`}>나머지 {items.length - 3}개 보기</summary><div className="pt-3">{items.slice(3).map(item => <PairItem key={item.id} item={item} />)}</div></details> : null}</> : <p className={`rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v30Body}`}>{empty}</p>}
  </section>;
}

export default function WeddingCodeV30Results({ draft, first, received, shareOrigin, onEdit, onRestart }: {
  draft: V30Draft; first: V30Draft | null; received: boolean; shareOrigin: string;
  onEdit: EditHandler; onRestart: () => void;
}) {
  const profile = buildV30Profile(draft);
  const items = first ? compareV30(first, draft) : [];
  const editable = received ? undefined : onEdit;
  return <div data-result={first ? "couple-v30" : "solo-v30"} data-empty={!profile.hasContent || undefined}>
    <header className="mb-6">
      <p className="text-xs font-semibold text-[var(--hb-success)]">웨딩코드 · {first ? "두 사람의 결과" : "내 결과"}</p>
      <h1 className={`mt-3 text-3xl leading-snug ${v30Title}`}>{first ? "우리, 어디부터 맞춰볼까요?" : profile.hasContent ? "내가 바라는 결혼식과 준비 방식" : "아직 정하지 않아도 괜찮아요"}</h1>
      <p className={`mt-3 ${v30Body}`}>{first ? "함께 원하는 것부터, 서로 다르게 답한 것까지 나란히 봐요. 같은 답도 이유는 다를 수 있으니, 각자 떠올린 장면을 이야기해 보세요." : profile.hasContent ? "지금 직접 고른 취향과 답을 정리했어요. 맞는 설명인지 읽어보고, 내 생각과 다르면 답을 고칠 수 있어요." : "모르거나 해당하지 않는다고 답한 것을 취향으로 바꾸지는 않았어요. 관심 가는 질문 하나부터 다시 답해도 돼요."}</p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">{received ? "받은 링크에 담긴 답이에요. 이름이나 본인 여부는 확인하지 않아요." : `전체 ${WEDDING_CODE_V30_QUESTIONS.length + WEDDING_CODE_V30_TASTES.length + 2}개 질문 중 ${profile.respondedCount}개에 상태를 남겼어요. 동의 정도를 고른 문장은 ${profile.ratedCount}개예요.`} 취향과 바람은 달라질 수 있어요. 성격 진단이나 궁합 점수는 아니에요.</p>
    </header>
    {first ? <>
      <PairSection title="둘 다 원한다고 답한 것" description="문장에 둘 다 ‘그런 편’ 이상으로 답했거나, 구체 선택을 같게 고른 내용이에요. 중간 응답이나 둘 다 모르는 내용은 여기에 넣지 않았어요." items={items.filter(item => item.kind === "shared_wish")} empty="이번 답에서는 함께 원한다고 확인한 내용이 없어요. 한 사람의 답부터 이유를 들어보세요." />
      <PairSection title="먼저 이야기해 볼 차이" description="누가 맞는지 정하지 않아요. 둘 중 한 사람이 우선순위로 고른 내용부터 보여줘요. 나머지는 질문 순서이며, 차이의 크기가 문제의 크기를 뜻하지 않아요." items={items.filter(item => item.kind === "different")} empty={items.every(item => item.kind === "unavailable") ? "두 사람이 같은 항목에 답한 내용이 없어 아직 차이를 비교할 수 없어요." : "지금 비교할 수 있는 답에서는 뚜렷한 차이가 나오지 않았어요. 그래도 실제 후보와 금액은 함께 정해야 해요."} />
      <details className={`${v30Surface} mt-5 p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v30Title}`}>낮게 답한 문장과 중간 응답도 보기</summary><p className={`my-3 ${v30Body}`}>둘 다 낮게 답했다고 반대 취향이 같다는 뜻은 아니에요. 중간 응답을 원하는 것으로 올려 해석하지 않아요.</p>{items.filter(item => item.kind === "shared_distance" || item.kind === "middle").map(item => <PairItem key={item.id} item={item} />)}</details>
      {items.some(item => item.kind === "unavailable") ? <PairSection title="아직 함께 비교하지 않은 내용" description="아직 모름, 계획 없음, 답하지 않음은 의견 차이와 구분해요. 원할 때 다시 답해도 괜찮아요." items={items.filter(item => item.kind === "unavailable")} empty="" /> : null}
      <section className="mt-5 space-y-3" aria-label="각자 답한 결과">
        <details className={`${v30Surface} p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v30Title}`}>먼저 답한 사람의 개인 결과</summary><div className="mt-4"><PersonalProfile draft={first} nested /></div></details>
        <details className={`${v30Surface} p-5 sm:p-7`}><summary className={`min-h-11 cursor-pointer text-base ${v30Title}`}>나중에 답한 사람의 개인 결과</summary><div className="mt-4"><PersonalProfile draft={draft} onEdit={editable} nested /></div></details>
      </section>
    </> : <PersonalProfile draft={draft} onEdit={editable} />}
    <p className={`mt-6 rounded-lg bg-[var(--hb-surface-hover)] p-4 ${v30Body}`}>예약 전에는 추가 비용을 포함한 총액과 취소·변경 조건을 서면으로 확인해 주세요.</p>
    <WeddingCodeV30Sharing shareOrigin={shareOrigin} first={first ?? draft} second={first ? draft : undefined} received={received} />
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {editable ? <Button variant="secondary" onClick={() => onEdit()} className="whitespace-normal!"><Pencil aria-hidden="true" className="size-4 shrink-0" />{first ? "내가 방금 답한 내용 수정" : "내 답 수정하기"}</Button> : null}
      <Button variant="ghost" onClick={onRestart} className="whitespace-normal!"><RotateCcw aria-hidden="true" className="size-4 shrink-0" />{received ? "내 답으로 새로 시작하기" : "처음부터 다시 답하기"}</Button>
    </div>
  </div>;
}
