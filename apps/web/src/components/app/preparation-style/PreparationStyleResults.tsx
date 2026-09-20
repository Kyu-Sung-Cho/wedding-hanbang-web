"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, HandHeart, ListChecks, Users, Wallet } from "lucide-react";
import { weddingLinkProps } from "@/lib/weddingPaths";
import type {
  PreparationStyleGuide, PreparationStyleGroupId, PreparationStyleIndividual,
  PreparationStyleComparisonScene,
} from "@/lib/weddingCode/preparationStyleGuide";

const tools = {
  budget: { href: "/budget", label: "우리 예산 살펴보기", icon: Wallet },
  roles: { href: "/checklist", label: "할 일 살펴보기", icon: ListChecks },
  family: { href: "/manners", label: "예절 가이드 살펴보기", icon: Users },
  support: { href: "/chat", label: "아모라와 이야기하기", icon: HandHeart },
} as const;
const panel = "rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]";

function ToolLink({ group }: { group: PreparationStyleGroupId }) {
  const tool = tools[group];
  return <Link {...weddingLinkProps(tool.href)} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--hb-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)]">{tool.label}<ArrowRight className="size-4" aria-hidden="true" /></Link>;
}

export function PersonalStyleResults({ personal, showTools = true }: { personal: PreparationStyleIndividual; showTools?: boolean }) {
  return <div className="space-y-5" data-personal-style="">
    <div>
      <h2 className="text-xl font-semibold text-[var(--hb-text-strong)]">이번에 고른 답을 정리했어요</h2>
      <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{personal.summary} {personal.skipped > 0 && `${personal.skipped}장면은 건너뛰었어요.`}</p>
      <p className="text-sm leading-7 text-[var(--hb-text-body)]">지금의 선택을 돌아보는 자료예요. 상황이나 생각이 달라지면 다시 답해도 괜찮아요.</p>
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {personal.groups.map(group => {
        const Icon = tools[group.id].icon;
        return <section key={group.id} className={`${panel} p-5 sm:p-6`}>
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--hb-primary)]"><Icon className="size-4" aria-hidden="true" />{group.label}</p>
          <h3 className="mt-3 text-lg font-semibold leading-8 text-[var(--hb-text-strong)]">{group.summary}</h3>
          <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{group.countLine}</p>
          {group.reading.reflection && <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{group.reading.reflection}</p>}
          {group.answered > 0 && <>
            <div className="mt-4 border-l-2 border-[var(--hb-hairline)] pl-4">
              <p className="text-xs font-semibold text-[var(--hb-text-muted)]">정할 때 챙겨볼 것</p>
              <p className="mt-1 text-sm leading-7 text-[var(--hb-text-strong)]">{group.reading.watchOut}</p>
            </div>
            {group.reading.qualifiers.map(line => <p key={line} className="mt-3 text-xs leading-6 text-[var(--hb-text-muted)]">{line}</p>)}
            <details className="mt-4 border-t border-[var(--hb-hairline)] pt-2">
              <summary className="cursor-pointer py-3 text-sm font-semibold text-[var(--hb-text-strong)]">내가 고른 답 {group.answered}개와 이야기할 것</summary>
              <div className="divide-y divide-[var(--hb-hairline)]">
                {group.scenes.map(scene => <article key={scene.key} className="py-4">
                  <p className="text-sm leading-7 text-[var(--hb-text-body)]">{scene.scene}</p>
                  <p className="mt-2 text-sm font-semibold leading-7 text-[var(--hb-text-strong)]">{scene.answer ? `“${scene.answer.label}”` : "이 장면은 건너뛰었어요."}</p>
                  {scene.nextStep && <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">{scene.nextStep}</p>}
                </article>)}
              </div>
            </details>
          </>}
          {showTools && <div className="mt-3"><ToolLink group={group.id} /></div>}
        </section>;
      })}
    </div>
    <p className="text-xs leading-6 text-[var(--hb-text-muted)]">장면 속 금액은 예시예요. 이 답만으로 실제 예산이나 역할 분담을 정하지 않아요.</p>
  </div>;
}

function ComparedScene({ scene, partnerName }: { scene: PreparationStyleComparisonScene; partnerName: string }) {
  return <article className={`${panel} p-5 sm:p-6`} data-compared-scene={scene.key}>
    <p className="text-xs font-semibold text-[var(--hb-primary)]">{scene.status === "same" ? "같은 답을 고른 장면" : scene.status === "different" ? "다른 답을 고른 장면" : "비교하지 않은 장면"}</p>
    <h4 className="mt-2 text-base font-semibold leading-8 text-[var(--hb-text-strong)]">{scene.scene}</h4>
    <p className="mt-1 text-sm leading-7 text-[var(--hb-text-body)]">{scene.question}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {[{ name: "나", answer: scene.mine }, { name: partnerName, answer: scene.partner }].map((person, index) => <div key={index} className="border-l-2 border-[var(--hb-hairline)] pl-4">
        <p className="text-xs font-semibold text-[var(--hb-text-muted)]">{person.name}</p>
        <p className="mt-1 text-sm font-medium leading-7 text-[var(--hb-text-strong)]">{person.answer ? `“${person.answer.label}”` : "이 장면은 건너뛰었어요."}</p>
      </div>)}
    </div>
    <p className="mt-5 text-sm leading-7 text-[var(--hb-text-body)]">{scene.explanation}</p>
    {scene.nextStep && <div className="mt-4 border-t border-[var(--hb-hairline)] pt-4">
      <p className="text-sm font-semibold text-[var(--hb-text-strong)]">미리 이야기해 볼 것</p>
      <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{scene.nextStep}</p>
    </div>}
  </article>;
}

export function CoupleStyleResults({ guide, partnerName }: { guide: Extract<PreparationStyleGuide, { status: "couple" }>; partnerName: string }) {
  const [groupId, setGroupId] = useState<PreparationStyleGroupId>("budget");
  const group = guide.groups.find(item => item.id === groupId)!;
  const different = group.scenes.filter(scene => scene.status === "different");
  const same = group.scenes.filter(scene => scene.status === "same");
  const skipped = group.scenes.filter(scene => scene.status === "not_compared");
  return <div className="space-y-5" data-couple-style="">
    <div>
      <h2 className="text-xl font-semibold text-[var(--hb-text-strong)]">둘이 고른 답, 나란히 볼까요?</h2>
      <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{guide.summary}</p>
      <p className="text-sm leading-7 text-[var(--hb-text-body)]">다르게 골랐다고 문제가 있는 건 아니에요. 같은 답을 골랐을 때도 그 이유를 물어보세요.</p>
      {guide.skippedMessage && <p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">{guide.skippedMessage}</p>}
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="비교할 주제">
      {guide.groups.map(item => {
        const Icon = tools[item.id].icon;
        return <button key={item.id} type="button" aria-pressed={groupId === item.id} onClick={() => setGroupId(item.id)} className={`rounded-[6px] border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] ${groupId === item.id ? "border-[var(--hb-selected-line)] bg-[var(--hb-selected-bg)]" : "border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]"}`}>
          <Icon className="mb-2 size-5 text-[var(--hb-primary)]" aria-hidden="true" /><span className="block text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">{item.label}</span>
          <span className="mt-1 block text-xs leading-6 text-[var(--hb-text-body)]">같은 답 {item.same} · 다른 답 {item.different}</span>
        </button>;
      })}
    </div>
    <section aria-label={group.label}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-[var(--hb-text-strong)]">{group.label}</h3><ToolLink group={group.id} />
      </div>
      <p className="mb-4 text-sm leading-7 text-[var(--hb-text-body)]">{group.summary}</p>
      <div className="space-y-4">{different.map(scene => <ComparedScene key={scene.key} scene={scene} partnerName={partnerName} />)}</div>
      {same.length > 0 && <details className="mt-4" open={different.length === 0}>
        <summary className="cursor-pointer py-3 text-sm font-semibold text-[var(--hb-text-strong)]">같은 답을 고른 {same.length}장면도 보기</summary>
        <div className="space-y-4">{same.map(scene => <ComparedScene key={scene.key} scene={scene} partnerName={partnerName} />)}</div>
      </details>}
      {skipped.length > 0 && <details className="mt-4">
        <summary className="cursor-pointer py-3 text-sm font-semibold text-[var(--hb-text-body)]">비교하지 않은 {skipped.length}장면</summary>
        <div className="space-y-4">{skipped.map(scene => <ComparedScene key={scene.key} scene={scene} partnerName={partnerName} />)}</div>
      </details>}
    </section>
    <p className="text-xs leading-6 text-[var(--hb-text-muted)]">가이드는 함께 이야기해 볼 제안이에요. 실제 금액·담당자·일정은 두 사람이 정한 뒤 각각의 도구에 기록해 주세요.</p>
  </div>;
}
