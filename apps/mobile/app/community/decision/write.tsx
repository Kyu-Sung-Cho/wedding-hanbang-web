import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toKoreanErrorMessage } from "@/lib/errorCopy";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { TextInput } from "@/components/ui/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { AlertCircle, Check, Clock3, LockKeyhole, Users } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  isCommunityDecisionCreateReceiptForSubmission,
  parseCommunityDecisionCreateReceipt,
  parseCommunityDecisionWithdrawReceipt,
  parseRetryAfterSeconds,
  readCommunityDecisionApiError,
  type CommunityDecisionDraft,
} from "@/lib/communityDecisionThread.mjs";
import {
  clearCommunityDecisionDraft,
  clearCommunityDecisionPending,
  loadCommunityDecisionDraft,
  loadCommunityDecisionPending,
  saveCommunityDecisionDraft,
  saveCommunityDecisionPending,
  type CommunityDecisionPendingSubmission,
} from "@/lib/communityDecisionPending";
import {
  AppHeader,
  AppText,
  EmptyState,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";

type ExperienceScope =
  | "contract_terms"
  | "extra_charge"
  | "vendor_response"
  | "cancellation_refund";
type PreparationStage =
  | "vendor_search"
  | "contract_review"
  | "contracted"
  | "dispute_or_cancellation";
type ContractPhase =
  | "before_contract"
  | "after_contract"
  | "cancellation_or_refund";
type CommercialRelationship =
  | "none"
  | "gift"
  | "discount"
  | "refund"
  | "affiliate"
  | "paid"
  | "employee"
  | "owner_or_family"
  | "platform_research_compensation";

const EXPERIENCE_SCOPES: ReadonlyArray<{ value: ExperienceScope; label: string }> = [
  { value: "contract_terms", label: "계약 문구" },
  { value: "extra_charge", label: "추가금" },
  { value: "vendor_response", label: "업체 응대" },
  { value: "cancellation_refund", label: "취소·환불" },
];
const PREPARATION_STAGES: ReadonlyArray<{ value: PreparationStage; label: string }> = [
  { value: "vendor_search", label: "업체 찾는 중" },
  { value: "contract_review", label: "계약 검토 중" },
  { value: "contracted", label: "계약 완료" },
  { value: "dispute_or_cancellation", label: "분쟁·취소 중" },
];
const CONTRACT_PHASES: ReadonlyArray<{ value: ContractPhase; label: string }> = [
  { value: "before_contract", label: "계약 전" },
  { value: "after_contract", label: "계약 후" },
  { value: "cancellation_or_refund", label: "취소·환불" },
];
const RELATIONSHIPS: ReadonlyArray<{ value: CommercialRelationship; label: string }> = [
  { value: "none", label: "관계·혜택 없음" },
  { value: "gift", label: "제품·서비스 제공" },
  { value: "discount", label: "할인" },
  { value: "refund", label: "환급" },
  { value: "affiliate", label: "제휴" },
  { value: "paid", label: "원고료·대가" },
  { value: "employee", label: "업계 종사자" },
  { value: "owner_or_family", label: "업체 소유자·가족" },
  { value: "platform_research_compensation", label: "플랫폼 조사 보상" },
];

type CreateBody = {
  questionId: string;
  title: string;
  content: string;
  topicCategory: "contract_extra_cost";
  experienceScope: ExperienceScope;
  coarseRegion: string | null;
  preparationStage: PreparationStage;
  contractPhase: ContractPhase;
  desiredAnswer: string;
  commercialRelationship: CommercialRelationship;
  sponsorshipDetail: string | null;
};

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
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
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && styles.pressed,
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

function getPendingTitle(pending: CommunityDecisionPendingSubmission) {
  try {
    const parsed = JSON.parse(pending.bodyText) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : null;
  } catch {
    return null;
  }
}

export default function DecisionThreadWriteScreen() {
  const [sessionLoading, setSessionLoading] = useState(true);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [pending, setPending] = useState<CommunityDecisionPendingSubmission | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);

  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [experienceScope, setExperienceScope] = useState<ExperienceScope | null>(null);
  const [preparationStage, setPreparationStage] = useState<PreparationStage | null>(null);
  const [contractPhase, setContractPhase] = useState<ContractPhase | null>(null);
  const [coarseRegion, setCoarseRegion] = useState("");
  const [desiredAnswer, setDesiredAnswer] = useState("");
  const [commercialRelationship, setCommercialRelationship] =
    useState<CommercialRelationship>("none");
  const [sponsorshipDetail, setSponsorshipDetail] = useState("");

  const identitySequenceRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const authInitializedRef = useRef(false);
  const currentOwnerRef = useRef<string | null>(null);
  const submitPreparationLockRef = useRef<symbol | null>(null);
  const submitRequestLockRef = useRef<symbol | null>(null);
  const withdrawLockRef = useRef<symbol | null>(null);

  const resetEditableForm = useCallback(() => {
    setContent("");
    setTitle("");
    setExperienceScope(null);
    setPreparationStage(null);
    setContractPhase(null);
    setCoarseRegion("");
    setDesiredAnswer("");
    setCommercialRelationship("none");
    setSponsorshipDetail("");
  }, []);

  const applyDraft = useCallback((draft: CommunityDecisionDraft) => {
    setContent(draft.content);
    setTitle(draft.title);
    setExperienceScope(draft.experienceScope);
    setPreparationStage(draft.preparationStage);
    setContractPhase(draft.contractPhase);
    setCoarseRegion(draft.coarseRegion);
    setDesiredAnswer(draft.desiredAnswer);
    setCommercialRelationship(draft.commercialRelationship);
    setSponsorshipDetail(draft.sponsorshipDetail);
  }, []);

  const isOwnerCurrent = useCallback(async (expectedOwnerId: string, sequence: number) => {
    if (requestSequenceRef.current !== sequence) return false;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id.toLowerCase() === expectedOwnerId.toLowerCase()
      && requestSequenceRef.current === sequence;
  }, []);

  const hydrateForOwner = useCallback(async (nextOwnerId: string | null) => {
    const normalizedOwnerId = nextOwnerId?.toLowerCase() ?? null;
    if (authInitializedRef.current && currentOwnerRef.current === normalizedOwnerId) return;
    authInitializedRef.current = true;
    currentOwnerRef.current = normalizedOwnerId;
    const identitySequence = identitySequenceRef.current + 1;
    identitySequenceRef.current = identitySequence;
    requestSequenceRef.current += 1;
    submitPreparationLockRef.current = null;
    submitRequestLockRef.current = null;
    withdrawLockRef.current = null;
    setOwnerId(nextOwnerId);
    setPending(null);
    setRequestError(null);
    setDraftSaveError(null);
    setDraftHydrated(false);
    setSubmitting(false);
    setShowWithdraw(false);
    setWithdrawReason("");
    setWithdrawSubmitting(false);
    resetEditableForm();

    if (!nextOwnerId) {
      setSessionLoading(false);
      return;
    }

    setSessionLoading(true);
    try {
      const [recovered, recoveredDraft] = await Promise.all([
        loadCommunityDecisionPending(nextOwnerId),
        loadCommunityDecisionDraft(nextOwnerId),
      ]);
      const { data } = await supabase.auth.getSession();
      if (
        identitySequenceRef.current !== identitySequence
        || data.session?.user.id.toLowerCase() !== nextOwnerId.toLowerCase()
      ) return;
      setPending(recovered);
      if (recovered?.withdrawBodyText) {
        try {
          const withdrawBody = JSON.parse(recovered.withdrawBodyText) as { reason?: unknown };
          if (typeof withdrawBody.reason === "string") setWithdrawReason(withdrawBody.reason);
          setShowWithdraw(true);
        } catch {
          // The encrypted pending boundary rejects malformed bodies.
        }
      }
      if (!recovered && recoveredDraft) applyDraft(recoveredDraft);
      setDraftHydrated(true);
    } catch {
      if (identitySequenceRef.current === identitySequence) {
        setRequestError("안전하게 보관한 요청 상태를 확인하지 못했어요.");
      }
    } finally {
      if (identitySequenceRef.current === identitySequence) setSessionLoading(false);
    }
  }, [applyDraft, resetEditableForm]);

  useEffect(() => {
    if (!ownerId || !draftHydrated || pending) return;
    const identitySequence = identitySequenceRef.current;
    const hasDraftValue = Boolean(
      content
      || title
      || experienceScope
      || preparationStage
      || contractPhase
      || coarseRegion
      || desiredAnswer
      || commercialRelationship !== "none"
      || sponsorshipDetail,
    );
    const timer = setTimeout(() => {
      const operation = hasDraftValue
        ? saveCommunityDecisionDraft({
          ownerId,
          updatedAt: Date.now(),
          content,
          title,
          experienceScope,
          preparationStage,
          contractPhase,
          coarseRegion,
          desiredAnswer,
          commercialRelationship,
          sponsorshipDetail,
        })
        : clearCommunityDecisionDraft(ownerId);
      void operation.then(() => {
        if (identitySequenceRef.current === identitySequence) setDraftSaveError(null);
      }).catch(() => {
        if (identitySequenceRef.current === identitySequence) {
          setDraftSaveError("임시저장을 안전하게 보관하지 못했어요. 이 화면을 나가기 전에 다시 확인해 주세요.");
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [
    coarseRegion,
    commercialRelationship,
    content,
    contractPhase,
    desiredAnswer,
    draftHydrated,
    experienceScope,
    ownerId,
    pending,
    preparationStage,
    sponsorshipDetail,
    title,
  ]);

  useEffect(() => {
    let disposed = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!disposed) void hydrateForOwner(data.session?.user.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!disposed) void hydrateForOwner(session?.user.id ?? null);
    });
    return () => {
      disposed = true;
      identitySequenceRef.current += 1;
      requestSequenceRef.current += 1;
      subscription.unsubscribe();
    };
  }, [hydrateForOwner]);

  useEffect(() => {
    if (!pending?.retryAt || pending.retryAt <= clockNow) return;
    const timer = setInterval(() => setClockNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [clockNow, pending?.retryAt]);

  const retryRemainingSeconds = pending?.retryAt
    ? Math.max(0, Math.ceil((pending.retryAt - clockNow) / 1_000))
    : 0;
  const retryRemainingLabel = useMemo(() => {
    if (retryRemainingSeconds <= 0) return null;
    const minutes = Math.floor(retryRemainingSeconds / 60);
    const seconds = retryRemainingSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")} 뒤 확인 가능`;
  }, [retryRemainingSeconds]);

  const restoreEditableBody = useCallback((bodyText: string) => {
    try {
      const body = JSON.parse(bodyText) as CreateBody;
      setContent(body.content);
      setTitle(body.title);
      setExperienceScope(body.experienceScope);
      setPreparationStage(body.preparationStage);
      setContractPhase(body.contractPhase);
      setCoarseRegion(body.coarseRegion ?? "");
      setDesiredAnswer(body.desiredAnswer);
      setCommercialRelationship(body.commercialRelationship);
      setSponsorshipDetail(body.sponsorshipDetail ?? "");
    } catch {
      // Corrupt pending bodies are already rejected by the storage boundary.
    }
  }, []);

  const submitExactPending = useCallback(async (
    submission: CommunityDecisionPendingSubmission,
  ) => {
    if (
      submitRequestLockRef.current !== null
      || submission.withdrawOperationKey
      || retryRemainingSeconds > 0
    ) return;
    const requestLock = Symbol("community-decision-submit");
    submitRequestLockRef.current = requestLock;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setSubmitting(true);
    setRequestError(null);

    try {
      const response = await apiFetchForExpectedUser(
        submission.ownerId,
        "/api/community/decision-threads",
        {
          method: "POST",
          headers: { "Idempotency-Key": submission.operationKey },
          body: submission.bodyText,
        },
      );
      const responseBody = await response.json().catch(() => null) as unknown;
      if (!(await isOwnerCurrent(submission.ownerId, sequence))) return;

      if (!response.ok) {
        const message = readCommunityDecisionApiError(
          responseBody,
          "질문 요청을 안전하게 확인하지 못했어요.",
        );
        if (response.status >= 500 || response.status === 409 || response.status === 429) {
          setRequestError(message);
          return;
        }

        await clearCommunityDecisionPending(submission.ownerId);
        if (!(await isOwnerCurrent(submission.ownerId, sequence))) return;
        restoreEditableBody(submission.bodyText);
        setPending(null);
        setRequestError(message);
        return;
      }

      const receipt = parseCommunityDecisionCreateReceipt(responseBody, response.status);
      if (!receipt || !isCommunityDecisionCreateReceiptForSubmission(
        receipt,
        submission.questionId,
        submission.operationKey,
        submission.commandId,
      )) {
        setRequestError("서버의 게시 상태를 확인하지 못했어요. 새 요청을 만들지 않고 다시 확인해 주세요.");
        return;
      }

      if (receipt.kind === "private_waitlist") {
        const retryAfter = parseRetryAfterSeconds(response.headers.get("Retry-After"));
        const nextPending: CommunityDecisionPendingSubmission = {
          ...submission,
          phase: "private_waitlist",
          commandId: receipt.commandId,
          retryAt: retryAfter ? Date.now() + retryAfter * 1_000 : null,
        };
        await saveCommunityDecisionPending(nextPending);
        if (!(await isOwnerCurrent(submission.ownerId, sequence))) return;
        setClockNow(Date.now());
        setPending(nextPending);
        return;
      }

      await Promise.all([
        clearCommunityDecisionPending(submission.ownerId),
        clearCommunityDecisionDraft(submission.ownerId),
      ]);
      if (!(await isOwnerCurrent(submission.ownerId, sequence))) return;
      setDraftHydrated(false);
      setPending(null);
      router.replace({
        pathname: "/community/decision/[id]" as never,
        params: { id: receipt.threadId } as never,
      });
    } catch (error) {
      if (await isOwnerCurrent(submission.ownerId, sequence)) {
        // RN 의 fetch 실패는 "Network request failed" 라 브라우저 문구와
        // 비교하면 절대 걸리지 않고 영어 원문이 화면에 남는다.
        setRequestError(toKoreanErrorMessage(
          error,
          "네트워크 응답을 받지 못했어요. 같은 요청으로 게시 상태를 다시 확인해 주세요.",
        ));
      }
    } finally {
      if (requestSequenceRef.current === sequence) setSubmitting(false);
      if (submitRequestLockRef.current === requestLock) {
        submitRequestLockRef.current = null;
      }
    }
  }, [isOwnerCurrent, restoreEditableBody, retryRemainingSeconds]);

  const handleWithdrawWaitlist = useCallback(async () => {
    if (
      !pending
      || !ownerId
      || pending.phase !== "private_waitlist"
      || withdrawLockRef.current !== null
    ) return;
    const withdrawLock = Symbol("community-decision-withdraw");
    withdrawLockRef.current = withdrawLock;
    try {
    let withdrawal = pending;
    if (!withdrawal.withdrawOperationKey || !withdrawal.withdrawBodyText) {
      const reason = withdrawReason.trim();
      if (reason.length < 3) {
        setRequestError("철회 이유를 3자 이상 적어주세요.");
        return;
      }
      withdrawal = {
        ...withdrawal,
        withdrawOperationKey: Crypto.randomUUID(),
        withdrawBodyText: JSON.stringify({ expectedVersion: null, reason }),
      };
      try {
        await saveCommunityDecisionPending(withdrawal);
        const { data } = await supabase.auth.getSession();
        if (data.session?.user.id.toLowerCase() !== ownerId.toLowerCase()) return;
        setPending(withdrawal);
      } catch {
        setRequestError("철회를 안전하게 재시도할 정보를 보관하지 못해 요청을 보내지 않았어요.");
        return;
      }
    }

    const operationKey = withdrawal.withdrawOperationKey;
    const bodyText = withdrawal.withdrawBodyText;
    if (!operationKey || !bodyText) return;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setWithdrawSubmitting(true);
    setRequestError(null);
    try {
      const response = await apiFetchForExpectedUser(
        ownerId,
        `/api/community/decision-threads/${withdrawal.questionId}/withdraw`,
        {
          method: "POST",
          headers: { "Idempotency-Key": operationKey },
          body: bodyText,
        },
      );
      const responseBody = await response.json().catch(() => null) as unknown;
      if (!(await isOwnerCurrent(ownerId, sequence))) return;
      if (!response.ok) {
        setRequestError(readCommunityDecisionApiError(
          responseBody,
          "비공개 대기 요청의 철회 상태를 확인하지 못했어요.",
        ));
        return;
      }
      const receipt = parseCommunityDecisionWithdrawReceipt(responseBody);
      if (
        !receipt
        || receipt.questionId !== withdrawal.questionId
        || receipt.threadId !== null
      ) {
        setRequestError("철회 영수증을 확인하지 못했어요. 요청 상태는 지우지 않고 다시 확인합니다.");
        return;
      }
      await Promise.all([
        clearCommunityDecisionPending(ownerId),
        clearCommunityDecisionDraft(ownerId),
      ]);
      if (!(await isOwnerCurrent(ownerId, sequence))) return;
      setDraftHydrated(false);
      setPending(null);
      resetEditableForm();
      Alert.alert("철회 완료", "비공개 대기 요청을 철회했어요.", [
        { text: "확인", onPress: () => router.back() },
      ]);
    } catch (error) {
      if (await isOwnerCurrent(ownerId, sequence)) {
        setRequestError(toKoreanErrorMessage(
          error,
          "네트워크 응답을 받지 못했어요. 같은 철회 요청으로 다시 확인해 주세요.",
        ));
      }
    } finally {
      if (requestSequenceRef.current === sequence) setWithdrawSubmitting(false);
    }
    } finally {
      if (withdrawLockRef.current === withdrawLock) withdrawLockRef.current = null;
    }
  }, [
    isOwnerCurrent,
    ownerId,
    pending,
    resetEditableForm,
    withdrawReason,
    withdrawSubmitting,
  ]);

  const handleDeleteDraft = useCallback(() => {
    if (!ownerId || pending) return;
    Alert.alert(
      "임시저장을 삭제할까요?",
      "이 기기에 보관한 현재 질문 내용을 되돌릴 수 없게 삭제해요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => {
            const identitySequence = identitySequenceRef.current;
            setDraftHydrated(false);
            void clearCommunityDecisionDraft(ownerId).then(async () => {
              const { data } = await supabase.auth.getSession();
              if (
                identitySequenceRef.current !== identitySequence
                || data.session?.user.id.toLowerCase() !== ownerId.toLowerCase()
              ) return;
              resetEditableForm();
              setDraftSaveError(null);
              setDraftHydrated(true);
            }).catch(() => {
              if (identitySequenceRef.current === identitySequence) {
                setDraftSaveError("임시저장을 삭제하지 못했어요. 다시 시도해 주세요.");
                setDraftHydrated(true);
              }
            });
          },
        },
      ],
    );
  }, [ownerId, pending, resetEditableForm]);

  const handleSubmit = useCallback(async () => {
    if (!ownerId || submitPreparationLockRef.current !== null) return;
    const cleanContent = content.trim();
    const cleanTitle = title.trim();
    const cleanDesiredAnswer = desiredAnswer.trim();
    const cleanSponsorship = sponsorshipDetail.trim();
    const cleanRegion = coarseRegion.trim();
    if (cleanContent.length < 20) {
      setRequestError("막막한 상황을 20자 이상 적어주세요.");
      return;
    }
    if (cleanTitle.length < 8) {
      setRequestError("질문의 핵심을 8자 이상 한 줄로 적어주세요.");
      return;
    }
    if (!experienceScope || !preparationStage || !contractPhase) {
      setRequestError("질문 조건 세 가지를 모두 선택해 주세요.");
      return;
    }
    if (cleanRegion.length > 0 && cleanRegion.length < 2) {
      setRequestError("지역은 2자 이상 넓게 적어주세요.");
      return;
    }
    if (cleanDesiredAnswer.length < 5) {
      setRequestError("어떤 경험 답변이 필요한지 5자 이상 적어주세요.");
      return;
    }
    if (commercialRelationship !== "none" && cleanSponsorship.length < 3) {
      setRequestError("받은 혜택이나 업체 관계를 3자 이상 구체적으로 적어주세요.");
      return;
    }

    const preparationLock = Symbol("community-decision-prepare");
    submitPreparationLockRef.current = preparationLock;
    const questionId = Crypto.randomUUID();
    const body: CreateBody = {
      questionId,
      title: cleanTitle,
      content: cleanContent,
      topicCategory: "contract_extra_cost",
      experienceScope,
      coarseRegion: cleanRegion || null,
      preparationStage,
      contractPhase,
      desiredAnswer: cleanDesiredAnswer,
      commercialRelationship,
      sponsorshipDetail: commercialRelationship === "none" ? null : cleanSponsorship,
    };
    const submission: CommunityDecisionPendingSubmission = {
      ownerId,
      operationKey: Crypto.randomUUID(),
      questionId,
      bodyText: JSON.stringify(body),
      phase: "submitting_unknown",
      commandId: null,
      createdAt: Date.now(),
      retryAt: null,
      withdrawOperationKey: null,
      withdrawBodyText: null,
    };

    try {
      await saveCommunityDecisionPending(submission);
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id.toLowerCase() !== ownerId.toLowerCase()) return;
      setPending(submission);
      await submitExactPending(submission);
    } catch {
      setRequestError("안전한 재시도를 준비하지 못해 요청을 보내지 않았어요. 다시 시도해 주세요.");
    } finally {
      if (submitPreparationLockRef.current === preparationLock) {
        submitPreparationLockRef.current = null;
      }
    }
  }, [
    coarseRegion,
    commercialRelationship,
    content,
    contractPhase,
    desiredAnswer,
    experienceScope,
    ownerId,
    preparationStage,
    sponsorshipDetail,
    submitExactPending,
    title,
  ]);

  if (sessionLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="사람 경험 묻기" onBack={() => router.back()} />
        <LoadingState label="안전한 작성 상태를 확인하고 있어요" />
      </SafeAreaView>
    );
  }

  if (!ownerId) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="사람 경험 묻기" onBack={() => router.back()} />
        <EmptyState
          icon={<LockKeyhole size={28} color={colors.noir[800]} />}
          title="로그인이 필요해요"
          description="비공개 대기 상태와 게시 결과를 본인 계정에 안전하게 연결해요."
          action={(
            <PrimaryButton onPress={() => router.push("/(auth)/login")}>로그인하기</PrimaryButton>
          )}
        />
      </SafeAreaView>
    );
  }

  if (pending) {
    const isWaitlist = pending.phase === "private_waitlist";
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <AppHeader title="사람 경험 묻기" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.statusContent} automaticallyAdjustKeyboardInsets>
          <Surface tone={isWaitlist ? "ivory" : "rose"} style={styles.statusSurface}>
            <View style={styles.statusIcon}>
              {isWaitlist ? (
                <Clock3 size={26} color={colors.noir[800]} />
              ) : (
                <AlertCircle size={26} color={colors.rose[600]} />
              )}
            </View>
            <StatusPill
              label={isWaitlist ? "비공개 대기" : "게시 상태 확인 필요"}
              tone={isWaitlist ? "warning" : "rose"}
            />
            <AppText variant="subtitle" style={styles.statusTitle}>
              {isWaitlist ? "아직 공개되지 않았어요" : "완료로 단정하지 않았어요"}
            </AppText>
            <AppText variant="body" style={styles.statusBody}>
              {isWaitlist
                ? "실제 경험이 있는 사람과 예비 응답자가 모두 확인된 뒤에만 질문을 공개해요. 지금은 다른 회원에게 보이지 않습니다."
                : "요청 결과를 받지 못했거나 응답 형식을 확인하지 못했어요. 새 글을 만들지 않고 같은 요청으로 상태만 다시 확인합니다."}
            </AppText>
            {getPendingTitle(pending) ? (
              <View style={styles.pendingTitleRow}>
                <AppText variant="caption">대기 중인 질문</AppText>
                <AppText variant="bodyStrong">{getPendingTitle(pending)}</AppText>
              </View>
            ) : null}
          </Surface>

          <View style={styles.statusExplanation}>
            <View style={styles.explanationRow}>
              <LockKeyhole size={18} color={colors.textSecondary} />
              <AppText variant="body" style={styles.explanationText}>
                동일한 질문 내용과 요청 키를 보관해 중복 게시를 막아요.
              </AppText>
            </View>
            <View style={styles.explanationRow}>
              <Users size={18} color={colors.textSecondary} />
              <AppText variant="body" style={styles.explanationText}>
                AI·운영자 답변은 사람 답변 공급으로 세지 않아요.
              </AppText>
            </View>
          </View>

          {requestError ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <AlertCircle size={18} color={colors.danger} />
              <AppText variant="caption" style={styles.errorText}>{requestError}</AppText>
            </View>
          ) : null}

          <PrimaryButton
            onPress={() => void submitExactPending(pending)}
            disabled={submitting || withdrawSubmitting
              || Boolean(pending.withdrawOperationKey) || retryRemainingSeconds > 0}
            icon={submitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}
          >
            {submitting
              ? "상태 확인 중"
              : pending.withdrawOperationKey
                ? "철회 상태를 먼저 확인해 주세요"
                : (retryRemainingLabel ?? "게시 상태 다시 확인")}
          </PrimaryButton>

          {isWaitlist ? (
            <View style={styles.withdrawSection}>
              <Pressable
                onPress={() => setShowWithdraw((current) => !current)}
                disabled={withdrawSubmitting || Boolean(pending.withdrawOperationKey)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showWithdraw }}
                style={({ pressed }) => [pressed && styles.pressed]}
              >
                <AppText variant="caption" style={styles.withdrawLink}>
                  비공개 대기 요청 철회
                </AppText>
              </Pressable>
              {showWithdraw ? (
                <View style={styles.withdrawForm}>
                  <AppText variant="bodyStrong">철회 이유</AppText>
                  <AppText variant="caption">
                    서버의 철회 영수증이 확인된 뒤에만 이 기기의 요청 정보를 삭제해요.
                  </AppText>
                  <TextInput
                    value={withdrawReason}
                    onChangeText={setWithdrawReason}
                    editable={!withdrawSubmitting && !pending.withdrawOperationKey}
                    maxLength={500}
                    placeholder="예: 상황이 바뀌어 더 이상 답변이 필요하지 않아요."
                    placeholderTextColor={colors.textTertiary}
                    style={styles.input}
                  />
                  <Pressable
                    onPress={() => void handleWithdrawWaitlist()}
                    disabled={withdrawSubmitting}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.withdrawButton,
                      pressed && styles.pressed,
                      withdrawSubmitting && styles.buttonDisabled,
                    ]}
                  >
                    {withdrawSubmitting ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : null}
                    <AppText variant="bodyStrong" style={styles.withdrawButtonText}>
                      {withdrawSubmitting ? "철회 확인 중" : "요청 철회하기"}
                    </AppText>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
          <AppText variant="caption" style={styles.statusFootnote}>
            작성 초안은 24시간 뒤 삭제돼요. 이 게시 복구 명령은 공개·철회 영수증이 확인되면 바로 삭제하고, 그전에는 이 기기의 잠금 저장소에 최대 30일 보관해요. 대기 질문 상세에서 직접 삭제할 수 있어요.
          </AppText>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <AppHeader title="사람 경험 묻기" onBack={() => router.back()} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.intro}>
          <View style={styles.introMeta}>
            <StatusPill label="계약·추가금 기록" tone="neutral" />
            {(content || title || experienceScope || preparationStage || contractPhase
              || coarseRegion || desiredAnswer || commercialRelationship !== "none"
              || sponsorshipDetail) ? (
                <Pressable
                  onPress={handleDeleteDraft}
                  accessibilityRole="button"
                  accessibilityLabel="임시저장 삭제"
                  hitSlop={8}
                >
                  <AppText variant="caption" style={styles.deleteDraftText}>임시저장 삭제</AppText>
                </Pressable>
              ) : null}
          </View>
          <AppText variant="title">지금 무엇이 막막해요?</AppText>
          <AppText variant="body">
            제목보다 상황부터 적어주세요. 입력은 이 기기의 잠금 저장소에 계정별로 24시간 보관되고, 실제 경험자 공급이 확인되기 전에는 공개되지 않아요.
          </AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">1. 막막한 상황</AppText>
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={5_000}
            textAlignVertical="top"
            placeholder="예: 계약서에는 원본 비용이 없는데 상담 뒤 별도 추가금이라고 들었어요. 계약 전 어떤 문구를 확인해야 할까요?"
            placeholderTextColor={colors.textTertiary}
            style={[styles.input, styles.contentInput]}
          />
          <AppText variant="caption" style={styles.counter}>{content.length}/5,000</AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">2. 한 줄 질문</AppText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            maxLength={160}
            placeholder="예: 계약 후 원본 추가금, 미리 확인할 문구가 있나요?"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
          />
          <AppText variant="caption" style={styles.counter}>{title.length}/160</AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">3. 적용 조건</AppText>
          <AppText variant="caption">
            정확한 날짜·주소·업체 담당자 이름은 적지 마세요. 넓은 조건만 공유해요.
          </AppText>
          <ChoiceGroup
            label="어떤 경험이 필요해요?"
            value={experienceScope}
            options={EXPERIENCE_SCOPES}
            onChange={setExperienceScope}
          />
          <ChoiceGroup
            label="현재 준비 단계"
            value={preparationStage}
            options={PREPARATION_STAGES}
            onChange={setPreparationStage}
          />
          <ChoiceGroup
            label="계약 시점"
            value={contractPhase}
            options={CONTRACT_PHASES}
            onChange={setContractPhase}
          />
          <View style={styles.fieldBlock}>
            <AppText variant="bodyStrong">넓은 지역 · 선택</AppText>
            <TextInput
              value={coarseRegion}
              onChangeText={setCoarseRegion}
              maxLength={40}
              placeholder="예: 서울 동부, 경기 남부"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
            />
          </View>
          <View style={styles.fieldBlock}>
            <AppText variant="bodyStrong">어떤 답을 원해요?</AppText>
            <TextInput
              value={desiredAnswer}
              onChangeText={setDesiredAnswer}
              maxLength={300}
              placeholder="예: 실제로 확인한 계약 문구와 추가금 결과"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
            />
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="subtitle">4. 업체·혜택 관계</AppText>
          <AppText variant="caption">
            답변을 보는 사람이 관계를 판단할 수 있게 숨기지 않고 표시해요.
          </AppText>
          <ChoiceGroup
            label="현재 관계"
            value={commercialRelationship}
            options={RELATIONSHIPS}
            onChange={setCommercialRelationship}
          />
          {commercialRelationship !== "none" ? (
            <View style={styles.fieldBlock}>
              <AppText variant="bodyStrong">관계·혜택 상세</AppText>
              <TextInput
                value={sponsorshipDetail}
                onChangeText={setSponsorshipDetail}
                maxLength={500}
                placeholder="받은 혜택이나 업체와의 관계를 구체적으로 적어주세요."
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
              />
            </View>
          ) : null}
        </View>

        <Surface tone="ivory" style={styles.safetySurface}>
          <LockKeyhole size={20} color={colors.noir[800]} />
          <View style={styles.safetyText}>
            <AppText variant="bodyStrong">공개 전 공급·안전 확인</AppText>
            <AppText variant="caption">
              전화번호, 정확한 일정, 계약서 원문 같은 개인정보는 서버에서도 검사해요. 사진은 지금 발행하지 않습니다.
            </AppText>
          </View>
        </Surface>

        {requestError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <AlertCircle size={18} color={colors.danger} />
            <AppText variant="caption" style={styles.errorText}>{requestError}</AppText>
          </View>
        ) : null}

        {draftSaveError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <AlertCircle size={18} color={colors.danger} />
            <AppText variant="caption" style={styles.errorText}>{draftSaveError}</AppText>
          </View>
        ) : null}

        <PrimaryButton
          onPress={() => void handleSubmit()}
          disabled={submitting}
          icon={submitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : undefined}
        >
          {submitting ? "요청 상태 확인 중" : "사람 경험 요청하기"}
        </PrimaryButton>
        <AppText variant="caption" style={styles.submitNotice}>
          이 버튼은 즉시 공개를 보장하지 않아요. 비공개 대기 또는 실제 게시 결과를 구분해 보여드려요.
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing[5], paddingBottom: spacing[10], gap: spacing[6] },
  intro: { gap: spacing[2], alignItems: "flex-start" },
  introMeta: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  deleteDraftText: { color: colors.danger },
  section: { gap: spacing[3] },
  fieldBlock: { gap: spacing[2] },
  choiceBlock: { gap: spacing[2] },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  choice: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  choiceSelected: { borderColor: colors.rose[500], backgroundColor: colors.rose.glow },
  choiceText: { color: colors.textSecondary },
  choiceTextSelected: { color: colors.rose[700] },
  pressed: { opacity: 0.78 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    color: colors.noir[800],
    fontFamily: "NotoSansKR_400Regular",
    fontSize: 15,
    lineHeight: 23,
  },
  contentInput: { minHeight: 156 },
  counter: { textAlign: "right" },
  safetySurface: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  safetyText: { flex: 1, gap: spacing[1] },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: "rgba(217, 95, 95, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(217, 95, 95, 0.24)",
  },
  errorText: { flex: 1, color: colors.danger },
  submitNotice: { textAlign: "center" },
  statusContent: { padding: spacing[5], paddingBottom: spacing[10], gap: spacing[5] },
  statusSurface: { alignItems: "flex-start", gap: spacing[3] },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  statusTitle: { marginTop: spacing[1] },
  statusBody: { color: colors.textSecondary },
  pendingTitleRow: {
    alignSelf: "stretch",
    gap: spacing[1],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[3],
  },
  statusExplanation: { gap: spacing[3] },
  explanationRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  explanationText: { flex: 1 },
  statusFootnote: { textAlign: "center" },
  withdrawSection: {
    alignItems: "center",
    gap: spacing[3],
    paddingTop: spacing[2],
  },
  withdrawLink: { color: colors.danger, textDecorationLine: "underline" },
  withdrawForm: {
    alignSelf: "stretch",
    gap: spacing[2],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: "rgba(217, 95, 95, 0.24)",
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  withdrawButton: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.xl,
  },
  withdrawButtonText: { color: colors.danger },
  buttonDisabled: { opacity: 0.45 },
});
