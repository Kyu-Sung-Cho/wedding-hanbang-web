import type { AmoraPreparationTopicDetail } from "@hanbang/shared/amora-preparation-topic";

import type { AmoraSourceDisclosure } from "@hanbang/shared/amora-source-disclosure";

export type PreparationTopicPresentation = Readonly<{
  statusLabel: string;
  statusTone: "neutral" | "rose" | "success" | "warning";
  progressLabel: string;
  evidenceTitle: string;
  evidenceLines: readonly string[];
  confirmedScheduleSection: Readonly<{
    title: "확인한 일정 기록";
    items: readonly Readonly<{
      id: string;
      title: string;
      meta: string;
      accessibilityLabel: string;
    }>[];
    additionalLabel: string | null;
  }> | null;
  confirmedBudgetSection: Readonly<{
    title: "확인한 예산 기록";
    items: readonly Readonly<{
      key: "confirmed-budget";
      title: "두 사람이 확인한 예산 기록" | "현재 구성원이 확인한 예산 기록";
      meta: "준비 예산 변경 · 결제 기록이 아니에요.";
      accessibilityLabel: string;
    }>[];
    notice: string | null;
  }> | null;
  catchUpSection: Readonly<{
    title: "직접 알려준 현재 상태";
    items: readonly Readonly<{
      key: "user-reported-catch-up";
      title:
        | "완료했다고 알려준 기록"
        | "진행 중이라고 알려준 기록"
        | "아직 모른다고 남긴 기록"
        | "해당 없다고 알려준 기록";
      meta: string;
      accessibilityLabel: string;
    }>[];
    notice: string | null;
  }> | null;
  bookingDecisionSection: Readonly<{
    title: "방문·상담 후보 기록";
    items: readonly Readonly<{
      id: string;
      title: string;
      detail: string;
      meta: "아모라 내부 기록 · 업체에 전달·확정된 예약이 아니에요.";
      accessibilityLabel: string;
    }>[];
    additionalLabel: string | null;
    notice: string | null;
  }> | null;
  completedBookingOutcomeSection: Readonly<{
    title: "직접 남긴 완료·지출 기록";
    items: readonly Readonly<{
      id: string;
      title: string;
      detail: string;
      amount: string;
      meta: "사용자가 직접 남긴 내부 기록 · 업체 확인·결제 증빙이 아니에요.";
      accessibilityLabel: string;
    }>[];
    additionalLabel: string | null;
    notice: string | null;
  }> | null;
  savedConversationSection: Readonly<{
    title: "아모라와 저장한 대화";
    items: readonly Readonly<{
      refId: string;
      excerpt: string;
      audience: "couple_shared" | "owner_private";
      savedAt: string;
      meta: string;
      canOpenOriginal: true;
      accessibilityLabel: string;
    }>[];
    initialVisibleCount: 2;
    notice: string | null;
  }> | null;
  guideSection: Readonly<{
    eyebrow: "아모라 가이드";
    moduleId: string;
    title: string;
    whyShown: string;
    decisions: readonly string[];
    exceptions: readonly string[];
    dialogueLines: readonly Readonly<{
      say: string;
      note?: string;
    }>[];
    completionEvidence: readonly string[];
    sourceDisclosure: Readonly<AmoraSourceDisclosure>;
    provenance: Readonly<{
      sourceLabel: "웨딩한방 독립 작성 · 내부 편집 검토";
      reviewedLabel: string;
      scopeLabel: string;
      limitations: readonly string[];
    }>;
    accessibilityLabel: string;
  }> | null;
  budgetAction: Readonly<{
    categoryKey: string;
    title: string;
    description: string | null;
    canOpen: boolean;
  }> | null;
  actionReadNotice: string | null;
  remainingLabel: string | null;
  nextAction: Readonly<{
    eyebrow: string;
    title: string;
    reason: string;
    completionCriterion: string;
  }> | null;
}>;

export type PreparationTopicPayerPresentationContext = Readonly<{
  memberModelVersion: 1 | 2 | null;
  viewerRole: "bride" | "groom" | null;
}>;

export declare function buildPreparationTopicPresentation(
  view: AmoraPreparationTopicDetail | null,
  messageReferenceRead?: Readonly<{
    state: "loaded" | "partial" | "unavailable";
    references?: readonly Readonly<{
      refId: string;
      topicKey: string;
      messageId: string;
      audience: "couple_shared" | "owner_private";
      revision: number;
      savedAt: string;
      sourceCreatedAt: string;
      excerpt: string;
      canRemove: true;
      canOpenOriginal: true;
    }>[];
  }>,
  payerPresentationContext?: PreparationTopicPayerPresentationContext | null,
): PreparationTopicPresentation | null;
