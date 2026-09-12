import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toKoreanErrorMessage } from "@/lib/errorCopy";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { TextInput } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import {
  parseCommunityDecisionPublicOutcome,
  type CommunityDecisionPublicOutcome,
} from "@hanbang/shared/community-decision-feed";
import { apiFetchForExpectedUser, optionalAuthGetJson } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  COMMUNITY_DECISION_WAITLIST_PENDING_MAX_AGE_DAYS,
  clearCommunityDecisionDraft,
  clearCommunityDecisionPendingIfMatches,
  clearCommunityDecisionMutationPending,
  loadCommunityDecisionPending,
  loadCommunityDecisionMutationPending,
  saveCommunityDecisionPending,
  saveCommunityDecisionMutationPending,
  type CommunityDecisionPendingSubmission,
} from "@/lib/communityDecisionPending";
import {
  isCommunityDecisionCreateReceiptForSubmission,
  isCommunityDecisionReceiptForCommand,
  isCommunityDecisionUuid,
  parseCommunityDecisionCreateReceipt,
  parseCommunityDecisionDetail,
  parseCommunityDecisionMutationReceipt,
  parseCommunityDecisionPublicationStatus,
  parseCommunityDecisionPublicationWithdrawReceipt,
  parseCommunityDecisionStaleReceipt,
  parseCommunityDecisionWithdrawReceipt,
  parseRetryAfterSeconds,
  readCommunityDecisionApiError,
  type CommunityDecisionApplicability,
  type CommunityDecisionCommercialRelationship,
  type CommunityDecisionDetail,
  type CommunityDecisionMutationOperation,
  type CommunityDecisionMutationPending,
  type CommunityDecisionPublicationStatus,
  type CommunityDecisionPreparationStage,
  type CommunityDecisionPublishedDetail,
  type CommunityDecisionThreadState,
} from "@/lib/communityDecisionThread.mjs";
import {
  AppHeader,
  AppText,
  EmptyState,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";

type PublishedAnswer = CommunityDecisionPublishedDetail["answers"][number];
type AnswerInput = {
  content: string;
  responseKind: "answer" | "experience";
  directExperience: true;
  experiencePeriod: "within_3_months" | "within_6_months" | "within_12_months" | "over_12_months";
  experienceStage: CommunityDecisionPreparationStage;
  coarseRegion: string | null;
  actionTaken: string | null;
  resultSummary: string | null;
  nextCheck: string | null;
  factOpinionBoundary: string;
  commercialRelationship: CommunityDecisionCommercialRelationship;
  sponsorshipDetail: string | null;
};
type OutcomeInput = {
  expectedVersion: number;
  currentOutcomeId: string | null;
  actionTaken: string;
  resultSummary: string;
  applicableConditions: string;
  publicConsent: boolean;
  commercialRelationship: CommunityDecisionCommercialRelationship;
  sponsorshipDetail: string | null;
};
type PublicOutcomeLoadState = "idle" | "loading" | "available" | "empty" | "unavailable";
type WaitlistRecoveryState = "idle" | "loading" | "available" | "missing" | "failed";
type OutcomePublicationLookup = {
  state: "loading" | "available" | "missing" | "unavailable";
  status: CommunityDecisionPublicationStatus | null;
};

function readPublicationOutcomeIdFromSlot(slot: string) {
  const prefix = "publication_withdraw:";
  if (!slot.startsWith(prefix)) return null;
  const outcomeId = slot.slice(prefix.length);
  return isCommunityDecisionUuid(outcomeId) ? outcomeId : null;
}

const STATE_COPY: Record<CommunityDecisionThreadState, { label: string; tone: "neutral" | "rose" | "success" | "warning" }> = {
  open: { label: "사람 답변 기다리는 중", tone: "warning" },
  answered: { label: "사람 답변 도착", tone: "rose" },
  resolved: { label: "질문자가 다음 행동을 정했어요", tone: "success" },
  followup_scheduled: { label: "결과 확인 예정", tone: "warning" },
  completed: { label: "질문자가 결과를 남겼어요", tone: "success" },
  closed: { label: "답변 요청 종료", tone: "neutral" },
};
const STAGE_COPY: Record<CommunityDecisionPreparationStage, string> = {
  vendor_search: "업체 찾는 중",
  contract_review: "계약 검토 중",
  contracted: "계약 완료",
  dispute_or_cancellation: "분쟁·취소 중",
};
const PERIOD_COPY: Record<AnswerInput["experiencePeriod"], string> = {
  within_3_months: "최근 3개월 안",
  within_6_months: "최근 6개월 안",
  within_12_months: "최근 1년 안",
  over_12_months: "1년보다 이전",
};
const SCOPE_COPY: Record<CommunityDecisionPublishedDetail["thread"]["experienceScope"], string> = {
  contract_terms: "계약 문구",
  extra_charge: "추가금",
  vendor_response: "업체 응대",
  cancellation_refund: "취소·환불",
};
const PHASE_COPY: Record<CommunityDecisionPublishedDetail["thread"]["contractPhase"], string> = {
  before_contract: "계약 전",
  after_contract: "계약 후",
  cancellation_or_refund: "취소·환불",
};
const RELATIONSHIP_COPY: Record<CommunityDecisionCommercialRelationship, string> = {
  none: "업체·혜택 관계 없음",
  gift: "제품·서비스 제공",
  discount: "할인",
  refund: "환급",
  affiliate: "제휴",
  paid: "원고료·대가",
  employee: "업계 종사자",
  owner_or_family: "업체 소유자·가족",
  platform_research_compensation: "플랫폼 조사 보상",
};
const POST_ORIGIN_COPY: Record<NonNullable<CommunityDecisionPublishedDetail["post"]>["contentOrigin"], string> = {
  member: "회원 질문",
  industry_professional: "업계 종사자 질문",
  vendor_official: "업체 공식 질문",
  operator: "운영자 안내",
  ai: "AI 생성 안내",
  legacy_unverified: "출처 미확인 기록",
};
const APPLICABILITY_OPTIONS: ReadonlyArray<{ value: CommunityDecisionApplicability; label: string }> = [
  { value: "applies", label: "우리에게 해당돼요" },
  { value: "conditions_differ", label: "조건이 달라요" },
  { value: "need_more_info", label: "더 확인할게요" },
  { value: "taken_as_next_action", label: "다음 행동으로 가져왔어요" },
];
const RELATIONSHIP_OPTIONS = (Object.entries(RELATIONSHIP_COPY) as Array<[
  CommunityDecisionCommercialRelationship,
  string,
]>).map(([value, label]) => ({ value, label }));
const STAGE_OPTIONS = (Object.entries(STAGE_COPY) as Array<[
  CommunityDecisionPreparationStage,
  string,
]>).map(([value, label]) => ({ value, label }));
const PERIOD_OPTIONS = (Object.entries(PERIOD_COPY) as Array<[
  AnswerInput["experiencePeriod"],
  string,
]>).map(([value, label]) => ({ value, label }));

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.choiceBlock}>
      <AppText variant="bodyStrong">{label}</AppText>
      <View style={styles.choiceWrap}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                disabled && styles.disabled,
                pressed && !disabled && styles.pressed,
              ]}
            >
              {selected ? <Check size={14} color={colors.rose[600]} /> : null}
              <AppText
                variant="caption"
                style={selected ? styles.choiceTextSelected : styles.choiceText}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function StructuredLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.structuredLine}>
      <AppText variant="caption" style={styles.structuredLabel}>{label}</AppText>
      <AppText variant="body" style={styles.structuredValue}>{value}</AppText>
    </View>
  );
}

function AnswerCard({
  answer,
  applicability,
  canSetApplicability,
  isIncluded,
  includedInResolution,
  canInclude,
  busy,
  onApplicability,
  onToggleInclude,
}: {
  answer: PublishedAnswer;
  applicability: CommunityDecisionApplicability | null;
  canSetApplicability: boolean;
  isIncluded: boolean;
  includedInResolution: boolean;
  canInclude: boolean;
  busy: boolean;
  onApplicability: (answerId: string, value: CommunityDecisionApplicability) => void;
  onToggleInclude: (answerId: string) => void;
}) {
  const isPeer = answer.contentOrigin === "member";
  return (
    <Surface style={styles.answerCard}>
      <View style={styles.answerTrustRow}>
        <View style={styles.answerIdentity}>
          {isPeer ? (
            <Users size={18} color={colors.success} />
          ) : (
            <ShieldCheck size={18} color={colors.gold.DEFAULT} />
          )}
          <View style={styles.flexOne}>
            <AppText variant="bodyStrong">{answer.author.nickname}</AppText>
            <AppText variant="caption">
              {isPeer ? "예비부부 직접 경험" : "업계 종사자 직접 경험"}
            </AppText>
          </View>
        </View>
        <StatusPill
          label={isPeer ? "회원 경험" : "전문가 경험"}
          tone={isPeer ? "success" : "warning"}
        />
      </View>

      {includedInResolution ? (
        <View style={styles.resolutionEvidenceLine}>
          <CheckCircle2 size={16} color={colors.success} />
          <AppText variant="caption" style={styles.flexOne}>
            질문자가 최종 다음 행동의 근거로 포함한 답변
          </AppText>
        </View>
      ) : null}

      <AppText variant="body" style={styles.answerContent}>{answer.content}</AppText>

      <View style={styles.contextLine}>
        <AppText variant="caption">{PERIOD_COPY[answer.experiencePeriod]}</AppText>
        <AppText variant="caption">·</AppText>
        <AppText variant="caption">{STAGE_COPY[answer.experienceStage]}</AppText>
        {answer.coarseRegion ? (
          <>
            <AppText variant="caption">·</AppText>
            <AppText variant="caption">{answer.coarseRegion}</AppText>
          </>
        ) : null}
      </View>

      <View style={styles.structuredBlock}>
        <StructuredLine label="실제로 한 일" value={answer.actionTaken} />
        <StructuredLine label="결과" value={answer.resultSummary} />
        <StructuredLine label="다음 확인" value={answer.nextCheck} />
        <StructuredLine label="사실·의견 구분" value={answer.factOpinionBoundary} />
      </View>

      <View style={styles.disclosureLine}>
        <AppText variant="caption" style={styles.disclosureLabel}>업체·혜택 관계</AppText>
        <AppText variant="caption">
          {RELATIONSHIP_COPY[answer.commercialRelationship]}
          {answer.sponsorshipDetail ? ` · ${answer.sponsorshipDetail}` : ""}
        </AppText>
      </View>

      {canSetApplicability || applicability ? (
        <View style={styles.applicabilityBlock}>
          <AppText variant="bodyStrong">이 답변은 우리 상황에</AppText>
          <View style={styles.choiceWrap}>
            {APPLICABILITY_OPTIONS.map((option) => {
              const selected = option.value === applicability;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onApplicability(answer.id, option.value)}
                  disabled={!canSetApplicability || busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: !canSetApplicability || busy }}
                  style={({ pressed }) => [
                    styles.choice,
                    selected && styles.choiceSelected,
                    (!canSetApplicability || busy) && styles.disabled,
                    pressed && canSetApplicability && !busy && styles.pressed,
                  ]}
                >
                  {selected ? <Check size={14} color={colors.rose[600]} /> : null}
                  <AppText
                    variant="caption"
                    style={selected ? styles.choiceTextSelected : styles.choiceText}
                  >
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {canInclude && applicability ? (
            <Pressable
              onPress={() => onToggleInclude(answer.id)}
              disabled={busy}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isIncluded, disabled: busy }}
              style={({ pressed }) => [
                styles.includeRow,
                busy && styles.disabled,
                pressed && !busy && styles.pressed,
              ]}
            >
              {isIncluded ? (
                <CheckCircle2 size={20} color={colors.success} />
              ) : (
                <Circle size={20} color={colors.textTertiary} />
              )}
              <AppText variant="caption" style={styles.flexOne}>
                최종 다음 행동에 참고할 답변
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Surface>
  );
}

function AnswerComposer({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: AnswerInput) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState("");
  const [responseKind, setResponseKind] = useState<AnswerInput["responseKind"]>("experience");
  const [directExperience, setDirectExperience] = useState(false);
  const [period, setPeriod] = useState<AnswerInput["experiencePeriod"] | null>(null);
  const [stage, setStage] = useState<CommunityDecisionPreparationStage | null>(null);
  const [region, setRegion] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [resultSummary, setResultSummary] = useState("");
  const [nextCheck, setNextCheck] = useState("");
  const [boundary, setBoundary] = useState("");
  const [relationship, setRelationship] = useState<CommunityDecisionCommercialRelationship>("none");
  const [sponsorship, setSponsorship] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cleanContent = content.trim();
    const cleanRegion = region.trim();
    const cleanAction = actionTaken.trim();
    const cleanResult = resultSummary.trim();
    const cleanNext = nextCheck.trim();
    const cleanBoundary = boundary.trim();
    const cleanSponsorship = sponsorship.trim();
    if (!directExperience) return setError("직접 겪은 경험인지 확인해 주세요.");
    if (cleanContent.length < 10) return setError("답변을 10자 이상 적어주세요.");
    if (!period || !stage) return setError("경험 시점과 당시 단계를 선택해 주세요.");
    if (cleanRegion && cleanRegion.length < 2) return setError("지역은 2자 이상 넓게 적어주세요.");
    if (!cleanAction && !cleanResult && !cleanNext) {
      return setError("실제로 한 일, 결과, 다음 확인 중 하나 이상 적어주세요.");
    }
    if ([cleanAction, cleanResult, cleanNext].some((value) => value.length > 0 && value.length < 3)) {
      return setError("작성한 행동·결과·다음 확인은 각각 3자 이상 적어주세요.");
    }
    if (cleanBoundary.length < 3) return setError("확인한 사실과 개인 의견의 경계를 적어주세요.");
    if (relationship !== "none" && cleanSponsorship.length < 3) {
      return setError("업체 관계나 받은 혜택을 3자 이상 적어주세요.");
    }
    setError(null);
    const saved = await onSubmit({
      content: cleanContent,
      responseKind,
      directExperience: true,
      experiencePeriod: period,
      experienceStage: stage,
      coarseRegion: cleanRegion || null,
      actionTaken: cleanAction || null,
      resultSummary: cleanResult || null,
      nextCheck: cleanNext || null,
      factOpinionBoundary: cleanBoundary,
      commercialRelationship: relationship,
      sponsorshipDetail: relationship === "none" ? null : cleanSponsorship,
    });
    if (!saved) return;
    setExpanded(false);
    setContent("");
    setResponseKind("experience");
    setDirectExperience(false);
    setPeriod(null);
    setStage(null);
    setRegion("");
    setActionTaken("");
    setResultSummary("");
    setNextCheck("");
    setBoundary("");
    setRelationship("none");
    setSponsorship("");
  }

  if (!expanded) {
    return (
      <Surface tone="ivory" style={styles.composerIntro}>
        <View style={styles.composerIntroText}>
          <AppText variant="subtitle">내 경험이 필요한 질문이에요</AppText>
          <AppText variant="caption">
            직접 겪은 시점·행동·결과를 구조화해 남겨요. AI나 운영 안내로 대신할 수 없어요.
          </AppText>
        </View>
        <PrimaryButton onPress={() => setExpanded(true)}>15초 답변 시작</PrimaryButton>
      </Surface>
    );
  }

  return (
    <View style={styles.formSection}>
      <AppText variant="subtitle">직접 경험 답변</AppText>
      <Pressable
        onPress={() => setDirectExperience((current) => !current)}
        disabled={busy}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: directExperience, disabled: busy }}
        style={({ pressed }) => [styles.checkRow, busy && styles.disabled, pressed && !busy && styles.pressed]}
      >
        {directExperience ? (
          <CheckCircle2 size={21} color={colors.success} />
        ) : (
          <Circle size={21} color={colors.textTertiary} />
        )}
        <View style={styles.flexOne}>
          <AppText variant="bodyStrong">제가 직접 겪은 경험이에요</AppText>
          <AppText variant="caption">전해 들은 이야기는 사람 경험 답변으로 등록하지 않아요.</AppText>
        </View>
      </Pressable>
      <ChoiceGroup
        label="답변 방식"
        value={responseKind}
        options={[{ value: "experience", label: "경험 공유" }, { value: "answer", label: "질문에 답하기" }]}
        onChange={setResponseKind}
        disabled={busy}
      />
      <ChoiceGroup label="언제 겪었나요?" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} disabled={busy} />
      <ChoiceGroup label="당시 준비 단계" value={stage} options={STAGE_OPTIONS} onChange={setStage} disabled={busy} />
      <TextInput
        value={content}
        onChangeText={setContent}
        editable={!busy}
        multiline
        maxLength={5000}
        placeholder="핵심 경험을 먼저 적어주세요."
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, styles.multilineInput]}
      />
      <TextInput value={region} onChangeText={setRegion} editable={!busy} maxLength={40} placeholder="넓은 지역 · 선택" placeholderTextColor={colors.textTertiary} style={styles.input} />
      <TextInput value={actionTaken} onChangeText={setActionTaken} editable={!busy} maxLength={2000} placeholder="실제로 한 일 · 하나 이상 필수" placeholderTextColor={colors.textTertiary} style={styles.input} />
      <TextInput value={resultSummary} onChangeText={setResultSummary} editable={!busy} maxLength={3000} placeholder="결과 · 아직 없으면 비워도 돼요" placeholderTextColor={colors.textTertiary} style={styles.input} />
      <TextInput value={nextCheck} onChangeText={setNextCheck} editable={!busy} maxLength={2000} placeholder="다음 커플이 확인할 한 가지" placeholderTextColor={colors.textTertiary} style={styles.input} />
      <TextInput value={boundary} onChangeText={setBoundary} editable={!busy} maxLength={500} placeholder="예: 계약서 문구는 확인한 사실, 대응 평가는 제 의견이에요." placeholderTextColor={colors.textTertiary} style={styles.input} />
      <ChoiceGroup label="업체·혜택 관계" value={relationship} options={RELATIONSHIP_OPTIONS} onChange={setRelationship} disabled={busy} />
      {relationship !== "none" ? (
        <TextInput value={sponsorship} onChangeText={setSponsorship} editable={!busy} maxLength={500} placeholder="업체 관계나 받은 혜택" placeholderTextColor={colors.textTertiary} style={styles.input} />
      ) : null}
      <AppText variant="caption">응답 수락 때 밝힌 업체 관계와 현재 입력이 같아야 저장돼요.</AppText>
      {error ? <AppText variant="caption" style={styles.errorText}>{error}</AppText> : null}
      <PrimaryButton
        onPress={submit}
        disabled={busy}
        icon={busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}
      >
        {busy ? "답변 확인 중" : "사람 경험 답변 남기기"}
      </PrimaryButton>
    </View>
  );
}

function OutcomeComposer({
  detail,
  busy,
  mutationBusy,
  publicationLookups,
  onSubmit,
  onWithdrawPublication,
}: {
  detail: CommunityDecisionPublishedDetail;
  busy: boolean;
  mutationBusy: boolean;
  publicationLookups: ReadonlyMap<string, OutcomePublicationLookup>;
  onSubmit: (input: OutcomeInput) => Promise<boolean>;
  onWithdrawPublication: (outcomeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [actionTaken, setActionTaken] = useState("");
  const [resultSummary, setResultSummary] = useState("");
  const [conditions, setConditions] = useState("");
  const [publicConsent, setPublicConsent] = useState(false);
  const [relationship, setRelationship] = useState<CommunityDecisionCommercialRelationship>("none");
  const [sponsorship, setSponsorship] = useState("");
  const [error, setError] = useState<string | null>(null);
  const currentOutcome = [...detail.viewer.outcomes]
    .sort((a, b) => b.revision - a.revision)[0] ?? null;

  async function submit() {
    const action = actionTaken.trim();
    const result = resultSummary.trim();
    const applicable = conditions.trim();
    const disclosure = sponsorship.trim();
    if (action.length < 3 || result.length < 3 || applicable.length < 3) {
      return setError("실제 행동, 결과, 적용 조건을 각각 3자 이상 적어주세요.");
    }
    if (relationship !== "none" && disclosure.length < 3) {
      return setError("업체 관계나 받은 혜택을 3자 이상 적어주세요.");
    }
    setError(null);
    const saved = await onSubmit({
      expectedVersion: detail.thread.version,
      currentOutcomeId: currentOutcome?.id ?? null,
      actionTaken: action,
      resultSummary: result,
      applicableConditions: applicable,
      publicConsent,
      commercialRelationship: relationship,
      sponsorshipDetail: relationship === "none" ? null : disclosure,
    });
    if (!saved) return;
    setExpanded(false);
    setActionTaken("");
    setResultSummary("");
    setConditions("");
    setPublicConsent(false);
    setRelationship("none");
    setSponsorship("");
  }

  return (
    <View style={styles.formSection}>
      <View style={styles.sectionTitleRow}>
        <View style={styles.flexOne}>
          <AppText variant="subtitle">나만 보는 결과 기록</AppText>
          <AppText variant="caption">
            과거 결과를 덮어쓰지 않고 새 revision으로 남겨요. 검수된 공개 해결 기록과는 별개예요.
          </AppText>
        </View>
        <LockKeyhole size={20} color={colors.noir[800]} />
      </View>
      {detail.viewer.outcomes.map((outcome) => {
        const publication = publicationLookups.get(outcome.id) ?? null;
        const publicationCopy = !outcome.publicConsent
          ? "비공개 유지"
          : publication?.state === "loading"
            ? "공개 상태 확인 중"
            : publication?.state === "missing"
              ? "공개 기록이 없거나 현재 확인할 수 없어요"
              : publication?.state === "unavailable" || !publication?.status
                ? "공개 상태를 확인하지 못해 철회 버튼을 숨겼어요"
                : publication.status.publicationState === "pending_review"
                  ? "공개 검수 대기 중 · 아직 공개되지 않았어요"
                  : publication.status.publicationState === "published"
                    ? "검수 후 공개 중"
                    : publication.status.publicationState === "rejected"
                      ? "공개 검수에서 비공개 유지됨"
                      : "공개 동의 철회 완료";
        return (
        <View key={outcome.id} style={styles.outcomeRow}>
          <AppText variant="caption">결과 revision {outcome.revision}</AppText>
          <AppText variant="bodyStrong">{outcome.resultSummary}</AppText>
          <AppText variant="body">실제로 한 일 · {outcome.actionTaken}</AppText>
          <AppText variant="caption">적용 조건 · {outcome.applicableConditions}</AppText>
          <AppText variant="caption">
            업체·혜택 관계 · {RELATIONSHIP_COPY[outcome.commercialRelationship]}
            {outcome.sponsorshipDetail ? ` · ${outcome.sponsorshipDetail}` : ""}
          </AppText>
          <AppText variant="caption">
            {publicationCopy}
          </AppText>
          {publication?.status?.canWithdraw ? (
              <Pressable
                onPress={() => onWithdrawPublication(outcome.id)}
                disabled={mutationBusy}
                accessibilityRole="button"
                accessibilityLabel={`결과 revision ${outcome.revision} 공개 동의 철회`}
                accessibilityState={{ disabled: mutationBusy }}
                style={({ pressed }) => [
                  styles.outcomePublicationWithdraw,
                  mutationBusy && styles.disabled,
                  pressed && !mutationBusy && styles.pressed,
                ]}
              >
                <AppText variant="caption" style={styles.withdrawLink}>공개 동의 철회</AppText>
              </Pressable>
            ) : null}
        </View>
        );
      })}
      {!expanded ? (
        <PrimaryButton tone="ghost" onPress={() => setExpanded(true)}>
          {currentOutcome ? "결과 정정 revision 남기기" : "실제 결과 남기기"}
        </PrimaryButton>
      ) : (
        <>
          <TextInput value={actionTaken} onChangeText={setActionTaken} editable={!busy} maxLength={2000} placeholder="실제로 한 행동" placeholderTextColor={colors.textTertiary} style={styles.input} />
          <TextInput value={resultSummary} onChangeText={setResultSummary} editable={!busy} maxLength={3000} placeholder="실제 결과" placeholderTextColor={colors.textTertiary} style={styles.input} />
          <TextInput value={conditions} onChangeText={setConditions} editable={!busy} maxLength={2000} placeholder="다음 커플에게 적용될 조건" placeholderTextColor={colors.textTertiary} style={styles.input} />
          <ChoiceGroup label="결과 시점의 업체·혜택 관계" value={relationship} options={RELATIONSHIP_OPTIONS} onChange={setRelationship} disabled={busy} />
          {relationship !== "none" ? (
            <TextInput value={sponsorship} onChangeText={setSponsorship} editable={!busy} maxLength={500} placeholder="업체 관계나 받은 혜택" placeholderTextColor={colors.textTertiary} style={styles.input} />
          ) : null}
          <Pressable
            onPress={() => setPublicConsent((current) => !current)}
            disabled={busy}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: publicConsent, disabled: busy }}
            style={({ pressed }) => [
              styles.checkRow,
              busy && styles.disabled,
              pressed && !busy && styles.pressed,
            ]}
          >
            {publicConsent ? <CheckCircle2 size={21} color={colors.success} /> : <Circle size={21} color={colors.textTertiary} />}
            <View style={styles.flexOne}>
              <AppText variant="bodyStrong">별도 공개 검수 후보로 보내기</AppText>
              <AppText variant="caption">동의만으로 공개·검색 노출되지 않으며, 기여자별 동의와 개인정보 검수를 다시 거쳐요.</AppText>
            </View>
          </Pressable>
          {error ? <AppText variant="caption" style={styles.errorText}>{error}</AppText> : null}
          <PrimaryButton onPress={submit} disabled={busy} icon={busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}>
            {busy ? "결과 확인 중" : (currentOutcome ? "정정 revision 저장" : "결과 저장")}
          </PrimaryButton>
        </>
      )}
    </View>
  );
}

type LoadFailure = "auth" | "unavailable" | "failed" | "contract";
type PendingCommand = CommunityDecisionMutationPending;

export default function DecisionThreadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const questionId = typeof id === "string" ? id : "";
  const [sessionLoading, setSessionLoading] = useState(true);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommunityDecisionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [mutationBusy, setMutationBusy] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);
  const [resolutionAnswerIds, setResolutionAnswerIds] = useState<string[]>([]);
  const [nextAction, setNextAction] = useState("");
  const [resolutionReason, setResolutionReason] = useState("");
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [recoveryCycle, setRecoveryCycle] = useState(0);
  const [publicOutcome, setPublicOutcome] = useState<CommunityDecisionPublicOutcome | null>(null);
  const [publicOutcomeState, setPublicOutcomeState] = useState<PublicOutcomeLoadState>("idle");
  const [waitlistPending, setWaitlistPending] =
    useState<CommunityDecisionPendingSubmission | null>(null);
  const [waitlistRecoveryState, setWaitlistRecoveryState] =
    useState<WaitlistRecoveryState>("idle");
  const [waitlistClock, setWaitlistClock] = useState(() => Date.now());
  const [withdrawalRecovered, setWithdrawalRecovered] = useState(false);
  const [publicationLookups, setPublicationLookups] =
    useState<ReadonlyMap<string, OutcomePublicationLookup>>(() => new Map());

  const authGenerationRef = useRef(0);
  const authInitializedRef = useRef(false);
  const currentOwnerRef = useRef<string | null>(null);
  const loadSequenceRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const mutationBusyRef = useRef<string | null>(null);
  const commandRef = useRef(new Map<string, PendingCommand>());
  const recoveredCommandRef = useRef<string | null>(null);

  const isViewerCurrent = useCallback(async (
    expectedOwnerId: string | null,
    generation: number,
  ) => {
    if (authGenerationRef.current !== generation) return false;
    const { data } = await supabase.auth.getSession();
    const currentOwnerId = data.session?.user.id.toLowerCase() ?? null;
    return authGenerationRef.current === generation
      && currentOwnerId === (expectedOwnerId?.toLowerCase() ?? null);
  }, []);

  const loadThread = useCallback(async (
    expectedOwnerId: string | null,
    generation = authGenerationRef.current,
    silent = false,
  ) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    if (!isCommunityDecisionUuid(questionId)) {
      setFailure("unavailable");
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setFailure(null);
    try {
      const path = `/api/community/decision-threads/${questionId}`;
      let body: unknown;
      let responseStatus = 200;
      let responseOk = true;
      if (expectedOwnerId) {
        const response = await apiFetchForExpectedUser(expectedOwnerId, path);
        responseStatus = response.status;
        responseOk = response.ok;
        body = await response.json().catch(() => null) as unknown;
      } else {
        body = await optionalAuthGetJson<unknown>(path);
      }
      if (
        loadSequenceRef.current !== sequence
        || !(await isViewerCurrent(expectedOwnerId, generation))
      ) return;
      if (!responseOk) {
        setDetail(null);
        setPublicOutcome(null);
        setPublicOutcomeState("idle");
        setPublicationLookups(new Map());
        setFailure(responseStatus === 401
          ? "auth"
          : responseStatus === 403 || responseStatus === 404
            ? "unavailable"
            : "failed");
        return;
      }
      const parsed = parseCommunityDecisionDetail(body);
      if (!parsed) {
        setDetail(null);
        setPublicOutcome(null);
        setPublicOutcomeState("idle");
        setPublicationLookups(new Map());
        setFailure("contract");
        return;
      }
      setDetail(parsed);
      setMutationError(null);
      if (!("status" in parsed)) {
        const visibleAnswerIds = new Set(parsed.answers.map((answer) => answer.id));
        const selected = parsed.viewer.selection
          .filter((item) => visibleAnswerIds.has(item.answerId))
          .filter((item) => item.applicability === "applies"
            || item.applicability === "taken_as_next_action")
          .map((item) => item.answerId);
        setResolutionAnswerIds(selected);
        setNextAction(parsed.thread.nextAction ?? "");
        if (!parsed.viewer.isAuthor) {
          setPublicationLookups(new Map());
          setPublicOutcome(null);
          setPublicOutcomeState("loading");
          try {
            const outcomePath = `/api/community/decision-threads/${questionId}/outcomes`;
            let outcomeBody: unknown;
            let outcomeOk = true;
            if (expectedOwnerId) {
              const outcomeResponse = await apiFetchForExpectedUser(
                expectedOwnerId,
                outcomePath,
              );
              outcomeOk = outcomeResponse.ok;
              outcomeBody = await outcomeResponse.json().catch(() => null) as unknown;
            } else {
              outcomeBody = await optionalAuthGetJson<unknown>(outcomePath);
            }
            if (
              loadSequenceRef.current !== sequence
              || !(await isViewerCurrent(expectedOwnerId, generation))
            ) return;
            const parsedOutcome = outcomeOk
              ? parseCommunityDecisionPublicOutcome(outcomeBody)
              : null;
            if (!parsedOutcome) {
              setPublicOutcome(null);
              setPublicOutcomeState("unavailable");
            } else {
              setPublicOutcome(parsedOutcome.outcome);
              setPublicOutcomeState(parsedOutcome.outcome ? "available" : "empty");
            }
          } catch {
            if (
              loadSequenceRef.current === sequence
              && await isViewerCurrent(expectedOwnerId, generation)
            ) {
              setPublicOutcome(null);
              setPublicOutcomeState("unavailable");
            }
          }
        } else {
          setPublicOutcome(null);
          setPublicOutcomeState("idle");
          const candidates = parsed.viewer.outcomes.filter((outcome) => outcome.publicConsent);
          if (candidates.length === 0) {
            setPublicationLookups(new Map());
          } else if (!expectedOwnerId) {
            setPublicationLookups(new Map(candidates.map((outcome) => [
              outcome.id,
              { state: "unavailable", status: null },
            ])));
          } else {
            setPublicationLookups(new Map(candidates.map((outcome) => [
              outcome.id,
              { state: "loading", status: null },
            ])));
            const lookups: Array<readonly [string, OutcomePublicationLookup]> =
              await Promise.all(candidates.map(async (outcome) => {
              try {
                const response = await apiFetchForExpectedUser(
                  expectedOwnerId,
                  `/api/community/decision-threads/${questionId}/outcomes/${outcome.id}/publication`,
                );
                if (response.status === 404) {
                  return [outcome.id, { state: "missing", status: null }] as const;
                }
                const responseBody = await response.json().catch(() => null) as unknown;
                const status = response.ok
                  ? parseCommunityDecisionPublicationStatus(responseBody)
                  : null;
                if (
                  !status
                  || status.threadId !== questionId
                  || status.outcomeId !== outcome.id
                  || status.revision !== outcome.revision
                ) {
                  return [outcome.id, { state: "unavailable", status: null }] as const;
                }
                return [outcome.id, { state: "available", status }] as const;
              } catch {
                return [outcome.id, { state: "unavailable", status: null }] as const;
              }
              }));
            if (
              loadSequenceRef.current !== sequence
              || !(await isViewerCurrent(expectedOwnerId, generation))
            ) return;
            setPublicationLookups((current) => {
              const next = new Map(lookups);
              for (const [outcomeId, lookup] of current) {
                if (lookup.status?.publicationState === "withdrawn") {
                  next.set(outcomeId, lookup);
                }
              }
              return next;
            });
          }
        }
      } else {
        setResolutionAnswerIds([]);
        setNextAction("");
        setPublicOutcome(null);
        setPublicOutcomeState("idle");
        setPublicationLookups(new Map());
      }
    } catch {
      if (
        loadSequenceRef.current === sequence
        && await isViewerCurrent(expectedOwnerId, generation)
      ) {
        setDetail(null);
        setPublicOutcome(null);
        setPublicOutcomeState("idle");
        setPublicationLookups(new Map());
        setFailure("failed");
      }
    } finally {
      if (loadSequenceRef.current === sequence) setLoading(false);
    }
  }, [isViewerCurrent, questionId]);

  const syncOwner = useCallback((nextOwnerId: string | null) => {
    const normalized = nextOwnerId?.toLowerCase() ?? null;
    if (authInitializedRef.current && currentOwnerRef.current === normalized) return;
    authInitializedRef.current = true;
    currentOwnerRef.current = normalized;
    authGenerationRef.current += 1;
    loadSequenceRef.current += 1;
    mutationSequenceRef.current += 1;
    mutationBusyRef.current = null;
    commandRef.current.clear();
    recoveredCommandRef.current = null;
    setOwnerId(nextOwnerId);
    setDetail(null);
    setFailure(null);
    setMutationBusy(null);
    setMutationError(null);
    setMutationNotice(null);
    setPublicOutcome(null);
    setPublicOutcomeState("idle");
    setWaitlistPending(null);
    setWaitlistRecoveryState("idle");
    setWithdrawalRecovered(false);
    setPublicationLookups(new Map());
    setResolutionAnswerIds([]);
    setShowWithdraw(false);
    setWithdrawReason("");
    setSessionLoading(false);
    void loadThread(nextOwnerId, authGenerationRef.current);
  }, [loadThread]);

  useEffect(() => {
    let disposed = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!disposed) syncOwner(data.session?.user.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!disposed) syncOwner(session?.user.id ?? null);
    });
    return () => {
      disposed = true;
      authGenerationRef.current += 1;
      loadSequenceRef.current += 1;
      mutationSequenceRef.current += 1;
      commandRef.current.clear();
      recoveredCommandRef.current = null;
      subscription.unsubscribe();
    };
  }, [syncOwner]);

  useFocusEffect(useCallback(() => {
    if (!sessionLoading) {
      void loadThread(ownerId, authGenerationRef.current, true);
      setRecoveryCycle((current) => current + 1);
    }
  }, [loadThread, ownerId, sessionLoading]));

  useEffect(() => {
    if (!ownerId || !detail || !detail.viewer.isAuthor) {
      setWaitlistPending(null);
      setWaitlistRecoveryState("idle");
      return;
    }
    let cancelled = false;
    const generation = authGenerationRef.current;
    const isWaitlist = "status" in detail;
    if (isWaitlist) setWaitlistRecoveryState("loading");
    void (async () => {
      try {
        const pending = await loadCommunityDecisionPending(ownerId);
        if (
          cancelled
          || !(await isViewerCurrent(ownerId, generation))
        ) return;
        const matching = pending?.questionId === questionId ? pending : null;
        if (!isWaitlist) {
          if (matching) {
            await clearCommunityDecisionPendingIfMatches(
              ownerId,
              matching.questionId,
              matching.operationKey,
            );
          }
          if (!cancelled && await isViewerCurrent(ownerId, generation)) {
            setWaitlistPending(null);
            setWaitlistRecoveryState("idle");
          }
          return;
        }
        setWaitlistClock(Date.now());
        setWaitlistPending(matching);
        setWaitlistRecoveryState(matching ? "available" : "missing");
      } catch {
        if (
          !cancelled
          && isWaitlist
          && await isViewerCurrent(ownerId, generation)
        ) {
          setWaitlistPending(null);
          setWaitlistRecoveryState("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail, isViewerCurrent, ownerId, questionId, recoveryCycle]);

  useEffect(() => {
    if (!waitlistPending?.retryAt || waitlistPending.retryAt <= waitlistClock) return;
    const timer = setInterval(() => setWaitlistClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [waitlistClock, waitlistPending?.retryAt]);

  const waitlistRetryRemainingSeconds = waitlistPending?.retryAt
    ? Math.max(0, Math.ceil((waitlistPending.retryAt - waitlistClock) / 1_000))
    : 0;

  const executeMutation = useCallback(async <T,>({
    operation,
    slot,
    path,
    method,
    body,
    parse,
    receiptBelongsToCommand = (receipt, operationKey) => (
      isCommunityDecisionReceiptForCommand(receipt, operationKey)
    ),
    successMessage,
    reloadAfterSuccess = true,
  }: {
    operation: CommunityDecisionMutationOperation | "withdraw" | "publication_withdraw";
    slot: string;
    path: string;
    method: "POST" | "PUT" | "DELETE";
    body: unknown;
    parse: (value: unknown) => T | null;
    receiptBelongsToCommand?: (receipt: T, operationKey: string) => boolean;
    successMessage: string;
    reloadAfterSuccess?: boolean;
  }): Promise<T | null> => {
    if (!ownerId || mutationBusyRef.current !== null) return null;
    const bodyText = JSON.stringify(body);
    const sequence = mutationSequenceRef.current + 1;
    mutationSequenceRef.current = sequence;
    const generation = authGenerationRef.current;
    mutationBusyRef.current = slot;
    setMutationBusy(slot);
    setMutationError(null);
    setMutationNotice(null);
    try {
      const stored = await loadCommunityDecisionMutationPending(ownerId, questionId);
      const existing = commandRef.current.get(slot) ?? stored;
      if (
        existing
        && (
          existing.slot !== slot
          || existing.operation !== operation
          || existing.bodyText !== bodyText
        )
      ) {
        setMutationError("이전 요청의 반영 여부를 먼저 확인해야 해요. 저장된 요청을 바꾸지 않고 다시 확인해 주세요.");
        return null;
      }
      const command: PendingCommand = existing ?? {
        ownerId,
        questionId,
        slot,
        operation,
        operationKey: Crypto.randomUUID(),
        bodyText,
        createdAt: Date.now(),
      };
      await saveCommunityDecisionMutationPending(command);
      commandRef.current.set(slot, command);
      const response = await apiFetchForExpectedUser(ownerId, path, {
        method,
        headers: { "Idempotency-Key": command.operationKey },
        body: command.bodyText,
      });
      const responseBody = await response.json().catch(() => null) as unknown;
      if (
        mutationSequenceRef.current !== sequence
        || !(await isViewerCurrent(ownerId, generation))
      ) return null;
      if (!response.ok) {
        const stale = response.status === 409
          ? parseCommunityDecisionStaleReceipt(responseBody)
          : null;
        if (
          stale
          && stale.threadId === questionId
          && isCommunityDecisionReceiptForCommand(stale, command.operationKey)
        ) {
          await clearCommunityDecisionMutationPending(ownerId, questionId);
          commandRef.current.delete(slot);
          setMutationError("다른 변경이 먼저 반영되어 최신 상태를 다시 불러왔어요.");
          await loadThread(ownerId, generation, true);
          return null;
        }
        if (response.status < 500 && response.status !== 429) {
          await clearCommunityDecisionMutationPending(ownerId, questionId);
          commandRef.current.delete(slot);
        }
        setMutationError(readCommunityDecisionApiError(responseBody, "요청을 안전하게 확인하지 못했어요."));
        return null;
      }
      const receipt = parse(responseBody);
      if (!receipt || !receiptBelongsToCommand(receipt, command.operationKey)) {
        setMutationError("서버 영수증을 확인하지 못했어요. 새 요청을 만들지 않고 같은 행동으로 다시 확인해 주세요.");
        return null;
      }
      await clearCommunityDecisionMutationPending(ownerId, questionId);
      commandRef.current.delete(slot);
      setMutationNotice(successMessage);
      if (reloadAfterSuccess) await loadThread(ownerId, generation, true);
      return receipt;
    } catch (error) {
      if (await isViewerCurrent(ownerId, generation)) {
        setMutationError(toKoreanErrorMessage(
          error,
          "네트워크 응답을 받지 못했어요. 같은 행동으로 다시 확인해 주세요.",
        ));
      }
      return null;
    } finally {
      if (mutationSequenceRef.current === sequence) {
        mutationBusyRef.current = null;
        setMutationBusy(null);
      }
    }
  }, [isViewerCurrent, loadThread, ownerId, questionId]);

  const mutateDecision = useCallback((
    operation: CommunityDecisionMutationOperation,
    slot: string,
    path: string,
    method: "POST" | "PUT",
    body: unknown,
    successMessage: string,
  ) => executeMutation({
    operation,
    slot,
    path,
    method,
    body,
    parse: (value) => {
      const receipt = parseCommunityDecisionMutationReceipt(value, operation);
      return receipt?.threadId === questionId ? receipt : null;
    },
    successMessage,
  }), [executeMutation, questionId]);

  useEffect(() => {
    if (!ownerId || !isCommunityDecisionUuid(questionId) || recoveryCycle < 1) return;
    let cancelled = false;
    const generation = authGenerationRef.current;
    void (async () => {
      const pending = await loadCommunityDecisionMutationPending(ownerId, questionId);
      if (
        cancelled
        || !pending
        || !(await isViewerCurrent(ownerId, generation))
      ) return;
      const attemptId = `${pending.operationKey}:${recoveryCycle}`;
      if (recoveredCommandRef.current === attemptId) return;
      recoveredCommandRef.current = attemptId;
      const body = JSON.parse(pending.bodyText) as unknown;
      const suffix: Record<CommunityDecisionMutationPending["operation"], string> = {
        answer: "answers",
        applicability: "applicability",
        resolve: "resolve",
        outcome: "outcomes",
        withdraw: "withdraw",
        publication_withdraw: "outcomes",
      };
      const publicationOutcomeId = pending.operation === "publication_withdraw"
        ? readPublicationOutcomeIdFromSlot(pending.slot)
        : null;
      if (pending.operation === "publication_withdraw" && !publicationOutcomeId) {
        setMutationError("이전 공개 동의 철회 요청의 대상을 안전하게 확인하지 못했어요.");
        return;
      }
      const recoveredReceipt = await executeMutation({
        operation: pending.operation,
        slot: pending.slot,
        path: pending.operation === "publication_withdraw"
          ? `/api/community/decision-threads/${questionId}/outcomes/${publicationOutcomeId}/publication`
          : `/api/community/decision-threads/${questionId}/${suffix[pending.operation]}`,
        method: pending.operation === "publication_withdraw"
          ? "DELETE"
          : pending.operation === "applicability" ? "PUT" : "POST",
        body,
        parse: (value) => {
          if (pending.operation === "withdraw") {
            const receipt = parseCommunityDecisionWithdrawReceipt(value);
            return receipt?.questionId === questionId ? receipt : null;
          }
          if (pending.operation === "publication_withdraw") {
            const receipt = parseCommunityDecisionPublicationWithdrawReceipt(value);
            return receipt?.threadId === questionId
              && receipt.outcomeId === publicationOutcomeId
              ? receipt
              : null;
          }
          const receipt = parseCommunityDecisionMutationReceipt(
            value,
            pending.operation,
          );
          return receipt?.threadId === questionId ? receipt : null;
        },
        receiptBelongsToCommand: pending.operation === "publication_withdraw"
          ? (value, operationKey) => {
            const receipt = parseCommunityDecisionPublicationWithdrawReceipt(value);
            return receipt?.threadId === questionId
              && receipt.outcomeId === publicationOutcomeId
              && isCommunityDecisionReceiptForCommand(receipt, operationKey);
          }
          : undefined,
        successMessage: pending.operation === "withdraw"
          ? "이전에 보낸 철회 요청의 영수증을 확인했어요."
          : pending.operation === "publication_withdraw"
            ? "이전에 보낸 공개 동의 철회 영수증을 확인했어요."
            : "이전에 보낸 요청의 저장 영수증을 확인했어요.",
        reloadAfterSuccess: pending.operation !== "withdraw"
          && pending.operation !== "publication_withdraw",
      });
      if (
        !recoveredReceipt
        || cancelled
        || !(await isViewerCurrent(ownerId, generation))
      ) return;
      if (pending.operation === "withdraw") {
        setWithdrawalRecovered(true);
        setWaitlistPending(null);
        setWaitlistRecoveryState("idle");
        try {
          const createPending = await loadCommunityDecisionPending(ownerId);
          if (createPending?.questionId === questionId) {
            await clearCommunityDecisionPendingIfMatches(
              ownerId,
              createPending.questionId,
              createPending.operationKey,
            );
          }
        } catch {
          if (await isViewerCurrent(ownerId, generation)) {
            setMutationError("철회는 확인했지만 이 기기의 복구 명령 삭제는 확인하지 못했어요. 로그아웃할 때 다시 정리해요.");
          }
        }
      }
      if (
        pending.operation === "publication_withdraw"
        && publicationOutcomeId
      ) {
        const withdrawn = parseCommunityDecisionPublicationWithdrawReceipt(
          recoveredReceipt,
        );
        if (withdrawn) {
          setPublicationLookups((current) => {
            const next = new Map(current);
            next.set(publicationOutcomeId, {
              state: "available",
              status: {
                outcomeId: withdrawn.outcomeId,
                threadId: withdrawn.threadId,
                revision: withdrawn.revision,
                publicationState: "withdrawn",
                canWithdraw: false,
                updatedAt: withdrawn.withdrawnAt,
              },
            });
            return next;
          });
        }
      }
    })().catch(() => {
      if (!cancelled) {
        setMutationError("이전 요청을 안전하게 다시 확인하지 못했어요. 화면을 다시 열어 재시도해 주세요.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [executeMutation, isViewerCurrent, ownerId, questionId, recoveryCycle]);

  const publishedDetail = detail && !("status" in detail) ? detail : null;
  const selectionByAnswer = useMemo(() => new Map(
    publishedDetail?.viewer.selection.map((item) => [item.answerId, item.applicability]) ?? [],
  ), [publishedDetail]);
  const includedInResolutionAnswerIds = useMemo(() => new Set(
    publishedDetail?.viewer.selection
      .filter((item) => item.includedInResolutionAt !== null)
      .map((item) => item.answerId) ?? [],
  ), [publishedDetail]);

  const handleApplicability = useCallback((
    answerId: string,
    applicability: CommunityDecisionApplicability,
  ) => {
    if (!publishedDetail) return;
    void mutateDecision(
      "applicability",
      `applicability:${answerId}`,
      `/api/community/decision-threads/${questionId}/applicability`,
      "PUT",
      { expectedVersion: publishedDetail.thread.version, answerId, applicability },
      "이 답변의 적용성을 기록했어요.",
    );
  }, [mutateDecision, publishedDetail, questionId]);

  const handleAnswer = useCallback(async (input: AnswerInput) => {
    const receipt = await mutateDecision(
      "answer",
      "answer",
      `/api/community/decision-threads/${questionId}/answers`,
      "POST",
      input,
      "사람 경험 답변을 기록했어요.",
    );
    return receipt !== null;
  }, [mutateDecision, questionId]);

  const handleResolve = useCallback(() => {
    if (!publishedDetail) return;
    const visibleAnswerIds = new Set(publishedDetail.answers.map((answer) => answer.id));
    const answerIds = resolutionAnswerIds.filter((answerId) => visibleAnswerIds.has(answerId));
    const action = nextAction.trim();
    const reason = resolutionReason.trim();
    if (answerIds.length === 0) return setMutationError("적용성을 표시한 현재 답변 중 참고할 답변을 선택해 주세요.");
    if (action.length < 3 || reason.length < 3) return setMutationError("다음 행동과 정한 이유를 각각 3자 이상 적어주세요.");
    void mutateDecision(
      "resolve",
      "resolve",
      `/api/community/decision-threads/${questionId}/resolve`,
      "POST",
      { expectedVersion: publishedDetail.thread.version, answerIds, nextAction: action, reason },
      "다음 행동을 정했어요. 이것은 커플의 확정 결정이나 실행 완료를 뜻하지 않아요.",
    );
  }, [mutateDecision, nextAction, publishedDetail, questionId, resolutionAnswerIds, resolutionReason]);

  const handleOutcome = useCallback(async (input: OutcomeInput) => {
    const receipt = await mutateDecision(
      "outcome",
      "outcome",
      `/api/community/decision-threads/${questionId}/outcomes`,
      "POST",
      input,
      input.publicConsent
        ? "비공개 결과를 저장하고 공개 검수 후보 요청을 접수했어요. 아직 공개된 것은 아니에요."
        : "비공개 실제 결과 revision을 기록했어요.",
    );
    return receipt !== null;
  }, [mutateDecision, questionId]);

  const retryExactWaitlistCommand = useCallback(async () => {
    if (
      !ownerId
      || !waitlistPending
      || waitlistPending.questionId !== questionId
      || mutationBusyRef.current !== null
    ) return;
    const retryingWithdrawal = Boolean(
      waitlistPending.withdrawOperationKey && waitlistPending.withdrawBodyText,
    );
    if (!retryingWithdrawal && waitlistRetryRemainingSeconds > 0) return;

    const slot = retryingWithdrawal
      ? "waitlist_withdraw_recovery"
      : "waitlist_create_recovery";
    const sequence = mutationSequenceRef.current + 1;
    mutationSequenceRef.current = sequence;
    const generation = authGenerationRef.current;
    mutationBusyRef.current = slot;
    setMutationBusy(slot);
    setMutationError(null);
    setMutationNotice(null);
    try {
      const latest = await loadCommunityDecisionPending(ownerId);
      if (
        !latest
        || latest.questionId !== waitlistPending.questionId
        || latest.operationKey !== waitlistPending.operationKey
        || latest.bodyText !== waitlistPending.bodyText
        || latest.withdrawOperationKey !== waitlistPending.withdrawOperationKey
        || latest.withdrawBodyText !== waitlistPending.withdrawBodyText
      ) {
        setWaitlistPending(null);
        setWaitlistRecoveryState("missing");
        setMutationError("이 기기의 원래 복구 명령이 없거나 달라져 새 요청을 보내지 않았어요.");
        return;
      }
      if (
        !retryingWithdrawal
        && latest.retryAt !== null
        && latest.retryAt > Date.now()
      ) {
        setWaitlistClock(Date.now());
        setWaitlistPending(latest);
        setMutationError("서버가 안내한 재확인 시간이 아직 지나지 않았어요.");
        return;
      }
      const operationKey = retryingWithdrawal
        ? latest.withdrawOperationKey
        : latest.operationKey;
      const bodyText = retryingWithdrawal
        ? latest.withdrawBodyText
        : latest.bodyText;
      if (!operationKey || !bodyText) {
        setMutationError("같은 요청을 재시도할 암호화 명령을 확인하지 못했어요.");
        return;
      }
      const path = retryingWithdrawal
        ? `/api/community/decision-threads/${questionId}/withdraw`
        : "/api/community/decision-threads";
      const response = await apiFetchForExpectedUser(ownerId, path, {
        method: "POST",
        headers: { "Idempotency-Key": operationKey },
        body: bodyText,
      });
      const responseBody = await response.json().catch(() => null) as unknown;
      if (
        mutationSequenceRef.current !== sequence
        || !(await isViewerCurrent(ownerId, generation))
      ) return;
      if (!response.ok) {
        setMutationError(readCommunityDecisionApiError(
          responseBody,
          retryingWithdrawal
            ? "철회 요청의 반영 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요."
            : "게시 요청의 반영 여부를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.",
        ));
        return;
      }

      if (retryingWithdrawal) {
        const receipt = parseCommunityDecisionWithdrawReceipt(responseBody);
        if (
          !receipt
          || receipt.questionId !== questionId
          || receipt.threadId !== null
          || !isCommunityDecisionReceiptForCommand(receipt, operationKey)
        ) {
          setMutationError("철회 영수증을 원래 요청과 대조하지 못했어요. 복구 명령을 지우지 않았어요.");
          return;
        }
        await clearCommunityDecisionPendingIfMatches(
          ownerId,
          latest.questionId,
          latest.operationKey,
        );
        await clearCommunityDecisionDraft(ownerId).catch(() => undefined);
        if (!(await isViewerCurrent(ownerId, generation))) return;
        setWaitlistPending(null);
        setWaitlistRecoveryState("idle");
        setWithdrawalRecovered(true);
        setMutationNotice("비공개 대기 요청의 철회 영수증을 확인했어요.");
        return;
      }

      const receipt = parseCommunityDecisionCreateReceipt(
        responseBody,
        response.status,
      );
      if (!receipt || !isCommunityDecisionCreateReceiptForSubmission(
        receipt,
        latest.questionId,
        latest.operationKey,
        latest.commandId,
      )) {
        setMutationError("게시 영수증을 원래 요청과 대조하지 못했어요. 복구 명령을 지우지 않았어요.");
        return;
      }
      if (receipt.kind === "private_waitlist") {
        const retryAfter = parseRetryAfterSeconds(response.headers.get("Retry-After"));
        const maxExpiryAt = latest.createdAt
          + COMMUNITY_DECISION_WAITLIST_PENDING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
        const proposedRetryAt = retryAfter ? Date.now() + retryAfter * 1_000 : null;
        const nextPending: CommunityDecisionPendingSubmission = {
          ...latest,
          phase: "private_waitlist",
          commandId: receipt.commandId,
          retryAt: proposedRetryAt === null
            ? null
            : Math.min(proposedRetryAt, maxExpiryAt),
        };
        await saveCommunityDecisionPending(nextPending);
        if (!(await isViewerCurrent(ownerId, generation))) return;
        setWaitlistClock(Date.now());
        setWaitlistPending(nextPending);
        setWaitlistRecoveryState("available");
        setMutationNotice("원래 요청으로 확인했어요. 아직 비공개 대기 상태예요.");
        return;
      }

      await clearCommunityDecisionPendingIfMatches(
        ownerId,
        latest.questionId,
        latest.operationKey,
      );
      await clearCommunityDecisionDraft(ownerId).catch(() => undefined);
      if (!(await isViewerCurrent(ownerId, generation))) return;
      setWaitlistPending(null);
      setWaitlistRecoveryState("idle");
      router.replace({
        pathname: "/community/decision/[id]" as never,
        params: { id: receipt.threadId } as never,
      });
    } catch (error) {
      if (await isViewerCurrent(ownerId, generation)) {
        setMutationError(toKoreanErrorMessage(
          error,
          "네트워크 응답을 받지 못했어요. 새 명령을 만들지 않고 같은 요청으로 다시 확인해 주세요.",
        ));
      }
    } finally {
      if (mutationSequenceRef.current === sequence) {
        mutationBusyRef.current = null;
        setMutationBusy(null);
      }
    }
  }, [
    isViewerCurrent,
    ownerId,
    questionId,
    waitlistPending,
    waitlistRetryRemainingSeconds,
  ]);

  const handleDeleteWaitlistRecovery = useCallback(() => {
    if (!ownerId || !waitlistPending || mutationBusyRef.current !== null) return;
    Alert.alert(
      "이 기기의 복구 명령을 삭제할까요?",
      "서버의 비공개 대기 질문은 철회되지 않아요. 삭제하면 같은 게시 요청을 이어갈 수 없고, 질문을 철회한 뒤 새로 작성해야 해요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "복구 명령 삭제",
          style: "destructive",
          onPress: () => {
            const sequence = mutationSequenceRef.current + 1;
            mutationSequenceRef.current = sequence;
            const generation = authGenerationRef.current;
            mutationBusyRef.current = "waitlist_recovery_delete";
            setMutationBusy("waitlist_recovery_delete");
            setMutationError(null);
            void clearCommunityDecisionPendingIfMatches(
              ownerId,
              waitlistPending.questionId,
              waitlistPending.operationKey,
            ).then(async (cleared) => {
              if (!(await isViewerCurrent(ownerId, generation))) return;
              if (!cleared) {
                setMutationError("삭제할 복구 명령이 이미 없거나 달라졌어요.");
                setWaitlistRecoveryState("missing");
                setWaitlistPending(null);
                return;
              }
              setWaitlistPending(null);
              setWaitlistRecoveryState("missing");
              setMutationNotice("이 기기의 복구 명령을 삭제했어요. 서버 대기 질문은 그대로예요.");
            }).catch(async () => {
              if (await isViewerCurrent(ownerId, generation)) {
                setMutationError("이 기기의 복구 명령 삭제를 확인하지 못했어요.");
              }
            }).finally(() => {
              if (mutationSequenceRef.current === sequence) {
                mutationBusyRef.current = null;
                setMutationBusy(null);
              }
            });
          },
        },
      ],
    );
  }, [isViewerCurrent, ownerId, waitlistPending]);

  const handlePublicationWithdraw = useCallback((outcomeId: string) => {
    if (!isCommunityDecisionUuid(outcomeId)) return;
    const publication = publicationLookups.get(outcomeId)?.status ?? null;
    if (!publication?.canWithdraw) {
      setMutationError("검수 대기 또는 공개 중인 결과만 공개 동의를 철회할 수 있어요.");
      return;
    }
    Alert.alert(
      "결과 공개 동의를 철회할까요?",
      "이 revision의 검수 대기·공개용 사본만 철회해요. 나만 보는 결과 기록은 삭제되지 않아요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "공개 동의 철회",
          style: "destructive",
          onPress: () => {
            const slot = `publication_withdraw:${outcomeId}`;
            void executeMutation({
              operation: "publication_withdraw",
              slot,
              path: `/api/community/decision-threads/${questionId}/outcomes/${outcomeId}/publication`,
              method: "DELETE",
              body: {},
              parse: (value) => {
                const receipt = parseCommunityDecisionPublicationWithdrawReceipt(value);
                return receipt?.threadId === questionId && receipt.outcomeId === outcomeId
                  ? receipt
                  : null;
              },
              receiptBelongsToCommand: (value, operationKey) => {
                const receipt = parseCommunityDecisionPublicationWithdrawReceipt(value);
                return receipt?.threadId === questionId
                  && receipt.outcomeId === outcomeId
                  && isCommunityDecisionReceiptForCommand(receipt, operationKey);
              },
              successMessage: "이 revision의 공개 동의 철회 영수증을 확인했어요. 비공개 결과 기록은 그대로예요.",
              reloadAfterSuccess: false,
            }).then((receipt) => {
              if (!receipt) return;
              setPublicationLookups((current) => {
                const next = new Map(current);
                next.set(outcomeId, {
                  state: "available",
                  status: {
                    outcomeId: receipt.outcomeId,
                    threadId: receipt.threadId,
                    revision: receipt.revision,
                    publicationState: "withdrawn",
                    canWithdraw: false,
                    updatedAt: receipt.withdrawnAt,
                  },
                });
                return next;
              });
            });
          },
        },
      ],
    );
  }, [executeMutation, publicationLookups, questionId]);

  const handleWithdraw = useCallback(async (options?: {
    reason?: string;
    rewriteAfter?: boolean;
  }) => {
    if (!detail || !ownerId) return;
    const isWaitlist = "status" in detail;
    const canWithdraw = detail.viewer.canWithdraw;
    if (!canWithdraw) return;
    if (isWaitlist && waitlistPending?.withdrawOperationKey) {
      await retryExactWaitlistCommand();
      return;
    }
    const reason = (options?.reason ?? withdrawReason).trim();
    if (reason.length < 3) return setMutationError("철회 이유를 3자 이상 적어주세요.");
    const expectedVersion = isWaitlist ? null : detail.thread.version;
    const receipt = await executeMutation({
      operation: "withdraw",
      slot: "withdraw",
      path: `/api/community/decision-threads/${questionId}/withdraw`,
      method: "POST",
      body: { expectedVersion, reason },
      parse: (value) => {
        const parsed = parseCommunityDecisionWithdrawReceipt(value);
        return parsed?.questionId === questionId ? parsed : null;
      },
      successMessage: "철회 영수증을 확인했어요.",
      reloadAfterSuccess: false,
    });
    if (!receipt) return;
    if (isWaitlist && waitlistPending) {
      try {
        await clearCommunityDecisionPendingIfMatches(
          ownerId,
          waitlistPending.questionId,
          waitlistPending.operationKey,
        );
        await clearCommunityDecisionDraft(ownerId).catch(() => undefined);
      } catch {
        setMutationError("철회는 확인했지만 이 기기의 복구 명령 삭제는 확인하지 못했어요. 로그아웃할 때 다시 정리해요.");
      }
      setWaitlistPending(null);
      setWaitlistRecoveryState("idle");
    }
    if (options?.rewriteAfter) {
      router.replace("/community/decision/write" as never);
      return;
    }
    setWithdrawalRecovered(true);
    Alert.alert(
      "철회 완료",
      isWaitlist
        ? "비공개 대기 요청을 철회했어요."
        : "공개 원문을 철회했어요. 과거 결정 기록은 원문 이용 불가 상태로만 남아요.",
      [{ text: "확인", onPress: () => router.back() }],
    );
  }, [
    detail,
    executeMutation,
    ownerId,
    questionId,
    retryExactWaitlistCommand,
    waitlistPending,
    withdrawReason,
  ]);

  const confirmWithdrawAndRewrite = useCallback(() => {
    Alert.alert(
      "대기 질문을 철회하고 새로 작성할까요?",
      "이 기기의 원래 게시 복구 명령이 없어 같은 요청은 이어갈 수 없어요. 서버의 비공개 대기 질문을 먼저 철회한 뒤 작성 화면으로 이동해요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "철회 후 새로 작성",
          style: "destructive",
          onPress: () => void handleWithdraw({
            reason: "기기 게시 복구 명령 만료 또는 삭제로 새 질문 작성",
            rewriteAfter: true,
          }),
        },
      ],
    );
  }, [handleWithdraw]);

  if (!sessionLoading && withdrawalRecovered) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="결정 질문" onBack={() => router.back()} />
        <EmptyState
          icon={<CheckCircle2 size={28} color={colors.success} />}
          title="철회가 확인됐어요"
          description="서버 철회 영수증을 확인했어요. 철회된 질문을 다시 불러온 실패 화면으로 이 확인 결과를 덮어쓰지 않아요."
          action={<PrimaryButton onPress={() => router.back()}>커뮤니티로 돌아가기</PrimaryButton>}
        />
        {mutationError ? (
          <View style={styles.terminalError} accessibilityRole="alert">
            <AppText variant="caption" style={styles.errorText}>{mutationError}</AppText>
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  if (sessionLoading || loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="결정 질문" onBack={() => router.back()} />
        <LoadingState label="질문과 사람 경험을 확인하고 있어요" />
      </SafeAreaView>
    );
  }

  if (failure === "auth") {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="결정 질문" onBack={() => router.back()} />
        <EmptyState
          icon={<LockKeyhole size={28} color={colors.noir[800]} />}
          title="로그인이 필요해요"
          description="적용성·비공개 결과가 다른 계정에 섞이지 않도록 로그인 뒤 다시 확인해요."
          action={<PrimaryButton onPress={() => router.push("/(auth)/login")}>로그인하기</PrimaryButton>}
        />
      </SafeAreaView>
    );
  }

  if (failure || !detail) {
    const unavailable = failure === "unavailable";
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="결정 질문" onBack={() => router.back()} />
        <EmptyState
          icon={<AlertCircle size={28} color={unavailable ? colors.textTertiary : colors.danger} />}
          title={unavailable ? "이 질문을 볼 수 없어요" : "불러오지 못했어요"}
          description={unavailable
            ? "철회·숨김·차단 또는 공개 범위 제한일 수 있어요. 네트워크 빈 화면으로 처리하지 않았어요."
            : failure === "contract"
              ? "서버 응답을 안전하게 확인하지 못해 일부 정보만 추측해 보여주지 않아요."
              : "네트워크 상태를 확인한 뒤 같은 질문을 다시 불러와 주세요."}
          action={unavailable ? undefined : (
            <PrimaryButton onPress={() => void loadThread(ownerId, authGenerationRef.current)}>
              다시 시도
            </PrimaryButton>
          )}
        />
      </SafeAreaView>
    );
  }

  if ("status" in detail) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="비공개 대기 질문" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
          <Surface tone="ivory" style={styles.waitlistSurface}>
            <Clock3 size={26} color={colors.noir[800]} />
            <StatusPill label="비공개 대기" tone="warning" />
            <AppText variant="subtitle">아직 다른 회원에게 공개되지 않았어요</AppText>
            <AppText variant="body">
              실제 경험자와 예비 응답자 공급이 확인된 뒤에만 게시할 수 있어요. 이 화면의 새로고침은 상태만 확인하며 공개를 가장하지 않아요.
            </AppText>
          </Surface>
          <Surface tone="ivory" style={styles.waitlistSurface}>
            <AppText variant="bodyStrong">이 기기의 안전한 재시도 상태</AppText>
            <AppText variant="caption">
              {waitlistRecoveryState === "loading"
                ? "암호화된 재시도 명령을 확인하고 있어요."
                : waitlistRecoveryState === "available"
                  ? waitlistRetryRemainingSeconds > 0
                    ? `${waitlistRetryRemainingSeconds}초 뒤 같은 요청으로 다시 확인할 수 있어요.`
                    : "원래 요청 식별자를 보관하고 있어 중복 없이 다시 확인할 수 있어요."
                  : waitlistRecoveryState === "missing"
                    ? "서버의 비공개 대기 상태가 기준이며, 이 기기에는 재시도 명령이 남아 있지 않아요."
                    : waitlistRecoveryState === "failed"
                      ? "기기 재시도 정보를 확인하지 못했어요. 새 요청을 만들지 말고 잠시 후 다시 열어주세요."
                      : "비공개 대기 상태를 확인했어요."}
            </AppText>
            {waitlistRecoveryState === "available" && waitlistPending ? (
              <>
                <AppText variant="caption">
                  작성 초안과 달리 이 exact 복구 명령은 이 기기의 잠금 저장소에 최대 {COMMUNITY_DECISION_WAITLIST_PENDING_MAX_AGE_DAYS}일 보관하고, 게시·철회 영수증 확인 또는 직접 삭제 때 지워요.
                </AppText>
                <PrimaryButton
                  onPress={() => void retryExactWaitlistCommand()}
                  disabled={mutationBusy !== null || (
                    !waitlistPending.withdrawOperationKey
                    && waitlistRetryRemainingSeconds > 0
                  )}
                  icon={mutationBusy === "waitlist_create_recovery"
                    || mutationBusy === "waitlist_withdraw_recovery"
                    ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <RefreshCw size={18} color="#FFFFFF" />}
                >
                  {waitlistPending.withdrawOperationKey
                    ? "같은 철회 요청 다시 확인"
                    : waitlistRetryRemainingSeconds > 0
                      ? `${waitlistRetryRemainingSeconds}초 뒤 같은 게시 요청 확인`
                      : "같은 게시 요청 다시 확인"}
                </PrimaryButton>
                <Pressable
                  onPress={handleDeleteWaitlistRecovery}
                  disabled={mutationBusy !== null}
                  accessibilityRole="button"
                  accessibilityLabel="이 기기의 게시 복구 명령 삭제"
                  accessibilityState={{ disabled: mutationBusy !== null }}
                  style={({ pressed }) => [
                    styles.recoveryDelete,
                    mutationBusy !== null && styles.disabled,
                    pressed && mutationBusy === null && styles.pressed,
                  ]}
                >
                  <Trash2 size={17} color={colors.danger} />
                  <AppText variant="caption" style={styles.withdrawButtonText}>이 기기의 복구 명령 삭제</AppText>
                </Pressable>
              </>
            ) : waitlistRecoveryState === "missing" ? (
              <PrimaryButton
                tone="ghost"
                onPress={confirmWithdrawAndRewrite}
                disabled={mutationBusy !== null}
              >
                대기 질문 철회 후 새로 작성
              </PrimaryButton>
            ) : waitlistRecoveryState === "failed" ? (
              <PrimaryButton
                tone="ghost"
                onPress={() => setRecoveryCycle((current) => current + 1)}
                disabled={mutationBusy !== null}
              >
                기기 복구 상태 다시 확인
              </PrimaryButton>
            ) : null}
          </Surface>
          <View style={styles.questionSection}>
            <AppText variant="title">{detail.intake.title}</AppText>
            <AppText variant="body">{detail.intake.content}</AppText>
            <View style={styles.contextLine}>
              <AppText variant="caption">{SCOPE_COPY[detail.intake.experienceScope]}</AppText>
              <AppText variant="caption">·</AppText>
              <AppText variant="caption">{STAGE_COPY[detail.intake.preparationStage]}</AppText>
              <AppText variant="caption">·</AppText>
              <AppText variant="caption">{PHASE_COPY[detail.intake.contractPhase]}</AppText>
            </View>
            <StructuredLine label="원하는 사람 답변" value={detail.intake.desiredAnswer} />
          </View>
          {mutationNotice ? (
            <View style={styles.noticeBanner} accessibilityRole="alert">
              <CheckCircle2 size={18} color={colors.success} />
              <AppText variant="caption" style={styles.flexOne}>{mutationNotice}</AppText>
            </View>
          ) : null}
          {mutationError ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <AlertCircle size={18} color={colors.danger} />
              <AppText variant="caption" style={styles.errorText}>{mutationError}</AppText>
            </View>
          ) : null}
          <PrimaryButton
            tone="ghost"
            onPress={() => void loadThread(ownerId, authGenerationRef.current)}
            icon={<RefreshCw size={18} color={colors.noir[800]} />}
          >
            대기 상태 새로고침
          </PrimaryButton>
          {!waitlistPending?.withdrawOperationKey ? (
          <View style={styles.withdrawArea}>
            <Pressable
              onPress={() => setShowWithdraw((current) => !current)}
              disabled={mutationBusy !== null}
              accessibilityRole="button"
              accessibilityState={{ expanded: showWithdraw, disabled: mutationBusy !== null }}
              style={({ pressed }) => [
                styles.withdrawToggle,
                mutationBusy !== null && styles.disabled,
                pressed && mutationBusy === null && styles.pressed,
              ]}
            >
              <AppText variant="caption" style={styles.withdrawLink}>비공개 대기 요청 철회</AppText>
            </Pressable>
            {showWithdraw ? (
              <>
                <TextInput value={withdrawReason} onChangeText={setWithdrawReason} editable={mutationBusy === null} maxLength={500} placeholder="철회 이유" placeholderTextColor={colors.textTertiary} style={styles.input} />
                <Pressable
                  onPress={() => void handleWithdraw()}
                  disabled={mutationBusy !== null}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: mutationBusy !== null }}
                  style={({ pressed }) => [
                    styles.withdrawButton,
                    mutationBusy !== null && styles.disabled,
                    pressed && mutationBusy === null && styles.pressed,
                  ]}
                >
                  <Trash2 size={17} color={colors.danger} />
                  <AppText variant="bodyStrong" style={styles.withdrawButtonText}>
                    {mutationBusy === "withdraw" || mutationBusy === "waitlist_withdraw_recovery"
                      ? "철회 확인 중"
                      : "요청 철회하기"}
                  </AppText>
                </Pressable>
              </>
            ) : null}
          </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const stateCopy = STATE_COPY[detail.thread.state];
  const visibleSelections = detail.viewer.selection.filter((selection) => (
    detail.answers.some((answer) => answer.id === selection.answerId)
  ));

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader title="결정 질문" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.questionSection}>
          <View style={styles.questionMeta}>
            <StatusPill label={stateCopy.label} tone={stateCopy.tone} />
            <AppText variant="caption">
              {detail.post ? POST_ORIGIN_COPY[detail.post.contentOrigin] : "원문 이용 불가"}
            </AppText>
          </View>
          <AppText variant="title">{detail.post?.title ?? "원문 이용 불가"}</AppText>
          {detail.post ? <AppText variant="body">{detail.post.content}</AppText> : (
            <AppText variant="body">공개 원문은 철회되었고 새 적용은 차단됐어요.</AppText>
          )}
          <View style={styles.contextLine}>
            <AppText variant="caption">{SCOPE_COPY[detail.thread.experienceScope]}</AppText>
            <AppText variant="caption">·</AppText>
            <AppText variant="caption">{STAGE_COPY[detail.thread.preparationStage]}</AppText>
            <AppText variant="caption">·</AppText>
            <AppText variant="caption">{PHASE_COPY[detail.thread.contractPhase]}</AppText>
            {detail.thread.coarseRegion ? (
              <><AppText variant="caption">·</AppText><AppText variant="caption">{detail.thread.coarseRegion}</AppText></>
            ) : null}
          </View>
          <StructuredLine label="원하는 사람 답변" value={detail.thread.desiredAnswer} />
          {detail.post ? (
            <View style={styles.disclosureLine}>
              <AppText variant="caption" style={styles.disclosureLabel}>작성 관계</AppText>
              <AppText variant="caption">
                {RELATIONSHIP_COPY[detail.post.commercialRelationship]}
                {detail.post.sponsorshipDetail ? ` · ${detail.post.sponsorshipDetail}` : ""}
              </AppText>
            </View>
          ) : null}
        </View>

        {detail.thread.sourceUnavailableAt ? (
          <Surface tone="ivory" style={styles.sourceUnavailableNote}>
            <AlertCircle size={20} color={colors.danger} />
            <View style={styles.flexOne}>
              <AppText variant="bodyStrong">사용했던 출처를 더 이상 확인할 수 없어요</AppText>
              <AppText variant="caption">
                원문·선택 답변의 철회, 숨김, 계정 상태 변경 등으로 새 적용이 차단됐어요. 과거 다음 행동은 기록으로만 확인해 주세요.
              </AppText>
            </View>
          </Surface>
        ) : null}

        <Surface tone="ivory" style={styles.trustNote}>
          <ShieldCheck size={20} color={colors.noir[800]} />
          <AppText variant="caption" style={styles.flexOne}>
            회원과 업계 종사자가 직접 경험으로 표시한 답변을 구분해 보여줘요. AI·운영 안내·업체 공식 답변은 사람 답변 상태를 만들지 않아요.
          </AppText>
        </Surface>

        {!detail.viewer.isAuthor ? (
          <Surface tone="ivory" style={styles.formSection}>
            <AppText variant="subtitle">작성자가 돌아와 남긴 결과</AppText>
            <AppText variant="caption">
              작성자가 공개에 동의하고 사람 검토를 거친 결과만 보여요. 비공개 결과로 대신하지 않아요.
            </AppText>
            {publicOutcomeState === "loading" ? (
              <ActivityIndicator size="small" color={colors.noir[800]} />
            ) : publicOutcomeState === "available" && publicOutcome ? (
              <>
                <AppText variant="bodyStrong">{publicOutcome.resultSummary}</AppText>
                <AppText variant="body">실제로 한 일 · {publicOutcome.actionTaken}</AppText>
                <AppText variant="caption">적용 조건 · {publicOutcome.applicableConditions}</AppText>
                <AppText variant="caption">
                  업체·혜택 관계 · {RELATIONSHIP_COPY[publicOutcome.commercialRelationship]}
                  {publicOutcome.sponsorshipDetail ? ` · ${publicOutcome.sponsorshipDetail}` : ""}
                </AppText>
              </>
            ) : publicOutcomeState === "empty" ? (
              <AppText variant="caption">현재 검토되어 공개된 결과는 없어요.</AppText>
            ) : publicOutcomeState === "unavailable" ? (
              <AppText variant="caption">공개 결과를 지금 확인하지 못했어요. 비공개 결과로 대신하지 않아요.</AppText>
            ) : null}
          </Surface>
        ) : null}

        <View style={styles.sectionTitleRow}>
          <View style={styles.flexOne}>
            <AppText variant="subtitle">사람 답변</AppText>
            <AppText variant="caption">시점·행동·결과·관계를 답변마다 확인해요.</AppText>
          </View>
          <UserRound size={20} color={colors.noir[800]} />
        </View>

        {detail.answers.length === 0 ? (
          <EmptyState
            icon={<Users size={28} color={colors.textTertiary} />}
            title={detail.thread.sourceUnavailableAt
              ? "답변 출처가 철회되었거나 이용할 수 없어요"
              : "아직 사람 답변을 기다리고 있어요"}
            description={detail.thread.sourceUnavailableAt
              ? "이 질문은 새 답변을 기다리는 상태가 아니에요. 출처 철회·숨김·계정 상태 변경으로 기존 답변을 더 이상 사용할 수 없어요."
              : "네트워크 오류가 아니라 현재 보이는 사람 답변이 없는 상태예요."}
          />
        ) : detail.answers.map((answer) => (
          <AnswerCard
            key={answer.id}
            answer={answer}
            applicability={selectionByAnswer.get(answer.id) ?? null}
            canSetApplicability={detail.viewer.canResolve}
            canInclude={detail.viewer.canResolve}
            isIncluded={resolutionAnswerIds.includes(answer.id)}
            includedInResolution={includedInResolutionAnswerIds.has(answer.id)}
            busy={mutationBusy !== null}
            onApplicability={handleApplicability}
            onToggleInclude={(answerId) => setResolutionAnswerIds((current) => (
              current.includes(answerId)
                ? current.filter((idValue) => idValue !== answerId)
                : [...current, answerId]
            ))}
          />
        ))}

        {detail.viewer.canAnswer ? (
          <AnswerComposer busy={mutationBusy === "answer"} onSubmit={handleAnswer} />
        ) : null}

        {detail.viewer.canResolve ? (
          <View style={styles.formSection}>
            <AppText variant="subtitle">다음 행동 정하기</AppText>
            <AppText variant="caption">
              적용성을 먼저 답변별로 표시한 뒤, 현재 보이는 답변만 골라 다음 행동의 근거로 사용해요.
            </AppText>
            {visibleSelections.length === 0 ? (
              <AppText variant="body">먼저 답변 하나의 적용성을 표시해 주세요.</AppText>
            ) : null}
            <TextInput value={nextAction} onChangeText={setNextAction} editable={mutationBusy === null} maxLength={1000} placeholder="실제로 확인하거나 선택할 다음 행동" placeholderTextColor={colors.textTertiary} style={styles.input} />
            <TextInput value={resolutionReason} onChangeText={setResolutionReason} editable={mutationBusy === null} maxLength={500} placeholder="이 행동을 정한 이유" placeholderTextColor={colors.textTertiary} style={styles.input} />
            <PrimaryButton onPress={handleResolve} disabled={mutationBusy !== null || resolutionAnswerIds.length === 0} icon={mutationBusy === "resolve" ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}>
              {mutationBusy === "resolve" ? "다음 행동 확인 중" : "다음 행동 확정"}
            </PrimaryButton>
            <AppText variant="caption">이 단계는 커뮤니티 질문을 해결 상태로 옮길 뿐, 예산·일정 실행이나 커플의 확정 결정은 아니에요.</AppText>
          </View>
        ) : detail.thread.nextAction ? (
          <Surface tone="ivory" style={styles.nextActionSurface}>
            <CheckCircle2 size={22} color={colors.success} />
            <View style={styles.flexOne}>
              <AppText variant="caption">질문자가 정한 다음 행동</AppText>
              <AppText variant="bodyStrong">{detail.thread.nextAction}</AppText>
            </View>
          </Surface>
        ) : null}

        {detail.viewer.canRecordOutcome ? (
          <OutcomeComposer
            detail={detail}
            busy={mutationBusy === "outcome"}
            mutationBusy={mutationBusy !== null}
            publicationLookups={publicationLookups}
            onSubmit={handleOutcome}
            onWithdrawPublication={handlePublicationWithdraw}
          />
        ) : null}

        {mutationNotice ? (
          <View style={styles.noticeBanner} accessibilityRole="alert">
            <CheckCircle2 size={18} color={colors.success} />
            <AppText variant="caption" style={styles.flexOne}>{mutationNotice}</AppText>
          </View>
        ) : null}
        {mutationError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <AlertCircle size={18} color={colors.danger} />
            <AppText variant="caption" style={styles.errorText}>{mutationError}</AppText>
          </View>
        ) : null}

        {detail.viewer.canWithdraw ? (
          <View style={styles.withdrawArea}>
            <Pressable
              onPress={() => setShowWithdraw((current) => !current)}
              disabled={mutationBusy !== null}
              accessibilityRole="button"
              accessibilityState={{ expanded: showWithdraw, disabled: mutationBusy !== null }}
              style={({ pressed }) => [
                styles.withdrawToggle,
                mutationBusy !== null && styles.disabled,
                pressed && mutationBusy === null && styles.pressed,
              ]}
            >
              <AppText variant="caption" style={styles.withdrawLink}>공개 원문 철회</AppText>
            </Pressable>
            {showWithdraw ? (
              <>
                <AppText variant="caption">철회 뒤 원문은 공개되지 않고 새 적용이 차단돼요. 다른 커플의 과거 결정에는 원문 이용 불가 상태만 남을 수 있어요.</AppText>
                <TextInput value={withdrawReason} onChangeText={setWithdrawReason} editable={mutationBusy === null} maxLength={500} placeholder="철회 이유" placeholderTextColor={colors.textTertiary} style={styles.input} />
                <Pressable
                  onPress={() => void handleWithdraw()}
                  disabled={mutationBusy !== null}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: mutationBusy !== null }}
                  style={({ pressed }) => [
                    styles.withdrawButton,
                    mutationBusy !== null && styles.disabled,
                    pressed && mutationBusy === null && styles.pressed,
                  ]}
                >
                  <Trash2 size={17} color={colors.danger} />
                  <AppText variant="bodyStrong" style={styles.withdrawButtonText}>
                    {mutationBusy === "withdraw" ? "철회 확인 중" : "원문 철회하기"}
                  </AppText>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing[5], paddingBottom: spacing[12], gap: spacing[5] },
  flexOne: { flex: 1 },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.78 },
  questionSection: { gap: spacing[3] },
  questionMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  contextLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[1] },
  trustNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  sourceUnavailableNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  sectionTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  answerCard: { gap: spacing[4] },
  answerTrustRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing[3] },
  answerIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing[2] },
  answerContent: { color: colors.noir[800] },
  resolutionEvidenceLine: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingVertical: spacing[2], paddingHorizontal: spacing[3], borderRadius: radius.md, backgroundColor: "rgba(109, 128, 110, 0.12)" },
  structuredBlock: { borderTopWidth: 1, borderTopColor: colors.border },
  structuredLine: { gap: spacing[1], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.border },
  structuredLabel: { color: colors.textTertiary },
  structuredValue: { color: colors.noir[800] },
  disclosureLine: { gap: spacing[1] },
  disclosureLabel: { color: colors.textTertiary },
  applicabilityBlock: { gap: spacing[3], borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing[4] },
  choiceBlock: { gap: spacing[2] },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  choice: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing[1], paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.rose[500], backgroundColor: colors.rose.glow },
  choiceText: { color: colors.textSecondary },
  choiceTextSelected: { color: colors.rose[600] },
  includeRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing[2], paddingVertical: spacing[1] },
  composerIntro: { gap: spacing[4] },
  composerIntroText: { gap: spacing[1] },
  formSection: { gap: spacing[3], paddingTop: spacing[2] },
  checkRow: { minHeight: 44, flexDirection: "row", alignItems: "flex-start", gap: spacing[3], paddingVertical: spacing[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, backgroundColor: colors.surface, paddingHorizontal: spacing[4], paddingVertical: spacing[3], color: colors.noir[800], fontFamily: "NotoSansKR_400Regular", fontSize: 15, lineHeight: 23 },
  multilineInput: { minHeight: 132, textAlignVertical: "top" },
  outcomeRow: { gap: spacing[1], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.border },
  outcomePublicationWithdraw: { minHeight: 44, alignSelf: "flex-start", alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[2], paddingVertical: spacing[2] },
  nextActionSurface: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  noticeBanner: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], padding: spacing[3], borderRadius: radius.lg, backgroundColor: "rgba(109, 128, 110, 0.12)" },
  errorBanner: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], padding: spacing[3], borderRadius: radius.lg, backgroundColor: "rgba(217, 95, 95, 0.08)", borderWidth: 1, borderColor: "rgba(217, 95, 95, 0.24)" },
  errorText: { flex: 1, color: colors.danger },
  terminalError: { marginHorizontal: spacing[5], padding: spacing[3] },
  waitlistSurface: { alignItems: "flex-start", gap: spacing[3] },
  recoveryDelete: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "stretch", gap: spacing[2], paddingHorizontal: spacing[3] },
  withdrawArea: { alignItems: "stretch", gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.border },
  withdrawToggle: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  withdrawLink: { textAlign: "center", color: colors.danger, textDecorationLine: "underline" },
  withdrawButton: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], borderWidth: 1, borderColor: colors.danger, borderRadius: radius.xl },
  withdrawButtonText: { color: colors.danger },
});
