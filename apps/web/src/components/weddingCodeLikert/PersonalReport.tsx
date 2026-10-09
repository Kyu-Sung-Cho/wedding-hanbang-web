"use client";

import type { DomainProfile, ItemResponse, PersonalResult } from "@/lib/weddingCode/likert/model";
import Button from "@/components/ui/Button";
import { LETTER_DEFINITIONS, type Answer, type Letter } from "@/lib/weddingCode/likert/types";
import { CharacterPortrait } from "./CharacterPortrait";
import { DomainEvidence, EndorsementRatio, RatioExplanation, responseLabel, SceneReadingEvidence, SupportReading } from "./ReportEvidence";

const actionClass = "inline-flex min-h-11 items-center justify-center whitespace-normal! rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hb-focus-ring)]";
const mutedActionClass = `${actionClass} border border-[var(--hb-primary)] bg-white text-[var(--hb-text-strong)] hover:bg-[var(--ivory-100)]`;

export interface PersonalReportProps {
  result: PersonalResult;
  onEdit: () => void;
  onShare: () => void;
  onCompare?: () => void;
}

export function scrollToReportSection(sectionId: "personal-support" | "personal-evidence" | "couple-topics" | "couple-conversation") {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
  section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  section.querySelector<HTMLHeadingElement>("h2")?.focus({ preventScroll: true });
}

export function answerLabel(answer: Answer | null | undefined): string {
  return responseLabel(answer);
}

export function domainResponses(profile: DomainProfile): ItemResponse[] {
  const entries = new Map<string, ItemResponse>();
  profile.facets.forEach((facet) => facet.items.forEach((entry) => entries.set(entry.item.id, entry)));
  profile.scenes.forEach((scene) => {
    if (scene.left) entries.set(scene.left.item.id, scene.left);
    if (scene.right) entries.set(scene.right.item.id, scene.right);
  });
  return [...entries.values()];
}

export function ResponseEvidence({ entries }: { entries: ItemResponse[] }) {
  return (
    <dl className="divide-y divide-[var(--hb-hairline)]">
      {entries.map(({ item, answer }) => (
        <div key={item.id} className="py-4 first:pt-0 last:pb-0">
          <dt className="text-sm leading-6 text-[var(--hb-text-strong)]">{item.text}</dt>
          <dd className="mt-2 text-sm font-semibold text-[var(--hb-text-strong)]">{answerLabel(answer)}</dd>
        </div>
      ))}
    </dl>
  );
}

function DirectionDefinition({ profile, letter }: { profile: DomainProfile; letter: Letter }) {
  const definition = LETTER_DEFINITIONS[letter];
  const facet = profile.facets.find((entry) => entry.facet === letter);
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xl font-semibold text-[var(--hb-text-strong)]">{letter}</span>
        <span className="break-words text-sm font-semibold">{definition.english}</span>
        <span className="text-sm text-[var(--hb-text-muted)]">{definition.name}</span>
      </p>
      <p className="mt-2 break-words text-sm leading-6 text-[var(--hb-text-body)]">{definition.definition}</p>
      <EndorsementRatio facet={facet} />
    </div>
  );
}

export function DomainReading({ profile, compact = false }: { profile: DomainProfile; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{profile.title}</h3>
        <span className="rounded-full bg-[var(--ivory-200)] px-3 py-1 text-xs font-medium text-[var(--hb-text-body)]">
          {profile.primary ? `${profile.primary} 방향` : "아직 한쪽으로 정하지 않음"}
        </span>
      </div>
      {profile.labels.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-2">
          {profile.labels.map((label) => <span key={label} className="text-xs leading-5 text-[var(--hb-text-strong)]">{label}</span>)}
        </p>
      )}
      <p className="mt-3 break-words text-sm leading-6 text-[var(--hb-text-body)]">{profile.summary}</p>
      <div className={`mt-5 grid gap-5 ${compact ? "" : "sm:grid-cols-2 sm:gap-8"}`}>
        {profile.letters.map((letter) => <DirectionDefinition key={letter} profile={profile} letter={letter} />)}
      </div>
      <RatioExplanation />
      <p className="mt-4 text-xs leading-5 text-[var(--hb-text-muted)]">
        대표 표: {profile.letters[0]} {profile.votes.left}개 · {profile.letters[1]} {profile.votes.right}개. 두 문장에 모두 1~5로 답했고, 더 높은 응답이 4·5인 장면만 한 표를 더했어요. 동점·낮은 응답·미확인 장면으로 반대 글자를 채우지 않았어요.
      </p>
    </div>
  );
}

export function ProfileHero({ result, label = "나의 결혼 준비 코드", compact = false }: { result: PersonalResult; label?: string; compact?: boolean }) {
  const displayedCode = result.code ?? result.partialCode;
  const TitleTag = compact ? "h2" : "h1";
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold tracking-[0.12em] text-[var(--hb-text-strong)]">{label}</p>
      <div className={`mt-5 flex items-center gap-4 ${compact ? "" : "sm:gap-8"}`}>
        {result.character ? (
          <CharacterPortrait character={result.character} className={compact ? "h-24 w-24 shrink-0" : "h-28 w-28 shrink-0 sm:h-40 sm:w-40"} />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-[var(--hb-primary)] bg-white text-3xl text-[var(--hb-text-strong)]" aria-hidden="true">?</div>
        )}
        <div className="min-w-0">
          <p className={`break-words font-semibold leading-none tracking-[0.08em] text-[var(--hb-text-strong)] ${compact ? "text-4xl" : "text-4xl sm:text-6xl"}`} aria-label={`준비 코드 ${displayedCode.split("").join(" ")}`}>
            {displayedCode}
          </p>
          <TitleTag className={`mt-3 break-words font-semibold leading-snug ${compact ? "text-xl" : "text-xl sm:text-3xl"}`}>
            {result.character?.name ?? "장면마다 마음이 다를 수 있어요"}
          </TitleTag>
        </div>
      </div>
      {result.character && <p className="mt-5 break-words text-sm leading-7 text-[var(--hb-text-body)]">{result.character.tagline}</p>}
      {!result.character && (
        <p className="mt-5 text-sm leading-7 text-[var(--hb-text-body)]">정해지지 않은 글자는 ?로 남겼어요. 아래에서 양쪽을 함께 원한 장면과 아직 확인할 장면을 볼 수 있어요.</p>
      )}
      <p className="mt-4 text-xs leading-5 text-[var(--hb-text-muted)]">
        기록한 응답 {result.answeredCount}/{result.totalCount}개 · 1~5 응답 {result.ratedCount}개
      </p>
      {(result.statusCounts.unknown + result.statusCounts.notApplicable + result.statusCounts.skipped + result.statusCounts.unanswered) > 0 && (
        <p className="mt-1 text-xs leading-6 text-[var(--hb-text-muted)]">
          모름 {result.statusCounts.unknown}개 · 비해당 {result.statusCounts.notApplicable}개 · 건너뜀 {result.statusCounts.skipped}개 · 미응답 {result.statusCounts.unanswered}개
        </p>
      )}
      {!result.character && result.candidateCharacters.length > 0 && (
        <details className="mt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]">
            아직 열려 있는 캐릭터 {result.candidateCharacters.length}개 보기
          </summary>
          <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {result.candidateCharacters.map((character) => (
              <li key={character.code} className="flex min-w-0 items-center gap-3">
                <CharacterPortrait character={character} className="h-14 w-14 shrink-0" />
                <p className="min-w-0 break-words text-sm leading-5"><span className="font-semibold">{character.code}</span><br />{character.name}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function PersonalReport({ result, onEdit, onShare, onCompare }: PersonalReportProps) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 text-[var(--hb-text-strong)] sm:px-8 sm:pt-10">
      <header className="border-b border-[var(--hb-hairline)] pb-8">
        <div className="rounded-2xl border-t-2 border-[var(--hb-primary)] bg-[var(--hb-summary-surface)] px-5 py-7 sm:px-8 sm:py-9">
          <ProfileHero result={result} />
        </div>
        <nav className="mt-5 flex flex-wrap gap-3" aria-label="결과에서 할 수 있는 일">
          <Button variant="primary" type="button" onClick={onShare} className={`${actionClass} bg-[var(--hb-primary)] text-white hover:bg-[var(--hb-primary-hover)]`}>결과 공유하기</Button>
          {onCompare && <Button variant="secondary" type="button" onClick={onCompare} className={mutedActionClass}>둘의 응답 비교하기</Button>}
          <Button variant="secondary" type="button" onClick={onEdit} className={mutedActionClass}>내 응답 수정하기</Button>
          <Button variant="secondary" type="button" onClick={() => scrollToReportSection("personal-support")} className={mutedActionClass}>도움·휴식 살펴보기</Button>
          <Button variant="secondary" type="button" onClick={() => scrollToReportSection("personal-evidence")} className={mutedActionClass}>원답 확인하기</Button>
        </nav>
      </header>

      <section className="pt-9" aria-labelledby="personal-directions">
        <h2 id="personal-directions" className="text-xl font-semibold sm:text-2xl">네 글자에 담긴 내 응답</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">각 방향을 따로 물었어요. 둘 다 원할 수 있고, 보통이라는 응답은 어느 쪽에도 더하지 않았어요.</p>
        <div className="mt-5 divide-y divide-[var(--hb-hairline)]">
          {result.domains.map((profile) => (
            <article key={profile.domain} className="py-7">
              <DomainReading profile={profile} />
              <DomainEvidence profile={profile} readings={profile.domain === "support" ? [] : result.sceneReadings.filter(reading => reading.domain === profile.domain)} />
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--hb-hairline)] py-9" aria-labelledby="personal-insights">
        <h2 id="personal-insights" className="text-xl font-semibold sm:text-2xl">준비할 때 이렇게 써 볼 수 있어요</h2>
        <ul className="mt-5 space-y-4 text-sm leading-7 text-[var(--hb-text-body)]">
          {result.insights.map((insight, index) => (
            <li key={`${index}-${insight}`} className="flex gap-3"><span className="shrink-0 font-semibold tabular-nums text-[var(--hb-text-strong)]">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 break-words">{insight}</span></li>
          ))}
        </ul>
      </section>

      <section id="personal-support" className="scroll-mt-6 border-t border-[var(--hb-hairline)] py-9" aria-labelledby="personal-support-heading">
        <h2 id="personal-support-heading" tabIndex={-1} className="text-xl font-semibold sm:text-2xl">대화·도움·휴식, 장면별로</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">내가 받고 싶은 도움을 상대에게 말해 보세요. 상대가 제공할 수 있는 범위는 대화로 함께 확인해요.</p>
        <div className="mt-6 divide-y divide-[var(--hb-hairline)]">
          {result.supportScenes.map((scene) => {
            const reading = result.sceneReadings.find(entry => entry.sceneId === scene.sceneId);
            return (
              <article key={scene.sceneId} className="py-6 first:pt-0">
                <h3 className="font-semibold">{scene.title}</h3>
                <p className="mt-2 text-sm leading-7 text-[var(--hb-text-muted)]">{scene.context}</p>
                <SupportReading scene={scene} />
                {reading && <SceneReadingEvidence reading={reading} />}
                <details className="mt-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]">이 장면의 질문과 내 응답 보기</summary>
                  <div className="mt-3"><ResponseEvidence entries={scene.entries} /></div>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section id="personal-evidence" className="scroll-mt-6 border-t border-[var(--hb-hairline)] py-9" aria-labelledby="personal-evidence-heading">
        <h2 id="personal-evidence-heading" tabIndex={-1} className="text-xl font-semibold sm:text-2xl">결과를 만든 질문과 원답</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--hb-text-body)]">잘 모르겠어요·해당하지 않아요·건너뜀은 1~5 응답과 구분해 남겼어요.</p>
        <div className="mt-5 divide-y divide-[var(--hb-hairline)]">
          {result.domains.map((profile) => (
            <details key={profile.domain} className="py-2">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]">{profile.title} 원답 펼치기</summary>
              <div className="py-4">
                {profile.scenes.map((scene) => (
                  <div key={scene.sceneId} className="mb-6 last:mb-0">
                    <h3 className="text-sm font-semibold">{scene.title}</h3>
                    <p className="mb-4 mt-2 text-sm leading-6 text-[var(--hb-text-muted)]">{scene.context}</p>
                    <ResponseEvidence entries={domainResponses(profile).filter((entry) => entry.item.sceneId === scene.sceneId)} />
                    <p className="mt-3 text-xs leading-6 text-[var(--hb-text-muted)]">{scene.summary}</p>
                  </div>
                ))}
                {profile.scenes.length === 0 && <ResponseEvidence entries={domainResponses(profile)} />}
                {profile.scenes.length > 0 && domainResponses(profile).some((entry) => !profile.scenes.some((scene) => scene.sceneId === entry.item.sceneId)) && (
                  <ResponseEvidence entries={domainResponses(profile).filter((entry) => !profile.scenes.some((scene) => scene.sceneId === entry.item.sceneId))} />
                )}
              </div>
            </details>
          ))}
        </div>
      </section>
      <p className="border-t border-[var(--hb-hairline)] pt-5 text-xs leading-6 text-[var(--hb-text-muted)]">새 문항과 캐릭터 표현을 검토 중인 초안이에요 · 사람 대상 응답 자료 0명</p>
    </div>
  );
}

export default PersonalReport;
