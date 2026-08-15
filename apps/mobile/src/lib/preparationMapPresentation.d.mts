import type { AmoraPreparationOverview } from "@hanbang/shared/amora-preparation-map";

export type PreparationHomeTone =
  | "active"
  | "success"
  | "warning"
  | "neutral"
  | "muted";

export interface PreparationHomeSectionModel {
  eyebrow: "MY PREPARATION";
  title: "내 결혼 준비";
  description: string;
  emptyMessage: string | null;
  summaryItems: readonly Readonly<{
    key: string;
    label: string;
    count: number;
    tone: PreparationHomeTone;
  }>[];
  rows: readonly Readonly<{
    topicKey: string;
    title: string;
    statusLabel: string;
    reasonLabel: string;
    tone: "active" | "warning" | "neutral";
    route: Readonly<{
      pathname: "/checklist";
      params: Readonly<{ category: string }>;
    }>;
  }>[];
  allTopicsAction: Readonly<{
    label: "전체 준비 보기";
    route: "/checklist";
  }>;
}

export function buildPreparationHomeSectionModel(
  overview: Readonly<AmoraPreparationOverview> | null | undefined,
): Readonly<PreparationHomeSectionModel> | null;
