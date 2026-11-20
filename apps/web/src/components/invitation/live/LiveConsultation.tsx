"use client";

import { useRouter } from "next/navigation";
import {
  CONSULTATION_STATE_COPY,
  EXAMPLE_CONSULTATION,
  STATUS_COPY,
  type ConsultationModel,
} from "@hanbang/shared/invitation";

import { weddingPath } from "@/lib/weddingPaths";

import InvitationConsultation from "../InvitationConsultation";
import { DemoExampleNote, LiveColumn, LiveLoadingScreen, LiveMessageScreen, LiveNotice } from "./LiveParts";
import { LIVE_SCHEDULE_PATH, livePhotoSrc, liveRoute } from "./liveRoutes";
import { LIVE_RETRY_LABEL, loadFailedMessage } from "./liveStateCopy";
import { useInvitationConsultation } from "./useInvitationHome";
import { useLiveIdentity } from "./useLiveIdentity";

const BACK_HOME = { href: liveRoute("home"), label: STATUS_COPY.back };

/**
 * 답장과 상담 확정(`/halls/consultation`) 실제 커플 화면(`Status.dc`).
 *
 * 확정된 상담이 없으면 `CONSULTATION_STATE_COPY.none` 을 보인다. 일정에 넣는 것은 커플이 "일정에 넣기"를 누를 때만
 * (POST `/consultation/schedule`)이고, 이미 일정에 있으면 "캘린더에 있어요"가 일정 화면을 연다.
 *
 * 아티팩트와 다른 점(이유): 업체에 다른 시간을 요청하거나 묻는 단추("이 시간으로 요청", "다른 시간 묻기")와 상대에게
 * 공유하는 단추는 그리지 않는다. 그 일을 하는 서버 경로가 아직 없어 눌러도 아무 일이 없기 때문이다(상담 자체는
 * 이미 두 사람이 함께 본다). 소식 글은 그대로 보인다.
 */
export default function LiveConsultation() {
  const identity = useLiveIdentity();
  const consultation = useInvitationConsultation(identity);
  const router = useRouter();

  if (identity.isDemo) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <DemoExampleNote />
        <LiveColumn>
          <InvitationConsultation model={EXAMPLE_CONSULTATION} resolveRoute={liveRoute} photoSrc={livePhotoSrc} />
        </LiveColumn>
      </div>
    );
  }

  const data = consultation.data;
  if (!data) {
    if (consultation.loading) return <LiveLoadingScreen back={BACK_HOME} />;
    return (
      <LiveColumn>
        <LiveMessageScreen
          back={BACK_HOME}
          tone="error"
          text={loadFailedMessage(consultation.failure, CONSULTATION_STATE_COPY.loadFailed)}
          action={{ label: LIVE_RETRY_LABEL, onClick: consultation.reload }}
        />
      </LiveColumn>
    );
  }
  if (!data.consultation) {
    // 잡힌 상담이 없어도 커플이 직접 넣은 일정은 일정 화면에 있다. 그리로 가는 단추를 둔다.
    return (
      <LiveColumn>
        <LiveMessageScreen
          back={BACK_HOME}
          text={CONSULTATION_STATE_COPY.none}
          sub={CONSULTATION_STATE_COPY.noneSub}
          action={{ label: CONSULTATION_STATE_COPY.fullSchedule, href: weddingPath(LIVE_SCHEDULE_PATH) }}
        />
      </LiveColumn>
    );
  }

  const model: ConsultationModel = { ...data.consultation, partnerName: null, updateActions: [] };
  const openSchedule = () => router.push(weddingPath(LIVE_SCHEDULE_PATH));
  const calendarAction = data.inCalendar
    ? { label: consultation.added ? CONSULTATION_STATE_COPY.added : STATUS_COPY.inCalendar, onClick: openSchedule }
    : {
      label: CONSULTATION_STATE_COPY.addToCalendar,
      onClick: () => void consultation.addToCalendar(),
      busy: consultation.adding,
    };

  return (
    <LiveColumn>
      <InvitationConsultation
        model={model}
        resolveRoute={liveRoute}
        photoSrc={livePhotoSrc}
        calendarAction={calendarAction}
        notice={consultation.addFailed ? <LiveNotice tone="error">{consultation.addFailed}</LiveNotice> : null}
      />
    </LiveColumn>
  );
}
