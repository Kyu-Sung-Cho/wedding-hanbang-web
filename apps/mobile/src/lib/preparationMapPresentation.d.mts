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

export type PreparationJourneyTone =
  | "active"
  | "success"
  | "warning"
  | "neutral"
  | "muted";

export interface PreparationJourneyNodeModel {
  topicKey: string;
  title: string;
  state: "unknown" | "needs_review" | "not_applicable" | "not_started" | "in_progress" | "completed";
  stateLabel: "확인 전" | "확인 필요" | "해당 없음" | "준비 전" | "준비 중" | "완료";
  tone: PreparationJourneyTone;
  symbol: "?" | "!" | "—" | "○" | "◐" | "✓";
  isFocus: boolean;
  focusReasonLabel: string | null;
  accessibilityLabel: string;
}

export interface PreparationJourneyMapModel {
  description: "저장한 기록에서 이번에 볼 준비를 모았어요.";
  boundaryLabel: "저장한 준비 기록 기준";
  coverageNotice: string | null;
  viewOptions: readonly Readonly<{
    key: "map" | "details";
    label: "지도" | "상세 목록";
  }>[];
  focus: Readonly<{
    title: "이번에 볼 준비" | "필요한 주제부터 보기";
    description: string;
    nodes: readonly Readonly<PreparationJourneyNodeModel>[];
  }>;
  chapters: readonly Readonly<{
    key: "agreements" | "vendors" | "life_and_family" | "ceremony_details" | "other";
    title: string;
    description: string;
    hasFocus: boolean;
    nodes: readonly Readonly<PreparationJourneyNodeModel>[];
  }>[];
}

export function buildPreparationHomeStatusModel(
  overview: Readonly<AmoraPreparationOverview> | null | undefined,
): Readonly<PreparationHomeStatusModel> | null;

export function buildPreparationJourneyMapModel(
  overview: Readonly<AmoraPreparationOverview> | null | undefined,
): Readonly<PreparationJourneyMapModel> | null;

export function buildPreparationHomeSectionModel(
  overview: Readonly<AmoraPreparationOverview> | null | undefined,
): Readonly<PreparationHomeSectionModel> | null;
