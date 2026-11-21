// 보내기 전 편지 확인(2026-11-17 파운더 디자인 아티팩트 `Approve.dc`, 원문: 이 디자인 완전 같아야해) —
// 로그인한 커플. 아래에서 올라오는 시트다.
//
// - 편지와 승인 상태는 `GET /api/invitation/letter`, 승인 방식(D-76)은 `GET/PUT /api/invitation/approver`.
// - 고친 글과 알려줄 정보는 화면에만 두었다가 "보내기"를 누를 때 `PUT /api/invitation/letter` 로 새 판을
//   저장한다. 저장된 판이 사람이 보던 것과 다르면(맺음말이 바뀌는 등) 승인하지 않고 바뀐 편지를 다시 보여 준다.
// - 승인은 그 판의 ID 와 지문으로만 한다(`POST /api/invitation/letter/approve`). 그 사이 판이 바뀌면 서버가
//   409 `LETTER_VERSION_CHANGED` 로 막고, 화면은 새 판을 불러와 다시 확인하게 한다.
// - 보내기 스위치가 꺼져 있으면 승인만 저장되고 업체에는 가지 않는다. 화면은 그 사실을 그대로 말한다
//   (`LETTER_STATE_COPY.approvedNotSent`).
// - 보내기는 한 번에 하나다. 빠르게 두 번 눌러도 저장·승인을 두 번 보내지 않는다(`sendingRef`).
// - 상대의 승인 권한을 줄이는 승인 방식 변경은 상대가 확인할 때까지 제안으로만 남는다. 상대는 이 시트에서
//   확인·거절한다(`POST /api/invitation/approver/confirm|decline`). 그 사이 제안이 바뀌었으면(409) 지금 방식을
//   다시 읽는다. 제안한 사람은 지금 방식을 다시 골라 제안을 거둔다(`PUT` 이 "withdrawn" 으로 답한다).
// - 직접 보내기(D-83 1단계, 2026-11-18): 서버가 `selfSend` 칸을 주면 두 분이 자기 폰에서 보낸다. 승인 칸과
//   보내기 단추 대신 "이 편지로 할게요"(`prepare`, 저장만 하고 승인하지 않는다)와 받는 곳마다의 보낼 글
//   (`SelfSendPanel`)을 둔다. 칸이 없으면(꺼진 서버) 위의 승인 흐름 그대로다. 승인 칸은 없지만, 상대가 이미 낸
//   승인 방식 제안에는 답할 수 있게 그 확인·거절만 둔다(서버가 이미 온 제안의 확인·거절을 받는다).
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { router } from "expo-router";
import {
  COMMON_STATE_COPY,
  COMPARE_COPY,
  LETTER_COPY,
  LETTER_STATE_COPY,
  SELF_SEND_COPY,
  type InquiryApproverResponse,
  type InvitationLetterResponse,
  type InvitationRouteKey,
  type LetterModel,
  type LetterShare,
} from "@hanbang/shared/invitation";
import InvitationApproverPicker, {
  InvitationProposalAnswer,
  type ApproverChoice,
} from "@/components/invitation/InvitationApproverPicker";
import InvitationLetterSheet from "@/components/invitation/InvitationLetterSheet";
import InvitationStateScreen from "@/components/invitation/InvitationStateScreen";
import SelfSendPanel from "@/components/invitationLive/SelfSendPanel";
import {
  isLetterDirty,
  isLetterVersionChanged,
  isSelfSendRefusal,
  letterApprovalNotice,
  letterSaveBody,
  letterSelfSendView,
  letterShareFlags,
  letterStateNotice,
  sameVisibleLetter,
  type LetterNotice,
  type LetterShareFlags,
} from "@/lib/invitationApi.mjs";
import { useLiveOwner } from "@/lib/invitationLive";
import { navigateInvitationRoute } from "@/lib/invitationRoutes.mjs";

/** 희망 시기·하객 수를 묻는 첫 대화. 웨딩홀 비교의 "조건 알려 주기"와 같은 길이다(`app/halls/index.tsx`). */
const ASK_CONDITIONS_HREF = "/(tabs)/lounge?conditions=1";

type LetterScreenState =
  | { status: "loading" }
  | { status: "failed"; message: string | null }
  | { status: "ready"; letter: InvitationLetterResponse; approver: InquiryApproverResponse | null };

type Members = InquiryApproverResponse["members"];

/** 승인 결과·상태를 사람에게 하는 한 줄로. 기다리는 사람 이름은 승인 방식 칸이 준 이름만 쓴다. */
function noticeText(notice: LetterNotice, members: Members, mode: string | null): string | null {
  switch (notice.kind) {
    case "queued":
      return LETTER_STATE_COPY.queued(notice.count);
    case "alreadySent":
      return LETTER_STATE_COPY.alreadySent;
    case "approvedNotSent":
      return LETTER_STATE_COPY.approvedNotSent;
    case "dailyCap":
      return LETTER_STATE_COPY.dailyCap;
    case "approverUnavailable":
      // 정한 승인자가 커플을 떠났거나 두 사람이 아직 모이지 않았다. 다시 고르게 한다.
      return LETTER_STATE_COPY.approverUnavailable;
    case "waiting": {
      // 지금 보는 사람은 빼고 센다. 내가 누를 차례는 보내기 단추가 말한다.
      const names = notice.userIds
        .map((id) => members.find((member) => member.id === id && !member.isViewer)?.name?.trim() ?? "")
        .filter(Boolean);
      if (names.length > 0) return LETTER_STATE_COPY.waitingFor(names.join(", "));
      return mode === "both" ? LETTER_STATE_COPY.approverNeedsBoth : null;
    }
  }
}

/**
 * 저장한 뒤 보낼 글이 나왔으면 아이폰에서 그 위 첫 줄(`SELF_SEND_COPY.intro`)을 읽어 준다. 화면 읽기는 새로 나온 글을
 * 스스로 읽지 않는다. 안드로이드는 그 줄의 `accessibilityLiveRegion`(`SelfSendPanel`)이 알린다.
 */
function announceSelfSendTexts(response: InvitationLetterResponse) {
  if (Platform.OS !== "ios" || !letterSelfSendView(response, false)?.messages) return;
  AccessibilityInfo.announceForAccessibility(SELF_SEND_COPY.intro);
}

export default function HallsLetterScreen() {
  const liveOwner = useLiveOwner();
  const [state, setState] = useState<LetterScreenState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  // 화면에서 고친 글과 알려줄 정보. null 이면 서버의 마지막 판 그대로다. 저장에 성공하면 비운다.
  const [editedBody, setEditedBody] = useState<string | null>(null);
  const [editedFlags, setEditedFlags] = useState<LetterShareFlags | null>(null);
  // 사람이 누른 일의 결과. 다시 불러와도 지우지 않는다(바뀐 편지를 다시 확인해 달라는 말이 사라지면 안 된다).
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // `sending` 은 다음 그리기 전까지 옛 값이라 같은 순간의 두 번째 누름을 못 막는다. 누르자마자 이 값을 세운다.
  const sendingRef = useRef(false);
  const [approverSaving, setApproverSaving] = useState(false);
  // 승인 방식 바꾸기도 한 번에 하나다(바꿀 때마다 앞 방식의 승인을 다시 받아야 한다). 보내는 동안에는 바꾸지 않는다.
  const approverSavingRef = useRef(false);

  const navigate = useCallback((route: InvitationRouteKey) => {
    navigateInvitationRoute(router, route, "stack");
  }, []);
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else navigate("compare");
  }, [navigate]);
  const askConditions = useCallback(() => {
    router.dismissTo(ASK_CONDITIONS_HREF);
  }, []);
  const openConsultation = useCallback(() => {
    navigate("status");
  }, [navigate]);

  useEffect(() => {
    if (liveOwner.status !== "ready") return;
    let active = true;
    void Promise.all([liveOwner.api.letter(), liveOwner.api.approver()]).then(([letter, approver]) => {
      if (!active) return;
      if (!letter.ok) {
        setState((current) => (current.status === "ready" ? current : { status: "failed", message: letter.message }));
        return;
      }
      // 승인 방식을 못 읽어도 편지는 보여 준다. 고르는 칸만 빠지고 승인은 서버가 지금 방식으로 센다.
      setState({ status: "ready", letter: letter.data, approver: approver.ok ? approver.data : null });
    });
    return () => {
      active = false;
    };
  }, [liveOwner, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  const server = state.status === "ready" ? state.letter.letter : null;
  const letterState = state.status === "ready" ? state.letter.state : null;
  const members: Members = state.status === "ready" ? state.approver?.members ?? [] : [];
  const flags = editedFlags ?? (server ? letterShareFlags(server) : { name: false, phone: false, budget: false });
  const body = editedBody ?? server?.body ?? "";
  const shown: LetterModel | null = server
    ? { ...server, body, shares: server.shares.map((share) => ({ ...share, on: flags[share.key] })) }
    : null;

  const send = useCallback(async () => {
    if (liveOwner.status !== "ready" || state.status !== "ready" || !server || !letterState || !shown || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setActionNotice(null);
    try {
      let current = state.letter;
      if (letterState.versionId === null || isLetterDirty(server, body, flags)) {
        const saved = await liveOwner.api.saveLetter(letterSaveBody(letterState, server, body, flags));
        if (!saved.ok) {
          // 이미 보낼 준비를 마친 편지(LETTER_LOCKED)처럼 서버의 편지가 바뀐 경우는 새로 불러온다.
          if (saved.status === 409) reload();
          setActionNotice(saved.message ?? LETTER_STATE_COPY.saveFailed);
          return;
        }
        setState({ status: "ready", letter: saved.data, approver: state.approver });
        setEditedBody(null);
        setEditedFlags(null);
        if (!saved.data.letter || !saved.data.state) return;
        // 저장된 판이 사람이 보던 편지와 다르면(맺음말이 바뀌는 등) 승인하지 않는다. 바뀐 편지를 다시 본 뒤 누른다.
        if (!sameVisibleLetter(saved.data.letter, shown)) {
          setActionNotice(LETTER_STATE_COPY.versionChanged);
          return;
        }
        current = saved.data;
      }
      const saved = current.state;
      if (!saved?.versionId || !saved.fingerprint) return;
      const approved = await liveOwner.api.approveLetter({ versionId: saved.versionId, fingerprint: saved.fingerprint });
      if (!approved.ok) {
        if (isLetterVersionChanged(approved)) {
          reload();
          setActionNotice(LETTER_STATE_COPY.versionChanged);
        } else if (isSelfSendRefusal(approved)) {
          // 화면을 연 뒤 직접 보내기(D-83 1단계)가 켜졌다. 실패한 것은 없으니 아무 말도 남기지 않고 다시 읽는다:
          // 이 앱은 보낼 글을 그릴 줄 안다. 서버의 문장(앱을 업데이트하라는 말)은 옛 앱에게 하는 말이다.
          reload();
        } else {
          if (approved.status === 409) reload();
          setActionNotice(approved.message ?? LETTER_STATE_COPY.saveFailed);
        }
        return;
      }
      if (approved.data.letter) setState({ status: "ready", letter: approved.data.letter, approver: state.approver });
      setActionNotice(noticeText(letterApprovalNotice(approved.data.result), members, saved.approver.mode));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [liveOwner, state, server, letterState, shown, body, flags, reload, members]);

  // 직접 보내기: 고친 편지(또는 아직 저장하지 않은 초안)를 새 판으로 저장만 한다. 승인하지 않는다.
  // 서버가 저장한 판으로 받는 곳마다 보낼 글을 엮어 같은 답에 실어 준다. `send` 의 저장 절반과 같은 길이다.
  const prepare = useCallback(async () => {
    if (liveOwner.status !== "ready" || state.status !== "ready" || !server || !letterState || !shown || sendingRef.current) return;
    // 승인 방식 제안에 답하는 동안에는 저장하지 않는다. 쓰기는 한 번에 하나다(웹과 같다). 둘이 엇갈리면 저장한 답이
    // 답하기 전의 승인 방식을 다시 그려, 이미 답한 제안이 화면에 되살아난다.
    if (approverSavingRef.current) return;
    if (letterState.versionId !== null && !isLetterDirty(server, body, flags)) return;
    sendingRef.current = true;
    setSending(true);
    setActionNotice(null);
    try {
      const saved = await liveOwner.api.saveLetter(letterSaveBody(letterState, server, body, flags));
      if (!saved.ok) {
        if (saved.status === 409) reload();
        setActionNotice(saved.message ?? LETTER_STATE_COPY.saveFailed);
        return;
      }
      setState({ status: "ready", letter: saved.data, approver: state.approver });
      setEditedBody(null);
      setEditedFlags(null);
      // 저장된 판이 사람이 보던 편지와 다르면(맺음말이 바뀌는 등) 보낼 글도 그 판으로 엮였다. 다시 보게 한다.
      if (saved.data.letter && !sameVisibleLetter(saved.data.letter, shown)) setActionNotice(LETTER_STATE_COPY.versionChanged);
      announceSelfSendTexts(saved.data);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [liveOwner, state, server, letterState, shown, body, flags, reload]);

  const chooseApprover = useCallback(async (choice: ApproverChoice) => {
    if (liveOwner.status !== "ready" || state.status !== "ready" || approverSavingRef.current || sendingRef.current) return;
    approverSavingRef.current = true;
    setApproverSaving(true);
    setActionNotice(null);
    try {
      const result = await liveOwner.api.saveApprover(
        choice.mode === "designated" ? { mode: "designated", designatedUserId: choice.userId } : { mode: "both" },
      );
      if (!result.ok) {
        // 화면을 연 뒤 직접 보내기(D-83 1단계)가 켜졌다(보내기와 같다). 실패한 것은 없으니 아무 말도 남기지 않고 다시 읽는다.
        if (isSelfSendRefusal(result)) {
          reload();
          return;
        }
        setActionNotice(result.message ?? COMMON_STATE_COPY.saveFailed);
        return;
      }
      setState((current) => (current.status === "ready" ? { ...current, approver: result.data } : current));
      // 승인 방식을 바꾸면 앞 방식에서 받은 승인은 다시 받아야 한다. 편지 상태를 새로 읽는다.
      reload();
    } finally {
      approverSavingRef.current = false;
      setApproverSaving(false);
    }
  }, [liveOwner, state, reload]);

  // 상대가 낸 승인 방식 제안에 답한다. 답할 수 있는 사람(제안한 사람이 아닌 회원)만, 화면이 본 제안 번호로만 보낸다.
  const respondApprover = useCallback(async (accept: boolean) => {
    if (liveOwner.status !== "ready" || state.status !== "ready" || approverSavingRef.current || sendingRef.current) return;
    const pending = state.approver?.pending ?? null;
    if (!pending || !pending.viewerCanRespond) return;
    approverSavingRef.current = true;
    setApproverSaving(true);
    setActionNotice(null);
    try {
      const result = accept
        ? await liveOwner.api.confirmApprover(pending.proposalId)
        : await liveOwner.api.declineApprover(pending.proposalId);
      if (!result.ok) {
        // 그 사이 제안이 바뀌었거나 거둬졌다(409). 지금 방식을 다시 읽어 다시 보게 한다.
        if (result.status === 409) reload();
        setActionNotice(result.message ?? COMMON_STATE_COPY.saveFailed);
        return;
      }
      setState((current) => (current.status === "ready" ? { ...current, approver: result.data } : current));
      // 확인하면 방식이 바뀌어 앞 방식에서 받은 승인은 다시 받아야 한다. 편지 상태를 새로 읽는다. 거절하면 그대로다.
      if (accept) reload();
    } finally {
      approverSavingRef.current = false;
      setApproverSaving(false);
    }
  }, [liveOwner, state, reload]);

  if (state.status === "loading") return <InvitationStateScreen busy back={{ label: LETTER_COPY.later, onPress: close }} />;
  if (state.status === "failed") {
    return <InvitationStateScreen title={state.message ?? LETTER_STATE_COPY.loadFailed} back={{ label: LETTER_COPY.later, onPress: close }} />;
  }
  if (!shown || !letterState) {
    return (
      <InvitationStateScreen
        title={LETTER_STATE_COPY.needShortlist}
        back={{ label: COMPARE_COPY.back, onPress: close }}
      />
    );
  }

  // 직접 보내기 칸. 서버가 `selfSend` 칸을 주지 않으면 null 이고 아래 시트는 오늘과 똑같다.
  const dirty = server !== null && isLetterDirty(server, body, flags);
  const selfSendView = letterSelfSendView(state.letter, dirty);
  // 직접 보내기에서는 승인 흐름의 말(승인만 저장됨·누구를 기다림)과 승인 칸을 쓰지 않는다.
  const stateNotice = selfSendView ? null : letterStateNotice(letterState);
  const notice = actionNotice ?? (stateNotice ? noticeText(stateNotice, members, letterState.approver.mode) : null);
  const approver = selfSendView ? null : state.approver;
  // 직접 보내기에서도 상대가 이미 낸 승인 방식 제안에는 답할 수 있다(확인·거절만 둔다). 답할 수 없으면 그리지 않는다.
  const proposal = selfSendView && state.approver?.pending?.viewerCanRespond ? state.approver : null;
  const selfSendProps = selfSendView ? {
    title: SELF_SEND_COPY.title(shown.recipients.length),
    hidePartnerRead: true,
    mainAction: {
      label: sending ? SELF_SEND_COPY.saving : SELF_SEND_COPY.save,
      // 저장할 것이 있을 때만 눌린다: 고쳤거나 아직 저장한 판이 없을 때. 승인 방식 제안에 답하는 동안에는 기다린다.
      onPress: (letterState.versionId === null || dirty) && !sending && !approverSaving ? () => {
        void prepare();
      } : undefined,
    },
    selfSend: <SelfSendPanel view={selfSendView} onAskConditions={askConditions} onOpenConsultation={openConsultation} />,
  } : {};
  return (
    <InvitationLetterSheet
      model={shown}
      onToggleShare={(key: LetterShare["key"]) => {
        setActionNotice(null);
        setEditedFlags({ ...flags, [key]: !flags[key] });
      }}
      onChangeBody={(text) => {
        setActionNotice(null);
        setEditedBody(text);
      }}
      onSend={() => {
        void send();
      }}
      onLater={close}
      onNavigate={navigate}
      sendBusy={sending}
      notice={notice}
      approver={approver ? (
        <InvitationApproverPicker
          mode={approver.setting.mode}
          designatedUserId={approver.setting.designatedUserId}
          members={approver.members}
          busy={approverSaving || sending}
          pending={approver.pending ?? null}
          onChoose={(choice) => {
            void chooseApprover(choice);
          }}
          onRespond={(accept) => {
            void respondApprover(accept);
          }}
        />
      ) : proposal ? (
        <InvitationProposalAnswer
          pending={proposal.pending ?? null}
          members={proposal.members}
          busy={approverSaving || sending}
          onRespond={(accept) => {
            void respondApprover(accept);
          }}
        />
      ) : null}
      {...selfSendProps}
    />
  );
}
