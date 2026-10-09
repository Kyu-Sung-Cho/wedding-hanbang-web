"use client";

import { useId, useState } from "react";

import { landingContent } from "./landingContent";
import PreparationRecordPreview from "./PreparationRecordPreview";

type PreviewSceneId = typeof landingContent.hero.preview.scenes[number]["id"];

/** 상황만 바꾸는 로컬 예시다. AI 호출이나 준비 기록 저장을 하지 않는다. */
export default function AppPreviewCard() {
  const { preview } = landingContent.hero;
  const [selectedId, setSelectedId] = useState<PreviewSceneId>(preview.defaultSceneId);
  const scene = preview.scenes.find((item) => item.id === selectedId) ?? preview.scenes[2];
  const panelId = useId();

  return (
    <figure className="m-0 overflow-hidden rounded-[16px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-4 shadow-raised lg:bg-[var(--color-paper-sheet)] lg:p-0">
      <div aria-hidden="true" className="hidden gap-[7px] border-b border-[var(--color-paper-edge)] bg-[var(--color-paper-tint)] px-[18px] py-[14px] lg:flex">
        <span className="size-[10px] rounded-full bg-[var(--color-paper-edge)]" />
        <span className="size-[10px] rounded-full bg-[var(--color-paper-edge)]" />
        <span className="size-[10px] rounded-full bg-[var(--color-paper-edge)]" />
      </div>
      <div className="flex items-center justify-between gap-3 pb-3 lg:px-[22px] lg:pt-[22px] lg:pb-[14px]">
        <p className="text-[13px] font-semibold text-[var(--color-paper-ink)] lg:text-[14px]">
          {preview.appName}
        </p>
        <p className="shrink-0 rounded-full bg-[var(--color-sage-pale)]/60 px-[9px] py-1 text-[10.5px] font-semibold text-[var(--color-noir-900)] lg:text-[11px]">
          {preview.badge}
        </p>
      </div>

      <div className="lg:px-[22px] lg:pb-[14px]">
        <p className="mb-2 text-[12px] text-[var(--color-paper-ink-soft)]">{preview.selectorLabel}</p>
        <div role="group" aria-label={preview.selectorLabel} className="mb-4 grid grid-cols-3 gap-2">
          {preview.scenes.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === selectedId}
              aria-controls={panelId}
              onClick={() => setSelectedId(item.id)}
              className={`min-h-11 rounded-[8px] border px-2 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none ${item.id === selectedId
                ? "border-[var(--color-paper-ink)] bg-[var(--color-paper-ink)] text-[var(--color-paper-on-ink)]"
                : "border-[var(--color-paper-outline)] bg-[var(--color-paper-card)] text-[var(--color-paper-ink)] hover:bg-[var(--color-paper-tint)]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div id={panelId} aria-live="polite" aria-atomic="true">
          {scene.id === "together" ? <PreparationRecordPreview /> : <>
          <div className="rounded-[12px] bg-[var(--color-paper-ink)] px-[17px] py-[15px] lg:rounded-[14px] lg:px-5 lg:py-[18px]">
            <p className="text-[12px] font-medium text-[var(--color-paper-on-ink-faint)]">
              {preview.questionLabel}
            </p>
            <p className="landing-display mt-1 text-[21px] leading-[1.4] text-[var(--color-paper-on-ink)] lg:text-[25px]">
              {scene.userPrompt}
            </p>
          </div>

          <div className="mt-[10px] rounded-[11px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-sheet)] p-[13px] lg:mt-3 lg:rounded-[12px] lg:bg-[var(--color-paper-card)] lg:p-[15px]">
            <p className="text-[12px] font-semibold text-[var(--color-paper-ink-faint)]">{preview.answerLabel}</p>
            <p className="mt-2 text-[14px] leading-[1.65] text-[var(--color-paper-ink)]">{scene.answer}</p>
          </div>

          <div className="mt-[10px] rounded-[11px] border border-[var(--color-paper-edge)] bg-[var(--color-sage-pale)]/60 px-[13px] py-[13px] lg:mt-3 lg:rounded-[12px] lg:px-[15px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-[var(--color-paper-ink-soft)]">{scene.proposalLabel}</p>
              <span className="rounded-full border border-[var(--color-paper-edge)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-paper-ink)]">{scene.proposalStatus}</span>
            </div>
            <p className="mt-2 text-[13px] font-semibold leading-[1.5] text-[var(--color-paper-ink)] lg:text-[14px]">
              <span className="mr-2 rounded-[6px] bg-[var(--color-paper-card)] px-[6px] py-[3px] text-[11px] text-[var(--color-paper-ink-soft)]">{scene.proposalKind}</span>
              {scene.proposal}
            </p>
            <p className="mt-2 text-[14px] leading-[1.6] text-[var(--color-paper-ink-soft)] lg:text-[13px]">{scene.proposalNote}</p>
          </div>
          </>}
        </div>

      </div>
      <figcaption className="mt-[14px] border-t border-[var(--color-paper-edge)] pt-3 text-[14px] leading-[1.6] text-[var(--color-paper-ink-soft)] lg:mx-[22px] lg:mb-[22px] lg:mt-0 lg:text-[12px] lg:text-[var(--color-paper-ink-faint)]">
        {preview.note}
      </figcaption>
    </figure>
  );
}
