import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronRight, LockKeyhole, SlidersHorizontal, X } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import {
  AMORA_CORE_CRITERION_MAX_LENGTH,
  buildAmoraCoreCriterionDeleteRequest,
  buildAmoraCoreCriterionSaveRequest,
  parseAmoraCoreCriterionResponse,
  type AmoraCoreCriterion,
} from "@hanbang/shared/amora-core-criterion";
import {
  buildAmoraCoupleCriterionAcceptRequest,
  buildAmoraCoupleCriterionCancelRequest,
  buildAmoraCoupleCriterionProposeRequest,
  parseAmoraCoupleCriterionResponse,
  type AmoraCoupleCriterionResponse,
} from "@hanbang/shared/amora-couple-criterion";

import {
  AppHeader,
  AppText,
  LoadingState,
  PrimaryButton,
  StatusPill,
  Surface,
} from "@/components/ui/AppUI";
import { apiFetchForExpectedUser } from "@/lib/api";
import { getAmoraCoupleCriterionView } from "@/lib/amoraCoupleCriterion.mjs";
import {
  buildAmoraPersonalizationResetBody,
  buildSinglePersonalizationPreferenceSaveBody,
  DEFAULT_AMORA_PERSONALIZATION_PREFERENCES,
  parseAmoraPersonalizationConflict,
  parseAmoraPersonalizationEnvelope,
  parseAmoraPersonalizationResetEnvelope,
  type AmoraPersonalizationPreferenceField,
  type AmoraPersonalizationPreferenceValue,
  type AmoraPersonalizationProfile,
} from "@/lib/amoraPersonalization.mjs";
import {
  AMORA_PERSONALIZATION_SETTING_SECTIONS,
  buildAmoraPersonalizationSummary,
  getAmoraPersonalizationSettingsView,
  type AmoraPersonalizationSettingSection,
} from "@/lib/amoraPersonalizationSettings.mjs";
import { supabase } from "@/lib/supabase";

type LoadState = "loading" | "ready" | "error";

interface AmoraPersonalizationResetTicket {
  ownerUserId: string;
  sessionGeneration: number;
  sessionSignedInAt: string | null;
  body: Readonly<{ expectedRevision: number }>;
}

interface VerifiedAuthSessionIdentity {
  userId: string;
  signedInAt: string | null;
}

async function currentVerifiedAuthSessionIdentity(): Promise<VerifiedAuthSessionIdentity | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    signedInAt: data.user.last_sign_in_at ?? null,
  };
}

async function currentVerifiedUserId(): Promise<string | null> {
  return (await currentVerifiedAuthSessionIdentity())?.userId ?? null;
}

async function currentVerifiedCoupleContext(): Promise<{
  userId: string;
  coupleId: string;
  sessionSignedInAt: string | null;
} | null> {
  const sessionIdentity = await currentVerifiedAuthSessionIdentity();
  if (!sessionIdentity) return null;
  const { userId } = sessionIdentity;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();
  return profileError || typeof profile?.couple_id !== "string"
    ? null
    : {
        userId,
        coupleId: profile.couple_id,
        sessionSignedInAt: sessionIdentity.signedInAt,
      };
}

function payloadError(payload: unknown, fallback: string): string {
  if (
    payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).error === "string"
  ) {
    const message = (payload as Record<string, unknown>).error as string;
    if (message.length > 0 && message.length <= 240) return message;
  }
  return fallback;
}

export default function AmoraStyleSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState<AmoraPersonalizationProfile | null>(null);
  const [verifiedOwnerUserId, setVerifiedOwnerUserId] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<AmoraPersonalizationPreferenceField | null>(null);
  const [selectedValue, setSelectedValue] = useState<AmoraPersonalizationPreferenceValue | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [criterion, setCriterion] = useState<AmoraCoreCriterion | null>(null);
  const [criterionLoaded, setCriterionLoaded] = useState(false);
  const [criterionEditorOpen, setCriterionEditorOpen] = useState(false);
  const [criterionDraft, setCriterionDraft] = useState("");
  const [criterionError, setCriterionError] = useState("");
  const [criterionSaving, setCriterionSaving] = useState(false);
  const [coupleCriterion, setCoupleCriterion] = useState<AmoraCoupleCriterionResponse | null>(null);
  const [coupleCriterionLoaded, setCoupleCriterionLoaded] = useState(false);
  const [coupleCriterionEditorOpen, setCoupleCriterionEditorOpen] = useState(false);
  const [coupleCriterionDraft, setCoupleCriterionDraft] = useState("");
  const [coupleCriterionError, setCoupleCriterionError] = useState("");
  const [coupleCriterionSaving, setCoupleCriterionSaving] = useState(false);
  const [verifiedCoupleId, setVerifiedCoupleId] = useState<string | null>(null);
  const operationGeneration = useRef(0);
  const authSessionGenerationRef = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const resetInFlightRef = useRef(false);
  const verifiedOwnerUserIdRef = useRef<string | null>(null);
  const verifiedSessionSignedInAtRef = useRef<string | null>(null);
  const verifiedCoupleIdRef = useRef<string | null>(null);

  const clearOwnerBoundState = useCallback(() => {
    verifiedOwnerUserIdRef.current = null;
    verifiedSessionSignedInAtRef.current = null;
    verifiedCoupleIdRef.current = null;
    setProfile(null);
    setVerifiedOwnerUserId(null);
    setActiveField(null);
    setSelectedValue(null);
    setSaveError("");
    setSaving(false);
    resetInFlightRef.current = false;
    setResetError("");
    setResetting(false);
    setCriterion(null);
    setCriterionLoaded(false);
    setCriterionEditorOpen(false);
    setCriterionDraft("");
    setCriterionError("");
    setCriterionSaving(false);
    setCoupleCriterion(null);
    setCoupleCriterionLoaded(false);
    setCoupleCriterionEditorOpen(false);
    setCoupleCriterionDraft("");
    setCoupleCriterionError("");
    setCoupleCriterionSaving(false);
    setVerifiedCoupleId(null);
    setNotice("");
  }, []);

  const load = useCallback(async () => {
    const operation = ++operationGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    clearOwnerBoundState();
    setLoadState("loading");
    setLoadError("");

    try {
      const verifiedContext = await currentVerifiedCoupleContext();
      if (!verifiedContext) throw new Error("현재 커플 정보를 확인하지 못했어요.");
      const { userId: ownerUserId, coupleId, sessionSignedInAt } = verifiedContext;
      const [response, criterionResponse, coupleCriterionResponse] = await Promise.all([
        apiFetchForExpectedUser(
          ownerUserId,
          "/api/amora/personalization",
          {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        ),
        apiFetchForExpectedUser(
          ownerUserId,
          "/api/amora/criterion",
          {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        ),
        apiFetchForExpectedUser(
          ownerUserId,
          "/api/amora/couple-criterion",
          {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        ),
      ]);
      const [payload, criterionPayload, coupleCriterionPayload]: [unknown, unknown, unknown] = await Promise.all([
        response.json().catch(() => null),
        criterionResponse.json().catch(() => null),
        coupleCriterionResponse.json().catch(() => null),
      ]);
      const currentContext = await currentVerifiedCoupleContext();
      if (
        controller.signal.aborted
        || operation !== operationGeneration.current
        || currentContext?.userId !== ownerUserId
        || currentContext?.coupleId !== coupleId
        || currentContext?.sessionSignedInAt !== sessionSignedInAt
      ) return;
      const parsed = parseAmoraPersonalizationEnvelope(payload);
      if (!response.ok || !parsed) {
        throw new Error(payloadError(payload, "나만의 아모라 설정을 불러오지 못했어요."));
      }
      const parsedCriterion = criterionResponse.ok
        ? parseAmoraCoreCriterionResponse(criterionPayload)
        : null;
      const parsedCoupleCriterion = coupleCriterionResponse.ok
        ? parseAmoraCoupleCriterionResponse(coupleCriterionPayload)
        : null;
      setProfile(parsed.profile);
      setCriterion(parsedCriterion?.criterion ?? null);
      setCriterionLoaded(Boolean(parsedCriterion));
      setCriterionError(parsedCriterion ? "" : "기준을 불러오지 못했어요. 다시 불러와 주세요.");
      setCoupleCriterion(
        parsedCoupleCriterion?.coupleId === coupleId ? parsedCoupleCriterion : null,
      );
      setCoupleCriterionLoaded(parsedCoupleCriterion?.coupleId === coupleId);
      setCoupleCriterionError(
        parsedCoupleCriterion?.coupleId === coupleId
          ? ""
          : "우리 기준을 불러오지 못했어요. 다시 불러와 주세요.",
      );
      verifiedOwnerUserIdRef.current = ownerUserId;
      verifiedSessionSignedInAtRef.current = sessionSignedInAt;
      verifiedCoupleIdRef.current = coupleId;
      setVerifiedOwnerUserId(ownerUserId);
      setVerifiedCoupleId(coupleId);
      setLoadState("ready");
    } catch (error) {
      if (controller.signal.aborted || operation !== operationGeneration.current) return;
      clearOwnerBoundState();
      setLoadState("error");
      setLoadError(
        error instanceof Error && error.message
          ? error.message
          : "나만의 아모라 설정을 불러오지 못했어요.",
      );
    } finally {
      if (operation === operationGeneration.current) requestController.current = null;
    }
  }, [clearOwnerBoundState]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        operationGeneration.current += 1;
        requestController.current?.abort();
        requestController.current = null;
      };
    }, [load]),
  );

  useEffect(() => {
    let disposed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextOwnerUserId = session?.user.id ?? null;
      const nextSessionSignedInAt = session?.user.last_sign_in_at ?? null;
      if (
        nextOwnerUserId === verifiedOwnerUserIdRef.current
        && nextSessionSignedInAt === verifiedSessionSignedInAtRef.current
      ) return;
      authSessionGenerationRef.current += 1;
      operationGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      clearOwnerBoundState();
      setLoadState("loading");
      setTimeout(() => {
        if (!disposed) void load();
      }, 0);
    });
    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [clearOwnerBoundState, load]);

  const preferences = profile?.preferences ?? DEFAULT_AMORA_PERSONALIZATION_PREFERENCES;
  const sections = useMemo(
    () => getAmoraPersonalizationSettingsView(preferences) ?? [],
    [preferences],
  );
  const personalizationSummary = useMemo(
    () => buildAmoraPersonalizationSummary(preferences),
    [preferences],
  );
  const activeSection = useMemo(
    () => AMORA_PERSONALIZATION_SETTING_SECTIONS.find((section) => section.field === activeField) ?? null,
    [activeField],
  );
  const coupleCriterionView = useMemo(
    () => coupleCriterion && verifiedOwnerUserId
      ? getAmoraCoupleCriterionView(coupleCriterion, verifiedOwnerUserId)
      : null,
    [coupleCriterion, verifiedOwnerUserId],
  );

  function openCoupleCriterionEditor() {
    if (
      !coupleCriterionLoaded
      || !coupleCriterion
      || coupleCriterionSaving
      || resetting
      || !coupleCriterionView?.canPropose
    ) return;
    setNotice("");
    setCoupleCriterionError("");
    setCoupleCriterionDraft(criterion?.value ?? coupleCriterion.current?.value ?? "");
    setCoupleCriterionEditorOpen(true);
  }

  function closeCoupleCriterionEditor() {
    if (coupleCriterionSaving) return;
    setCoupleCriterionEditorOpen(false);
    setCoupleCriterionDraft("");
    setCoupleCriterionError("");
  }

  async function mutateCoupleCriterion(mode: "propose" | "accept" | "cancel") {
    if (
      loadState !== "ready"
      || coupleCriterionSaving
      || resetting
      || !verifiedOwnerUserId
      || !verifiedCoupleId
      || !coupleCriterionLoaded
      || !coupleCriterion
    ) return;

    const requestId = Crypto.randomUUID();
    const proposal = coupleCriterion.proposal;
    const body = mode === "propose"
      ? buildAmoraCoupleCriterionProposeRequest({
          expectedCoupleId: verifiedCoupleId,
          expectedCurrentDecisionId: coupleCriterion.current?.decisionId ?? null,
          requestId,
          value: coupleCriterionDraft,
        })
      : mode === "accept" && proposal
        ? buildAmoraCoupleCriterionAcceptRequest({
            expectedCoupleId: verifiedCoupleId,
            proposalId: proposal.id,
            expectedRevision: proposal.revision,
            requestId,
          })
        : proposal
          ? buildAmoraCoupleCriterionCancelRequest({
              expectedCoupleId: verifiedCoupleId,
              proposalId: proposal.id,
              expectedRevision: proposal.revision,
              requestId,
            })
          : null;
    if (!body) {
      setCoupleCriterionError(
        mode === "propose"
          ? `공유할 문장은 공백을 제외하고 1~${AMORA_CORE_CRITERION_MAX_LENGTH}자로 적어 주세요.`
          : "확인할 제안이 바뀌었어요. 다시 불러와 주세요.",
      );
      return;
    }

    const ownerUserId = verifiedOwnerUserId;
    const coupleId = verifiedCoupleId;
    const operation = ++operationGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setCoupleCriterionSaving(true);
    setCoupleCriterionError("");

    try {
      const before = await currentVerifiedCoupleContext();
      if (before?.userId !== ownerUserId || before?.coupleId !== coupleId) {
        throw new Error("커플 정보가 바뀌어 적용하지 않았어요.");
      }
      const response = await apiFetchForExpectedUser(
        ownerUserId,
        "/api/amora/couple-criterion",
        {
          method: mode === "propose" ? "POST" : mode === "accept" ? "PATCH" : "DELETE",
          headers: { Accept: "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      const after = await currentVerifiedCoupleContext();
      if (
        controller.signal.aborted
        || operation !== operationGeneration.current
        || after?.userId !== ownerUserId
        || after?.coupleId !== coupleId
      ) return;
      if (response.status === 409) {
        throw new Error("다른 화면에서 우리 기준이 바뀌었어요. 다시 불러와 확인해 주세요.");
      }
      const parsed = parseAmoraCoupleCriterionResponse(payload);
      if (!response.ok || parsed?.coupleId !== coupleId) {
        throw new Error(payloadError(payload, "우리 기준을 반영하지 못했어요."));
      }
      setCoupleCriterion(parsed);
      setCoupleCriterionLoaded(true);
      setCoupleCriterionEditorOpen(false);
      setCoupleCriterionDraft("");
      setNotice(
        mode === "propose"
          ? "공유용 문장을 확인했어요. 이제 파트너 확인을 기다려요."
          : mode === "accept"
            ? "두 사람이 확인해 우리 기준으로 적용했어요."
            : "대기 중인 제안을 취소했어요.",
      );
    } catch (error) {
      if (controller.signal.aborted || operation !== operationGeneration.current) return;
      setCoupleCriterionError(
        error instanceof Error && error.message
          ? error.message
          : "우리 기준을 반영하지 못했어요. 기존 기준은 그대로 유지돼요.",
      );
    } finally {
      if (operation === operationGeneration.current) {
        requestController.current = null;
        setCoupleCriterionSaving(false);
      }
    }
  }

  function confirmCoupleCriterionAccept() {
    const value = coupleCriterion?.proposal?.value;
    if (!value || !coupleCriterionView?.canAccept || coupleCriterionSaving) return;
    Alert.alert(
      "우리 기준으로 함께 쓸까요?",
      `“${value}”\n\n내가 확인하면 두 사람의 우리 기준으로 적용돼요.`,
      [
        { text: "아직 아니에요", style: "cancel" },
        { text: "이 기준 함께 쓰기", onPress: () => { void mutateCoupleCriterion("accept"); } },
      ],
    );
  }

  function confirmCoupleCriterionCancel() {
    if (!coupleCriterionView?.canCancel || coupleCriterionSaving) return;
    Alert.alert(
      "제안을 취소할까요?",
      "현재 확정된 우리 기준은 그대로 유지돼요.",
      [
        { text: "유지하기", style: "cancel" },
        {
          text: "제안 취소",
          style: "destructive",
          onPress: () => { void mutateCoupleCriterion("cancel"); },
        },
      ],
    );
  }

  function openSection(section: AmoraPersonalizationSettingSection) {
    if (loadState !== "ready" || saving || resetting) return;
    setNotice("");
    setSaveError("");
    setActiveField(section.field);
    setSelectedValue(preferences[section.field]);
  }

  function closeEditor() {
    if (saving) return;
    setActiveField(null);
    setSelectedValue(null);
    setSaveError("");
  }

  async function savePreference() {
    if (
      loadState !== "ready"
      || saving
      || !verifiedOwnerUserId
      || !activeField
      || !selectedValue
    ) return;

    const body = buildSinglePersonalizationPreferenceSaveBody(profile, {
      field: activeField,
      value: selectedValue,
    });
    if (!body) {
      setSaveError("선택한 도움 방식을 다시 확인해 주세요.");
      return;
    }

    const ownerUserId = verifiedOwnerUserId;
    const operation = ++operationGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setSaving(true);
    setSaveError("");

    try {
      if (await currentVerifiedUserId() !== ownerUserId) {
        throw new Error("계정이 바뀌어 저장하지 않았어요.");
      }
      const response = await apiFetchForExpectedUser(
        ownerUserId,
        "/api/amora/personalization",
        {
          method: "PUT",
          headers: { Accept: "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (
        controller.signal.aborted
        || operation !== operationGeneration.current
        || await currentVerifiedUserId() !== ownerUserId
      ) return;

      if (response.status === 409) {
        const conflict = parseAmoraPersonalizationConflict(payload);
        if (conflict) {
          setProfile(conflict.current);
          setSaveError("다른 화면에서 설정이 바뀌었어요. 내 선택을 확인하고 다시 저장해 주세요.");
          return;
        }
      }

      const parsed = parseAmoraPersonalizationEnvelope(payload);
      if (!response.ok || !parsed?.profile) {
        throw new Error(payloadError(payload, "도움 방식을 저장하지 못했어요."));
      }
      const savedSection = activeSection;
      setProfile(parsed.profile);
      setActiveField(null);
      setSelectedValue(null);
      setNotice(savedSection ? `${savedSection.title} 설정을 바꿨어요.` : "나만의 아모라 설정을 바꿨어요.");
    } catch (error) {
      if (controller.signal.aborted || operation !== operationGeneration.current) return;
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "도움 방식을 저장하지 못했어요. 기존 설정은 그대로예요.",
      );
    } finally {
      if (operation === operationGeneration.current) {
        requestController.current = null;
        setSaving(false);
      }
    }
  }

  async function resetSavedResponsePreferences(ticket: AmoraPersonalizationResetTicket) {
    if (
      resetInFlightRef.current
      || ticket.ownerUserId !== verifiedOwnerUserIdRef.current
      || ticket.sessionGeneration !== authSessionGenerationRef.current
      || ticket.sessionSignedInAt !== verifiedSessionSignedInAtRef.current
    ) return;

    const operation = ++operationGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    resetInFlightRef.current = true;
    setResetting(true);
    setResetError("");
    setNotice("");

    try {
      const sessionBefore = await currentVerifiedAuthSessionIdentity();
      if (
        ticket.sessionGeneration !== authSessionGenerationRef.current
        || sessionBefore?.userId !== ticket.ownerUserId
        || sessionBefore?.signedInAt !== ticket.sessionSignedInAt
      ) {
        throw new Error("로그인 상태가 바뀌어 초기화하지 않았어요.");
      }
      const response = await apiFetchForExpectedUser(
        ticket.ownerUserId,
        "/api/amora/personalization",
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
          body: JSON.stringify(ticket.body),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      const sessionAfter = await currentVerifiedAuthSessionIdentity();
      if (
        controller.signal.aborted
        || operation !== operationGeneration.current
        || ticket.sessionGeneration !== authSessionGenerationRef.current
        || sessionAfter?.userId !== ticket.ownerUserId
        || sessionAfter?.signedInAt !== ticket.sessionSignedInAt
      ) return;

      if (response.status === 409) {
        const conflict = parseAmoraPersonalizationConflict(payload);
        if (conflict) {
          setProfile(conflict.current);
          setResetError(
            "다른 화면에서 답변 방식이 바뀌어 최신 설정을 불러왔어요. 확인 후 다시 초기화해 주세요.",
          );
          return;
        }
      }

      const reset = parseAmoraPersonalizationResetEnvelope(payload);
      if (!response.ok || !reset) {
        throw new Error(payloadError(payload, "답변 방식을 초기화하지 못했어요."));
      }
      setProfile(reset.profile);
      setNotice("저장한 답변 방식을 기본값으로 초기화했어요.");
    } catch (error) {
      if (
        controller.signal.aborted
        || operation !== operationGeneration.current
        || ticket.sessionGeneration !== authSessionGenerationRef.current
      ) return;
      const message = error instanceof Error && error.message
        ? error.message
        : "답변 방식을 초기화하지 못했어요.";
      setResetError(`${message} 기존 답변 방식은 그대로 유지돼요.`);
    } finally {
      if (operation === operationGeneration.current) {
        requestController.current = null;
        resetInFlightRef.current = false;
        setResetting(false);
      }
    }
  }

  function confirmResponsePreferenceReset() {
    if (
      loadState !== "ready"
      || resetting
      || saving
      || criterionSaving
      || coupleCriterionSaving
      || !verifiedOwnerUserId
    ) return;

    const body = buildAmoraPersonalizationResetBody(profile);
    if (!body) return;
    const ticket: AmoraPersonalizationResetTicket = {
      ownerUserId: verifiedOwnerUserId,
      sessionGeneration: authSessionGenerationRef.current,
      sessionSignedInAt: verifiedSessionSignedInAtRef.current,
      body,
    };

    Alert.alert(
      "저장한 답변 방식만 기본값으로 초기화할까요?",
      "말투·설명·결정·협업·가족 조율 설정만 기본값으로 돌아가요. 꼭 지키고 싶은 내 기준, 두 사람이 확인한 우리 기준, 아모라 기억은 지워지지 않아요.",
      [
        { text: "유지하기", style: "cancel" },
        {
          text: "답변 방식만 초기화",
          style: "destructive",
          onPress: () => { void resetSavedResponsePreferences(ticket); },
        },
      ],
    );
  }

  function openCriterionEditor() {
    if (!criterionLoaded || criterionSaving || resetting) return;
    setNotice("");
    setCriterionError("");
    setCriterionDraft(criterion?.value ?? "");
    setCriterionEditorOpen(true);
  }

  function closeCriterionEditor() {
    if (criterionSaving) return;
    setCriterionEditorOpen(false);
    setCriterionDraft(criterion?.value ?? "");
    setCriterionError("");
  }

  async function mutateCriterion(criterionDeleteMode: boolean) {
    if (
      loadState !== "ready"
      || criterionSaving
      || resetting
      || !verifiedOwnerUserId
      || !criterionLoaded
      || (criterionDeleteMode && !criterion)
    ) return;

    const requestId = Crypto.randomUUID();
    const body = criterionDeleteMode
      ? buildAmoraCoreCriterionDeleteRequest({
          expectedCriterionId: criterion!.id,
          requestId,
        })
      : buildAmoraCoreCriterionSaveRequest({
          expectedCriterionId: criterion?.id ?? null,
          requestId,
          value: criterionDraft,
        });
    if (!body) {
      setCriterionError(
        `기준은 공백을 제외하고 1~${AMORA_CORE_CRITERION_MAX_LENGTH}자로 적어 주세요.`,
      );
      return;
    }

    const ownerUserId = verifiedOwnerUserId;
    const operation = ++operationGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setCriterionSaving(true);
    setCriterionError("");

    try {
      if (await currentVerifiedUserId() !== ownerUserId) {
        throw new Error("계정이 바뀌어 저장하지 않았어요.");
      }
      const response = await apiFetchForExpectedUser(
        ownerUserId,
        "/api/amora/criterion",
        {
          method: criterionDeleteMode ? "DELETE" : "PUT",
          headers: { Accept: "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (
        controller.signal.aborted
        || operation !== operationGeneration.current
        || await currentVerifiedUserId() !== ownerUserId
      ) return;
      if (response.status === 409) {
        throw new Error("다른 화면에서 기준이 바뀌었어요. 다시 불러온 뒤 확인해 주세요.");
      }
      const parsed = parseAmoraCoreCriterionResponse(payload);
      if (!response.ok || !parsed) {
        throw new Error(payloadError(payload, "기준을 저장하지 못했어요."));
      }
      setCriterion(parsed.criterion);
      setCriterionLoaded(true);
      setCriterionEditorOpen(false);
      setCriterionDraft(parsed.criterion?.value ?? "");
      setNotice(criterionDeleteMode ? "내 기준을 삭제했어요." : "내 기준을 저장했어요.");
    } catch (error) {
      if (controller.signal.aborted || operation !== operationGeneration.current) return;
      setCriterionError(
        error instanceof Error && error.message
          ? error.message
          : "기준을 저장하지 못했어요. 기존 기준은 그대로예요.",
      );
    } finally {
      if (operation === operationGeneration.current) {
        requestController.current = null;
        setCriterionSaving(false);
      }
    }
  }

  function confirmCriterionDelete() {
    if (!criterion || criterionSaving) return;
    Alert.alert(
      "기준을 삭제할까요?",
      "삭제하면 앞으로의 아모라 제안에는 이 기준을 사용하지 않아요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => { void mutateCriterion(true); },
        },
      ],
    );
  }

  if (loadState === "loading") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <AppHeader title="나만의 아모라" onBack={() => router.back()} />
        <LoadingState label="아모라가 도울 방식을 불러오는 중이에요" />
      </SafeAreaView>
    );
  }

  if (loadState === "error") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <AppHeader title="나만의 아모라" onBack={() => router.back()} />
        <View style={styles.centeredContent}>
          <Surface tone="ivory" style={styles.errorCard}>
            <AppText variant="subtitle">설정을 열지 못했어요</AppText>
            <AppText variant="body" style={styles.mutedCopy}>
              {loadError || "연결을 확인한 뒤 다시 시도해 주세요."}
            </AppText>
            <PrimaryButton onPress={() => void load()}>다시 불러오기</PrimaryButton>
          </Surface>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <AppHeader
        title="나만의 아모라"
        subtitle="내가 원하는 준비 방식"
        onBack={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Surface tone="ivory" style={styles.introCard}>
          <View style={styles.introIcon}>
            <SlidersHorizontal size={20} color={colors.surface} />
          </View>
          <View style={styles.flex}>
            <AppText variant="subtitle">아모라가 나에게 맞춰 돕는 방식</AppText>
            <AppText variant="body" style={styles.introCopy}>
              성격을 추측하지 않아요. 내가 직접 고른 방식으로 설명하고, 결정을 시작하고,
              둘의 준비 흐름을 제안해요.
            </AppText>
          </View>
        </Surface>

        <Surface style={styles.privacyCard}>
          <LockKeyhole size={18} color={colors.success} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">이 선택은 내 계정에만 저장돼요</AppText>
            <AppText variant="caption" style={styles.mutedCopy}>
              파트너에게 개인 설정을 공개하지 않고, 예산·일정·체크리스트·담당자를 자동으로 바꾸지 않아요.
            </AppText>
          </View>
        </Surface>

        <Surface tone="ivory" style={styles.criterionCard}>
          <View style={styles.criterionHeading}>
            <View style={styles.flex}>
              <AppText variant="eyebrow">나를 이해하는 한 문장</AppText>
              <AppText variant="subtitle">꼭 지키고 싶은 기준</AppText>
            </View>
            <StatusPill
              label={criterion ? "적용 중" : criterionLoaded ? "선택 사항" : "확인 필요"}
              tone={criterion ? "success" : "neutral"}
            />
          </View>
          <AppText variant="body" style={styles.mutedCopy}>
            예: “사진보다 대화가 편한 하루”, “가족보다 우리 둘 기준을 먼저 확인하기”
          </AppText>
          <View style={styles.criterionValueBox}>
            <AppText variant={criterion ? "bodyStrong" : "body"} style={styles.criterionValueText}>
              {criterion?.value ?? "아직 정한 기준이 없어요."}
            </AppText>
          </View>
          <AppText variant="caption" style={styles.mutedCopy}>
            이 기준은 먼저 나만 보고, 아모라가 다음 선택을 설명할 때 참고해요. 파트너와 합의한
            내용으로 단정하거나 일정·예산을 자동으로 바꾸지 않아요.
          </AppText>
          {criterionError ? (
            <View accessibilityRole="alert">
              <AppText variant="caption" style={styles.errorText}>
                {criterionError}
              </AppText>
            </View>
          ) : null}
          <PrimaryButton
            tone="rose"
            onPress={criterionLoaded ? openCriterionEditor : () => { void load(); }}
            disabled={criterionSaving || resetting}
          >
            {criterionLoaded
              ? criterion ? "기준 바꾸기" : "기준 하나 정하기"
              : "다시 불러오기"}
          </PrimaryButton>
        </Surface>

        <Surface style={styles.coupleCriterionCard}>
          <View style={styles.criterionHeading}>
            <View style={styles.flex}>
              <AppText variant="eyebrow">두 사람이 함께 확인한 한 문장</AppText>
              <AppText variant="subtitle">우리 기준</AppText>
            </View>
            <StatusPill
              label={!coupleCriterionLoaded
                ? "확인 필요"
                : coupleCriterionView?.status === "unlinked"
                  ? "파트너 연결 필요"
                  : coupleCriterionView?.status === "waiting_partner"
                    ? "파트너 확인 대기"
                    : coupleCriterionView?.status === "review_required"
                      ? "내 확인 필요"
                      : coupleCriterionView?.status === "confirmed"
                        ? "함께 적용 중"
                        : "선택 사항"}
              tone={coupleCriterionView?.status === "confirmed" ? "success" : "neutral"}
            />
          </View>
          <AppText variant="body" style={styles.mutedCopy}>
            두 사람이 각각 확인한 뒤에만 아모라가 공동 제안과 준비 순서에 참고해요.
            내 기준 원문은 자동으로 공유되지 않아요.
          </AppText>

          {coupleCriterionView?.status === "unlinked" ? (
            <View style={styles.coupleCriterionEmpty}>
              <AppText variant="bodyStrong">먼저 파트너를 연결해 주세요</AppText>
              <AppText variant="caption" style={styles.mutedCopy}>
                연결 전에는 내 기준만 비공개로 사용하고, 우리 기준을 만들거나 공유하지 않아요.
              </AppText>
            </View>
          ) : (
            <View style={styles.coupleCriterionSection}>
              <AppText variant="caption" style={styles.coupleCriterionLabel}>
                현재 우리 기준
              </AppText>
              <View style={styles.criterionValueBox}>
                <AppText
                  variant={coupleCriterionView?.currentValue ? "bodyStrong" : "body"}
                  style={styles.criterionValueText}
                >
                  {coupleCriterionView?.currentValue ?? "아직 두 사람이 확정한 기준이 없어요."}
                </AppText>
              </View>
            </View>
          )}

          {coupleCriterion?.proposal ? (
            <View style={styles.pendingProposalBox}>
              <View style={styles.pendingProposalHeading}>
                <AppText variant="bodyStrong">
                  {coupleCriterionView?.canAccept ? "함께 확인할 제안" : "내가 확인한 공유용 문장"}
                </AppText>
                <StatusPill
                  label={coupleCriterionView?.canAccept ? "확인 전" : "1/2 확인"}
                  tone="neutral"
                />
              </View>
              <AppText variant="body" style={styles.proposalValue}>
                {coupleCriterion.proposal.value}
              </AppText>
              <AppText variant="caption" style={styles.mutedCopy}>
                {coupleCriterionView?.canAccept
                  ? "내가 확인하기 전에는 우리 기준으로 적용되지 않아요."
                  : "파트너가 같은 문장을 확인하기 전에는 기존 우리 기준이 그대로 유지돼요."}
              </AppText>
            </View>
          ) : null}

          {coupleCriterionError ? (
            <View accessibilityRole="alert">
              <AppText variant="caption" style={styles.errorText}>
                {coupleCriterionError}
              </AppText>
            </View>
          ) : null}

          {!coupleCriterionLoaded ? (
            <PrimaryButton
              onPress={() => { void load(); }}
              disabled={coupleCriterionSaving || resetting}
            >
              다시 불러오기
            </PrimaryButton>
          ) : coupleCriterionView?.status === "unlinked" ? (
            <PrimaryButton tone="rose" onPress={() => router.push("/settings") }>
              파트너 연결 확인하기
            </PrimaryButton>
          ) : coupleCriterionView?.canAccept ? (
            <PrimaryButton
              tone="rose"
              onPress={confirmCoupleCriterionAccept}
              disabled={coupleCriterionSaving || resetting}
              icon={coupleCriterionSaving
                ? <ActivityIndicator size="small" color={colors.surface} />
                : undefined}
            >
              이 기준 함께 쓰기
            </PrimaryButton>
          ) : coupleCriterionView?.canPropose ? (
            <PrimaryButton
              tone="rose"
              onPress={openCoupleCriterionEditor}
              disabled={coupleCriterionSaving || resetting}
            >
              우리 기준으로 제안하기
            </PrimaryButton>
          ) : null}

          {coupleCriterionView?.canCancel ? (
            <Pressable
              style={styles.coupleCriterionCancelButton}
              onPress={confirmCoupleCriterionCancel}
              disabled={coupleCriterionSaving || resetting}
              accessibilityRole="button"
              accessibilityLabel="대기 중인 우리 기준 제안 취소"
            >
              <AppText variant="bodyStrong" style={styles.coupleCriterionCancelText}>
                제안 취소
              </AppText>
            </Pressable>
          ) : null}
        </Surface>

        {personalizationSummary ? (
          <Surface tone="noir" style={styles.summaryCard}>
            <AppText variant="eyebrow" style={styles.summaryEyebrow}>
              지금 내 아모라는
            </AppText>
            <AppText variant="bodyStrong" style={styles.summaryText}>
              {personalizationSummary}
            </AppText>
          </Surface>
        ) : null}

        {notice ? (
          <View accessibilityRole="alert">
            <StatusPill label={notice} tone="success" />
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <AppText variant="subtitle">지금 적용되는 방식</AppText>
          <StatusPill label={profile ? "내 설정" : "기본값"} tone={profile ? "success" : "neutral"} />
        </View>

        <Surface style={styles.settingList}>
          {sections.map((section, index) => (
            <View key={section.field}>
              <Pressable
                style={({ pressed }) => [styles.settingRow, pressed && styles.rowPressed]}
                onPress={() => openSection(section)}
                disabled={resetting}
                accessibilityRole="button"
                accessibilityState={{ disabled: resetting }}
                accessibilityLabel={`${section.title}, 현재 ${section.selectedLabel}`}
                accessibilityHint="두 번 탭하여 이 도움 방식을 바꿉니다"
              >
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{section.title}</AppText>
                  <AppText variant="caption" style={styles.settingDescription}>
                    {section.description}
                  </AppText>
                  <View style={styles.currentChoice}>
                    <AppText variant="caption" style={styles.currentChoiceText}>
                      현재 · {section.selectedLabel}
                    </AppText>
                  </View>
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </Pressable>
              {index < sections.length - 1 ? <View style={styles.settingDivider} /> : null}
            </View>
          ))}
        </Surface>

        <Surface tone="ivory" style={styles.resetCard}>
          <AppText variant="subtitle">저장한 답변 방식만 초기화</AppText>
          <AppText variant="body" style={styles.mutedCopy}>
            말투·설명·결정·협업·가족 조율 설정만 기본값으로 돌아가요. 꼭 지키고 싶은 내 기준,
            두 사람이 확인한 우리 기준, 아모라 기억은 지워지지 않아요.
          </AppText>
          {resetError ? (
            <View accessibilityRole="alert">
              <AppText variant="caption" style={styles.errorText}>
                {resetError}
              </AppText>
            </View>
          ) : null}
          <Pressable
            style={[
              styles.resetButton,
              (!profile || resetting || saving || criterionSaving || coupleCriterionSaving)
                && styles.resetButtonDisabled,
            ]}
            onPress={confirmResponsePreferenceReset}
            disabled={!profile || resetting || saving || criterionSaving || coupleCriterionSaving}
            accessibilityRole="button"
            accessibilityLabel="저장한 답변 방식만 기본값으로 초기화"
            accessibilityState={{
              disabled: !profile || resetting || saving || criterionSaving || coupleCriterionSaving,
              busy: resetting,
            }}
          >
            {resetting ? <ActivityIndicator size="small" color={colors.danger} /> : null}
            <AppText
              variant="bodyStrong"
              style={!profile ? styles.resetButtonTextDisabled : styles.resetButtonText}
            >
              {resetting
                ? "초기화 중"
                : profile
                  ? "답변 방식만 기본값으로"
                  : "이미 기본값을 사용 중이에요"}
            </AppText>
          </Pressable>
        </Surface>

        <AppText variant="caption" style={styles.footerCopy}>
          아모라는 이 설정을 답변과 준비 제안의 순서에만 사용해요. 중요한 저장과 공동 결정은
          언제나 다시 확인받아요.
        </AppText>
      </ScrollView>

      <Modal
        visible={activeSection !== null}
        transparent
        animationType="slide"
        onRequestClose={closeEditor}
      >
        <View style={styles.overlay} accessibilityViewIsModal importantForAccessibility="yes">
          <View
            style={[
              styles.sheet,
              {
                maxHeight: Math.min(height * 0.84, 720),
                paddingBottom: Math.max(insets.bottom, spacing[4]),
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.flex}>
                <AppText variant="eyebrow">나만의 아모라</AppText>
                <AppText variant="subtitle">{activeSection?.title ?? "도움 방식"}</AppText>
              </View>
              <Pressable
                style={styles.closeButton}
                onPress={closeEditor}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="도움 방식 닫기"
              >
                <X size={20} color={colors.noir[800]} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <AppText variant="body" style={styles.mutedCopy}>
                {activeSection?.description}
              </AppText>
              <View style={styles.choiceGroup} accessibilityRole="radiogroup">
                {activeSection?.choices.map((choice) => {
                  const selected = selectedValue === choice.value;
                  return (
                    <Pressable
                      key={choice.value}
                      style={[styles.choice, selected && styles.choiceSelected]}
                      onPress={() => {
                        setSaveError("");
                        setSelectedValue(choice.value);
                      }}
                      disabled={saving}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={choice.label}
                      accessibilityHint={choice.description}
                    >
                      <View style={[styles.radio, selected && styles.radioSelected]}>
                        {selected ? <Check size={14} color={colors.surface} /> : null}
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong">{choice.label}</AppText>
                        <AppText variant="caption" style={styles.choiceDescription}>
                          {choice.description}
                        </AppText>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {saveError ? (
                <AppText variant="caption" style={styles.errorText}>
                  {saveError}
                </AppText>
              ) : null}

              <PrimaryButton
                tone="rose"
                onPress={() => void savePreference()}
                disabled={saving || !selectedValue}
                icon={saving ? <ActivityIndicator size="small" color={colors.surface} /> : undefined}
                accessibilityLabel="선택한 도움 방식 저장하기"
              >
                {saving ? "저장 중" : "이 방식으로 저장"}
              </PrimaryButton>
              <AppText variant="caption" style={styles.sheetPrivacyCopy}>
                선택 전에는 저장되지 않으며, 나중에 여기서 언제든 다시 바꿀 수 있어요.
              </AppText>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={criterionEditorOpen}
        transparent
        animationType="slide"
        onRequestClose={closeCriterionEditor}
      >
        <View style={styles.overlay} accessibilityViewIsModal importantForAccessibility="yes">
          <View
            style={[
              styles.sheet,
              {
                maxHeight: Math.min(height * 0.84, 720),
                paddingBottom: Math.max(insets.bottom, spacing[4]),
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.flex}>
                <AppText variant="eyebrow">나만의 아모라</AppText>
                <AppText variant="subtitle">꼭 지키고 싶은 기준</AppText>
              </View>
              <Pressable
                style={styles.closeButton}
                onPress={closeCriterionEditor}
                disabled={criterionSaving}
                accessibilityRole="button"
                accessibilityLabel="기준 편집 닫기"
              >
                <X size={20} color={colors.noir[800]} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <AppText variant="body" style={styles.mutedCopy}>
                결혼 준비에서 내가 놓치고 싶지 않은 기준을 한 문장으로 적어 주세요.
              </AppText>
              <TextInput
                value={criterionDraft}
                onChangeText={(value) => {
                  setCriterionDraft(value);
                  setCriterionError("");
                }}
                maxLength={AMORA_CORE_CRITERION_MAX_LENGTH}
                multiline
                editable={!criterionSaving}
                style={styles.criterionInput}
                placeholder="예: 하객 수보다 우리 둘이 편안한 하루"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="꼭 지키고 싶은 결혼 준비 기준"
                textAlignVertical="top"
              />
              <AppText variant="caption" style={styles.characterCount}>
                {Array.from(criterionDraft).length}/{AMORA_CORE_CRITERION_MAX_LENGTH}
              </AppText>
              {criterionError ? (
                <View accessibilityRole="alert">
                  <AppText variant="caption" style={styles.errorText}>
                    {criterionError}
                  </AppText>
                </View>
              ) : null}
              <PrimaryButton
                tone="rose"
                onPress={() => { void mutateCriterion(false); }}
                disabled={criterionSaving || criterionDraft.trim().length === 0}
                icon={criterionSaving
                  ? <ActivityIndicator size="small" color={colors.surface} />
                  : undefined}
              >
                {criterionSaving ? "저장 중" : "이 기준으로 저장"}
              </PrimaryButton>
              {criterion ? (
                <Pressable
                  style={styles.criterionDeleteButton}
                  onPress={confirmCriterionDelete}
                  disabled={criterionSaving}
                  accessibilityRole="button"
                  accessibilityLabel="저장한 기준 삭제하기"
                >
                  <AppText variant="bodyStrong" style={styles.criterionDeleteText}>
                    기준 삭제
                  </AppText>
                </Pressable>
              ) : null}
              <AppText variant="caption" style={styles.sheetPrivacyCopy}>
                저장 전에는 반영되지 않아요. 이 문장은 내 비공개 기준이며, 두 사람의 합의로
                사용하려면 별도로 함께 확인해야 해요.
              </AppText>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={coupleCriterionEditorOpen}
        transparent
        animationType="slide"
        onRequestClose={closeCoupleCriterionEditor}
      >
        <View style={styles.overlay} accessibilityViewIsModal importantForAccessibility="yes">
          <View
            style={[
              styles.sheet,
              {
                maxHeight: Math.min(height * 0.84, 720),
                paddingBottom: Math.max(insets.bottom, spacing[4]),
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.flex}>
                <AppText variant="eyebrow">두 사람이 함께 확인</AppText>
                <AppText variant="subtitle">우리 기준으로 제안하기</AppText>
              </View>
              <Pressable
                style={styles.closeButton}
                onPress={closeCoupleCriterionEditor}
                disabled={coupleCriterionSaving}
                accessibilityRole="button"
                accessibilityLabel="우리 기준 제안 닫기"
              >
                <X size={20} color={colors.noir[800]} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <AppText variant="body" style={styles.mutedCopy}>
                파트너와 함께 사용할 문장을 직접 읽고 다듬어 주세요. 아래에 보이는 문장만
                제안되며, 파트너가 같은 문장을 확인하기 전에는 적용되지 않아요.
              </AppText>
              <TextInput
                value={coupleCriterionDraft}
                onChangeText={(value) => {
                  setCoupleCriterionDraft(value);
                  setCoupleCriterionError("");
                }}
                maxLength={AMORA_CORE_CRITERION_MAX_LENGTH}
                multiline
                editable={!coupleCriterionSaving}
                style={styles.criterionInput}
                placeholder="예: 가족 요청보다 우리 둘의 기준을 먼저 확인하기"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="파트너와 함께 확인할 우리 기준 문장"
                textAlignVertical="top"
              />
              <AppText variant="caption" style={styles.characterCount}>
                {Array.from(coupleCriterionDraft).length}/{AMORA_CORE_CRITERION_MAX_LENGTH}
              </AppText>
              {coupleCriterionError ? (
                <View accessibilityRole="alert">
                  <AppText variant="caption" style={styles.errorText}>
                    {coupleCriterionError}
                  </AppText>
                </View>
              ) : null}
              <PrimaryButton
                tone="rose"
                onPress={() => { void mutateCoupleCriterion("propose"); }}
                disabled={coupleCriterionSaving || coupleCriterionDraft.trim().length === 0}
                icon={coupleCriterionSaving
                  ? <ActivityIndicator size="small" color={colors.surface} />
                  : undefined}
              >
                {coupleCriterionSaving ? "제안 중" : "이 문장으로 제안"}
              </PrimaryButton>
              <Surface tone="ivory" style={styles.shareTruthCard}>
                <LockKeyhole size={17} color={colors.success} />
                <AppText variant="caption" style={styles.shareTruthCopy}>
                  내 기준 원문은 자동으로 공유되지 않아요. 지금 직접 확인한 이 문장만
                  파트너에게 보여요.
                </AppText>
              </Surface>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[10],
    gap: spacing[4],
  },
  centeredContent: {
    flex: 1,
    justifyContent: "center",
    padding: spacing[5],
  },
  errorCard: {
    gap: spacing[3],
    padding: spacing[5],
  },
  introCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    padding: spacing[4],
  },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.noir[800],
  },
  introCopy: {
    marginTop: spacing[1],
    color: colors.textSecondary,
    lineHeight: 22,
  },
  privacyCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    padding: spacing[4],
    borderColor: colors.sage.pale,
    borderWidth: 1,
  },
  mutedCopy: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  criterionCard: {
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
  },
  criterionHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  criterionValueBox: {
    minHeight: 56,
    justifyContent: "center",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  criterionValueText: {
    color: colors.noir[800],
    lineHeight: 22,
  },
  criterionInput: {
    minHeight: 120,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    color: colors.noir[800],
    fontSize: 16,
    lineHeight: 23,
  },
  characterCount: {
    alignSelf: "flex-end",
    marginTop: -spacing[3],
    color: colors.textTertiary,
  },
  criterionDeleteButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  criterionDeleteText: {
    color: colors.danger,
  },
  coupleCriterionCard: {
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.sage.pale,
  },
  coupleCriterionSection: {
    gap: spacing[2],
  },
  coupleCriterionLabel: {
    color: colors.textTertiary,
  },
  coupleCriterionEmpty: {
    gap: spacing[1],
    padding: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  pendingProposalBox: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[100],
  },
  pendingProposalHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  proposalValue: {
    color: colors.noir[800],
    lineHeight: 22,
  },
  coupleCriterionCancelButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  coupleCriterionCancelText: {
    color: colors.textSecondary,
  },
  shareTruthCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.sage.pale,
  },
  shareTruthCopy: {
    flex: 1,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  summaryCard: {
    gap: spacing[2],
    padding: spacing[5],
  },
  summaryEyebrow: {
    color: colors.sage.pale,
  },
  summaryText: {
    color: colors.surface,
    lineHeight: 24,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing[1],
  },
  settingList: {
    padding: 0,
    overflow: "hidden",
  },
  settingRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  rowPressed: {
    backgroundColor: colors.ivory[100],
  },
  settingDescription: {
    marginTop: spacing[1],
    color: colors.textSecondary,
    lineHeight: 18,
  },
  currentChoice: {
    alignSelf: "flex-start",
    marginTop: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.sage.pale,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  currentChoiceText: {
    color: colors.noir[800],
    fontWeight: "700",
    textAlign: "center",
  },
  settingDivider: {
    height: 1,
    marginLeft: spacing[4],
    backgroundColor: colors.border,
  },
  resetCard: {
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  resetButtonDisabled: {
    backgroundColor: colors.ivory[100],
  },
  resetButtonText: {
    color: colors.danger,
  },
  resetButtonTextDisabled: {
    color: colors.textTertiary,
  },
  footerCopy: {
    color: colors.textTertiary,
    lineHeight: 19,
    paddingHorizontal: spacing[1],
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(13, 13, 15, 0.42)",
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  sheetHeader: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ivory[100],
  },
  sheetContent: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    gap: spacing[4],
  },
  choiceGroup: {
    gap: spacing[2],
  },
  choice: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  choiceSelected: {
    borderColor: colors.success,
    backgroundColor: colors.ivory[50],
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.taupe[400],
    backgroundColor: colors.surface,
  },
  radioSelected: {
    borderColor: colors.success,
    backgroundColor: colors.success,
  },
  choiceDescription: {
    marginTop: spacing[1],
    color: colors.textSecondary,
    lineHeight: 18,
  },
  errorText: {
    color: colors.danger,
    lineHeight: 19,
  },
  sheetPrivacyCopy: {
    color: colors.textTertiary,
    lineHeight: 18,
    textAlign: "center",
  },
});
