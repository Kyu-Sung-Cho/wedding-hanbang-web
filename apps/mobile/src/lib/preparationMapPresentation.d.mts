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

export interface PreparationHomeStatusModel {
  label: "준비 상태";
  boundaryLabel: "저장한 준비 기록 기준";
  items: readonly Readonly<{
    key: "in_progress" | "needs_attention" | "unknown" | "completed";
    label: "진행 중" | "확인 필요" | "아직 모름" | "완료";
    count: number;
    tone: "active" | "warning" | "neutral" | "success";
  }>[];
}

export function buildPreparationHomeStatusModel(
  overview: Readonly<AmoraPreparationOverview> | null | undefined,
): Readonly<PreparationHomeStatusModel> | null;

export function buildPreparationHomeSectionModel(
  overview: Readonly<AmoraPreparationOverview> | null | undefined,
): Readonly<PreparationHomeSectionModel> | null;
