"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import type { CoupleResult, DomainProfile, ItemComparison, PersonalResult } from "@/lib/weddingCode/likert/model";
import { DOMAIN_DEFINITIONS, LETTER_DEFINITIONS, type Domain } from "@/lib/weddingCode/likert/types";
import { answerLabel, DomainReading, ProfileHero, scrollToReportSection } from "./PersonalReport";
import { EndorsementRatio, RatioExplanation, SceneReadingEvidence, SupportReading } from "./ReportEvidence";

const firstLabel = "먼저 답한 사람";
const secondLabel = "초대받아 답한 사람";
const actionClass = "inline-flex min-h-11 items-center justify-center whitespace-normal! rounded-xl border border-[var(--hb-primary)] bg-white px-5 py-3 text-sm font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--ivory-100)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hb-focus-ring)]";

export interface CoupleReportProps {
  result: CoupleResult;
  onBack: () => void;
}

function ProfileDefinitions({ result }: { result: PersonalResult }) {
  return (
    <div className="mt-6 divide-y divide-[var(--hb-hairline)] border-t border-[var(--hb-hairline)]">
      {result.domains.map((profile) => {
        const letters = profile.primary ? [profile.primary] : profile.letters;
        return (
          <div key={profile.domain} className="min-w-0 py-5">
            <h3 className="text-sm font-semibold">{profile.title}</h3>
            {profile.labels.length > 0 && <p className="mt-2 text-xs leading-5 text-[var(--hb-text-strong)]">{profile.labels.join(" · ")}</p>}
            {letters.map((letter) => {
              const definition = LETTER_DEFINITIONS[letter];
              return (
                <div key={letter} className="mt-3">
                  <p className="break-words text-sm font-semibold"><span className="text-lg text-[var(--hb-text-strong)]">{letter}</span>{" "}{definition.english} · {definition.name}</p>
                  <p className="mt-1 break-words text-sm leading-6 text-[var(--hb-text-body)]">{definition.definition}</p>
                  <EndorsementRatio facet={profile.facets.find(entry => entry.facet === letter)} />
                </div>
              );
            })}
            <RatioExplanation />
            <p className="mt-2 text-sm leading-6 text-[var(--hb-text-body)]">{profile.summary}</p>
          </div>
        );
      })}
    </div>
  );
}

function TopicSummary({ profile, label }: { profile: DomainProfile | undefined; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold leading-5 text-[var(--hb-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">
        {profile?.primary ?? "?"}{profile?.labels.length ? ` · ${profile.labels.join(" · ")}` : ""}
      </p>
      <p className="mt-1 break-words text-sm leading-6 text-[var(--hb-text-body)]">{profile?.summary ?? "아직 확인할 응답이 있어요."}</p>
    </div>
  );
}

function ComparisonEvidence({ comparison }: { comparison: ItemComparison }) {
  return (
    <article className="min-w-0 py-5 first:pt-0 last:pb-0">
      <h4 className="break-words text-sm font-medium leading-7">{comparison.item.text}</h4>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6">
        <div>
          <dt className="text-xs leading-5 text-[var(--hb-text-muted)]">{firstLabel}</dt>
          <dd className="mt-1 text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">{answerLabel(comparison.first)}</dd>
        </div>
        <div>
          <dt className="text-xs leading-5 text-[var(--hb-text-muted)]">{secondLabel}</dt>
          <dd className="mt-1 text-sm font-semibold leading-6 text-[var(--hb-text-strong)]">{answerLabel(comparison.second)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-6 text-[var(--hb-text-muted)]">{comparison.summary}</p>
    </article>
  );
}

export function CoupleReport({ result, onBack }: CoupleReportProps) {
  const [selectedDomain, setSelectedDomain] = useState<Domain>("money");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const selectedItems = result.items.filter((entry) => entry.item.domain === selectedDomain);
  const scenes = [...new Map(selectedItems.map((entry) => [entry.item.sceneId, {
    id: entry.item.sceneId,
    title: entry.item.sceneTitle,
    context: entry.item.context,
  }])).values()];
  const scene = scenes.find((entry) => entry.id === selectedSceneId) ?? scenes[0];
  const sceneItems = scene ? selectedItems.filter((entry) => entry.item.sceneId === scene.id) : [];
  const sceneConversations = result.conversations.filter(entry => entry.sceneId === scene?.id);
  const differentOrUnknown = sceneConversations.filter(entry => entry.relation !== "same");
  const conversationTopics = differentOrUnknown.length > 0 ? differentOrUnknown : sceneConversations;
  const sceneReading = result.sceneReadings.find(entry => entry.sceneId === scene?.id);
  const firstSupport = result.first.supportScenes.find(entry => entry.sceneId === scene?.id);
  const secondSupport = result.second.supportScenes.find(entry => entry.sceneId === scene?.id);
  const firstProfile = result.first.domains.find((entry) => entry.domain === selectedDomain);
  const secondProfile = result.second.domains.find((entry) => entry.domain === selectedDomain);
  const selectedTitle = DOMAIN_DEFINITIONS.find((entry) => entry.id === selectedDomain)?.name;

  function chooseDomain(domain: Domain) {
    setSelectedDomain(domain);
    setSelectedSceneId("");
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 text-[var(--hb-text-strong)] sm:px-8 sm:pt-10">
      <header className="pb-8">
        <p className="text-xs font-semibold text-[var(--hb-text-strong)]">함께 보는 결혼 준비 코드</p>
        <h1 className="mt-3 text-2xl font-semibold leading-snug sm:text-4xl">둘의 마음을 장면별로 살펴봐요</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--hb-text-body)]">각자 답한 내용을 나란히 놓았어요. 먼저 원하는 것을 확인하고, 지금 함께할 수 있는 범위를 이야기해 보세요.</p>
        <nav className="mt-5 flex flex-wrap gap-3" aria-label="함께 보는 결과 이동">
          <Button variant="secondary" type="button" onClick={() => scrollToReportSection("couple-topics")} className={actionClass}>네 주제 살펴보기</Button>
          <Button variant="secondary" type="button" onClick={() => scrollToReportSection("couple-conversation")} className={actionClass}>첫 대화 시작하기</Button>
          <Button variant="secondary" type="button" onClick={onBack} className={actionClass}>이전 화면으로</Button>
        </nav>
      </header>

      <section className="grid gap-6 lg:grid-cols-2" aria-label="두 사람의 개인 결과">
        <article className="min-w-0 rounded-2xl border-t-2 border-[var(--hb-primary)] bg-[var(--hb-summary-surface)] px-5 py-7 sm:px-7">
          <ProfileHero result={result.first} label={firstLabel} compact />
          <ProfileDefinitions result={result.first} />
        </article>
        <article className="min-w-0 rounded-2xl border-t-2 border-[var(--hb-primary)] bg-[var(--hb-summary-surface)] px-5 py-7 sm:px-7">
          <ProfileHero result={result.second} label={secondLabel} compact />
          <ProfileDefinitions result={result.second} />
        </article>
      </section>

      <section id="couple-topics" className="scroll-mt-6 pt-10" aria-labelledby="couple-topics-heading">
        <h2 id="couple-topics-heading" tabIndex={-1} className="text-xl font-semibold sm:text-2xl">네 주제를 한눈에</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">먼저 각자의 응답을 읽고, 더 이야기할 주제를 골라 주세요.</p>
        <div className="mt-6 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">
          {DOMAIN_DEFINITIONS.map((domain, index) => (
            <article key={domain.id} className="py-6">
              <Button variant="ghost" type="button" aria-pressed={selectedDomain === domain.id} onClick={() => chooseDomain(domain.id)} className={`flex min-h-11 w-full items-center justify-between whitespace-normal! gap-3 rounded-xl px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hb-focus-ring)] ${selectedDomain === domain.id ? "bg-[var(--hb-selected-bg)] text-[var(--hb-selected-text)]" : "hover:bg-[var(--hb-surface-hover)]"}`}>
                <span className="min-w-0 text-base font-semibold"><span className="mr-3 text-xs tabular-nums">0{index + 1}</span>{domain.name}</span>
                <span className="shrink-0 text-xs font-medium">{selectedDomain === domain.id ? "선택됨" : "살펴보기"}</span>
              </Button>
              <div className="mt-4 grid gap-4 px-3 sm:grid-cols-2 sm:gap-8">
                <TopicSummary profile={result.first.domains.find((entry) => entry.domain === domain.id)} label={firstLabel} />
                <TopicSummary profile={result.second.domains.find((entry) => entry.domain === domain.id)} label={secondLabel} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="couple-conversation" className="scroll-mt-6 pt-10" aria-labelledby="couple-conversation-heading">
        <p className="text-xs font-semibold text-[var(--hb-text-strong)]">지금 살펴보는 주제 · {selectedTitle}</p>
        <h2 id="couple-conversation-heading" tabIndex={-1} className="mt-3 text-xl font-semibold sm:text-2xl">이 장면에서 나눌 첫 대화</h2>
        {scene ? (
          <>
            <label htmlFor="couple-scene" className="mt-5 block text-sm font-semibold">이야기할 장면</label>
            <select id="couple-scene" value={scene.id} onChange={(event) => setSelectedSceneId(event.target.value)} className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-[var(--hb-primary)] bg-white px-3 py-3 text-sm text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hb-focus-ring)] sm:max-w-lg">
              {scenes.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
            </select>
            <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--hb-text-body)]">{scene.context}</p>
            {sceneReading && <div className="mt-5" data-couple-scene-reading={sceneReading.sceneId}>
              <p className="text-sm font-semibold">이 장면에서 관찰한 차이</p>
              <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{sceneReading.observation}</p>
              {sceneReading.possibleReading && <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{sceneReading.possibleReading}</p>}
              <div className="mt-5 grid gap-7 sm:grid-cols-2 sm:gap-8">
                <div className="min-w-0"><h3 className="text-sm font-semibold">{firstLabel}의 읽기와 부탁</h3><SceneReadingEvidence reading={sceneReading.first} /></div>
                <div className="min-w-0"><h3 className="text-sm font-semibold">{secondLabel}의 읽기와 부탁</h3><SceneReadingEvidence reading={sceneReading.second} /></div>
              </div>
            </div>}
            <p className="mt-5 text-sm leading-7 text-[var(--hb-text-body)]">{differentOrUnknown.length > 0 ? "같은 장면에서 다르게 답했거나 아직 확인할 응답을 모았어요. 지금 이야기할 내용은 두 사람이 골라 주세요." : "이 장면에서는 같은 칸으로 답했어요. 떠올린 이유와 원하는 행동도 같은지 확인해 보세요."}</p>
            <ol aria-label="이 장면에서 함께 확인할 응답" className="mt-4 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)]">
              {conversationTopics.map(topic => {
                const comparison = sceneItems.find(entry => entry.item.id === topic.itemId);
                if (!comparison) return null;
                return (
                  <li key={topic.itemId} className="py-5">
                    <p className="text-sm font-semibold leading-7">{comparison.item.text}</p>
                    <p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">{firstLabel}: {answerLabel(topic.first)} · {secondLabel}: {answerLabel(topic.second)}</p>
                    <blockquote className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">{topic.text}</blockquote>
                  </li>
                );
              })}
            </ol>
            {(firstSupport || secondSupport) && (
              <div className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-8">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--hb-text-strong)]">{firstLabel}의 요청</h3>
                  {firstSupport && <SupportReading scene={firstSupport} />}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--hb-text-strong)]">{secondLabel}의 요청</h3>
                  {secondSupport && <SupportReading scene={secondSupport} />}
                </div>
              </div>
            )}
            <div className="mt-6 border-t border-[var(--hb-hairline)] pt-5">
              <h3 className="text-sm font-semibold">각자 제공할 수 있는 범위도 직접 말해 주세요</h3>
              <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">“이 장면에서 지금 내가 함께할 수 있는 부분은 무엇일까? 함께하기 어려운 부분이나 먼저 맞출 조건이 있을까?”</p>
            </div>
            <div className="mt-7 divide-y divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)] py-5" aria-label={`${scene.title}의 실제 질문과 두 응답`}>
              {sceneItems.map((comparison) => <ComparisonEvidence key={comparison.item.id} comparison={comparison} />)}
            </div>
          </>
        ) : <p className="mt-5 text-sm leading-7 text-[var(--hb-text-body)]">이 주제에서 함께 확인할 장면이 아직 없어요.</p>}
      </section>

      <section className="border-b border-[var(--hb-hairline)] py-9" aria-labelledby="couple-topic-detail">
        <details>
          <summary id="couple-topic-detail" className="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]">{selectedTitle}의 정의와 전체 원답 펼치기</summary>
          <div className="mt-5 grid gap-7 lg:grid-cols-2 lg:gap-10">
            {firstProfile && <div className="min-w-0"><p className="mb-4 text-xs font-semibold text-[var(--hb-text-strong)]">{firstLabel}</p><DomainReading profile={firstProfile} compact /></div>}
            {secondProfile && <div className="min-w-0"><p className="mb-4 text-xs font-semibold text-[var(--hb-text-strong)]">{secondLabel}</p><DomainReading profile={secondProfile} compact /></div>}
          </div>
          <div className="mt-7 space-y-7">
            {scenes.map((entry) => (
              <div key={entry.id}>
                <h3 className="text-base font-semibold">{entry.title}</h3>
                <p className="mb-4 mt-2 text-sm leading-7 text-[var(--hb-text-muted)]">{entry.context}</p>
                <div className="divide-y divide-[var(--hb-hairline)]">
                  {selectedItems.filter((comparison) => comparison.item.sceneId === entry.id).map((comparison) => <ComparisonEvidence key={comparison.item.id} comparison={comparison} />)}
                </div>
              </div>
            ))}
          </div>
        </details>
      </section>
      <p className="pt-5 text-xs leading-6 text-[var(--hb-text-muted)]">새 문항과 캐릭터 표현을 검토 중인 초안이에요 · 사람 대상 응답 자료 0명</p>
    </div>
  );
}

export default CoupleReport;
