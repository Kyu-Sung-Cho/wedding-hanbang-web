"use client";

import Link from "next/link";
import { ArrowLeft, BrainCircuit, ChevronRight, CircleCheck, CircleSlash, MessageSquareMore } from "lucide-react";
import { AMORA_PERMISSION_COPY, buildAmoraPermissionTable } from "@hanbang/shared/amora-permissions";

import AmoraCarePreferenceControl from "@/components/app/AmoraCarePreferenceControl";
import AmoraPushPreferenceRow from "@/components/app/AmoraPushPreferenceRow";
import TodayOnePreferenceControl from "@/components/app/TodayOnePreferenceControl";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

/**
 * 허락 규칙 화면(설계 25장 3절). 아모라가 알아서 하는 일, 물어보고 하는 일, 하지 않는 일을 보이고,
 * 같은 화면에서 앱 알림·메일·오늘의 한 가지·기억을 정한다. 앱 화면(`app/settings/amora-permissions.tsx`)과 같은 표다.
 *
 * 인터넷 찾기(갈래 3)와 맡은 일(갈래 4)은 아직 없어서 `buildAmoraPermissionTable` 에 꺼진 채 넘긴다. 그 갈래가
 * 켜지면 자기 스위치를 여기와 앱 화면에 넘긴다(오늘 쓸 수 없는 일을 화면에 쓰지 않는다).
 */

const FEATURES = { webSearch: false, agentTasks: false } as const;

const SECTION_ICONS = {
  auto: CircleCheck,
  ask: MessageSquareMore,
  never: CircleSlash,
} as const;

export default function AmoraPermissionsPage() {
  const isDemo = useAuthStore((state) => state.isDemo);
  const table = buildAmoraPermissionTable(FEATURES);
  const copy = AMORA_PERMISSION_COPY;

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10" data-amora-permissions>
      <div className="mb-7 flex items-center gap-3">
        <Link
          {...weddingLinkProps("/settings")}
          aria-label="설정으로 돌아가기"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[var(--hb-text-strong)] shadow-sm transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold text-[var(--hb-text-strong)]">{copy.title}</h1>
          <p className="mt-1 text-sm leading-6 text-[var(--hb-text-muted)]">{copy.intro}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["auto", "ask", "never"] as const).map((section) => {
          const Icon = SECTION_ICONS[section];
          return (
            <section
              key={section}
              aria-labelledby={`amora-permission-${section}`}
              className="rounded-[6px] border border-[var(--hb-hairline)] bg-white px-5 py-5"
              data-permission-section={section}
            >
              <h2 id={`amora-permission-${section}`} className="flex items-center gap-2 text-[15px] font-semibold text-[var(--hb-text-strong)]">
                <Icon className="h-4 w-4 text-[#8F6662]" aria-hidden="true" />
                {copy.sections[section]}
              </h2>
              <ul className="mt-3 space-y-2">
                {table[section].map((item) => (
                  <li key={item} className="text-sm leading-6 text-[var(--hb-text-body)]">{item}</li>
                ))}
              </ul>
              {section === "ask" ? <p className="mt-3 text-xs leading-5 text-[var(--hb-text-muted)]">{copy.askNote}</p> : null}
              {section === "never" ? <p className="mt-3 text-xs leading-5 text-[var(--hb-text-muted)]">{copy.neverNote}</p> : null}
            </section>
          );
        })}
      </div>

      {!isDemo ? (
        <section aria-labelledby="amora-permission-controls" className="mt-8 rounded-[6px] border border-[var(--hb-hairline)] bg-white px-5 py-2">
          <h2 id="amora-permission-controls" className="pt-4 text-[15px] font-semibold text-[var(--hb-text-strong)]">
            {copy.controlsTitle}
          </h2>
          <AmoraPushPreferenceRow />
          <TodayOnePreferenceControl />
          <AmoraCarePreferenceControl />
          <Link
            {...weddingLinkProps("/settings/amora-memory")}
            className="my-2 flex min-h-16 items-center gap-3 rounded-[6px] py-3 transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662]"
          >
            <BrainCircuit className="h-5 w-5 flex-shrink-0 text-[#8F6662]" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--hb-text-strong)]">{copy.memoryLink}</span>
              <span className="block text-xs leading-5 text-[var(--hb-text-muted)]">{copy.memoryLinkSub}</span>
            </span>
            <ChevronRight className="h-5 w-5 flex-shrink-0 text-[var(--hb-text-muted)]" aria-hidden="true" />
          </Link>
        </section>
      ) : null}
    </div>
  );
}
