function pluralDay(days) {
  return `${Math.abs(days)}일`;
}

export const HOME_SERVICES = Object.freeze([
  {
    key: "checklist",
    title: "체크리스트",
    description: "준비 항목",
    route: "/checklist",
  },
  {
    key: "schedule",
    title: "일정",
    description: "오늘 할 일",
    route: "/schedule",
  },
  {
    key: "budget",
    title: "예산",
    description: "지출과 분담",
    route: "/budget",
  },
  {
    key: "prices",
    title: "공시가·위약금",
    description: "업체 원문",
    route: "/market-prices",
  },
  {
    key: "quote",
    title: "견적 체크",
    description: "계약 전 질문",
    route: "/quote-check",
  },
  // 업체 상담·예약 요청은 2026-07-15부터 꺼져 있다. 이 칸은 새 요청을 받는 곳이 아니라
  // 이미 남긴 기록을 되돌아보는 곳이고, 라운지는 기록이 있는 사람에게만 보여준다
  // (`buildHomeServices`). 예전 설명 "아모라 내부 후보"는 지금도 후보를 고를 수 있는 것처럼 읽혔다.
  {
    key: "bookings",
    title: "상담 요청 기록",
    description: "지난 기록 보기",
    route: "/bookings",
  },
  {
    key: "community",
    title: "커뮤니티",
    description: "같은 시기 커플",
    route: "/(tabs)/community",
  },
]);

/**
 * 라운지 준비 도구 격자에 실제로 놓을 칸.
 *
 * 「상담 요청 기록」은 이미 남긴 기록이 있을 때만 둔다(2026-09-18 파운더 결정: 숨긴다).
 * 새 요청을 만들 수 없는데 모든 사람에게 그 칸을 보여주면, 누른 사람은 빈 화면과
 * 따라갈 수 없는 안내만 만난다. 기록이 있는 사람은 지난 기록으로 가는 길을 잃지 않는다.
 * 확인하지 못한 경우(undefined)는 없는 것으로 본다 — 틀린 입구가 먼저 뜨는 것보다 낫다.
 */
export function buildHomeServices({ hasBookingRecords } = {}) {
  return HOME_SERVICES.filter(
    (service) => service.key !== "bookings" || hasBookingRecords === true,
  );
}

export function formatLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 체크리스트 항목 수. 라운지 히어로의 %와 합류 안내의 "n/m개 체크"가 같은 수에서 나오도록
 * 한 곳에서 센다 — 둘을 따로 세면 같은 화면에서 두 숫자가 어긋난다.
 */
export function calculateChecklistCounts(progress, categories) {
  if (!Array.isArray(categories) || categories.length === 0) return { done: 0, total: 0 };

  let done = 0;
  let total = 0;
  for (const category of categories) {
    const categoryProgress = progress?.[category.key];
    if (categoryProgress?.status === "not_applicable") continue;
    const doneById = new Map();

    const items = Array.isArray(category.items) ? category.items : [];
    for (const item of items) {
      if (item && typeof item.id === "string") doneById.set(item.id, false);
    }

    if (
      categoryProgress
      && typeof categoryProgress === "object"
      && Array.isArray(categoryProgress.checklist)
    ) {
      for (const item of categoryProgress.checklist) {
        if (item && typeof item.id === "string" && !doneById.has(`saved:${item.id}`)) {
          doneById.set(item.id, item.done === true);
          doneById.set(`saved:${item.id}`, true);
        }
      }
    } else if (categoryProgress && typeof categoryProgress === "object") {
      for (const [key, value] of Object.entries(categoryProgress)) {
        if (typeof value === "boolean") {
          doneById.set(key, value);
        }
      }
    }

    for (const key of [...doneById.keys()]) {
      if (key.startsWith("saved:")) doneById.delete(key);
    }
    done += [...doneById.values()].filter(Boolean).length;
    total += doneById.size;
  }

  return { done, total };
}

export function calculateChecklistProgress(progress, categories) {
  const { done, total } = calculateChecklistCounts(progress, categories);
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

export function buildDashboardFocus({
  weddingDate,
  todayTasks,
  urgentTasks,
  bookingOutcomeTasks,
}) {
  if (!weddingDate) {
    // 날짜 한 줄을 고치러 온보딩 6단계를 다시 걷게 하지 않는다. 온보딩은 역할과 커플 연결을
    // 처음부터 다시 묻는 화면이라, 역할을 처음과 다르게 고르면 서버가 커플 구성이 어긋났다고
    // 돌려주고 사람은 "고객 지원에 문의해주세요"에서 끝난다. 결혼 정보는 설정 화면에 이미
    // 편집 가능한 필드로 있다.
    return {
      kind: "setup",
      eyebrow: "첫 번째 준비",
      title: "결혼식 날짜를 알려주세요",
      description:
        "날짜를 저장하면 D-day가 보여요. 확인할 시기가 된 준비는 이 화면에 올라와요.",
      ctaLabel: "결혼식 날짜 설정",
      route: "/settings",
    };
  }

  const urgent = urgentTasks.find(
    (task) => task.urgency === "overdue" || task.urgency === "soon",
  );
  if (urgent) {
    const description =
      urgent.urgency === "overdue"
        ? `기본 확인 시점에서 ${pluralDay(urgent.remainingDays)} 지났어요. 실제 계약·업체 일정이 우선이에요.`
        : urgent.remainingDays === 0
          ? "오늘이 기본 확인 시점이에요. 실제 계약·업체 일정이 우선이에요."
          : `기본 확인 시점까지 ${pluralDay(urgent.remainingDays)} 남았어요. 실제 계약·업체 일정이 우선이에요.`;

    return {
      kind: "urgent",
      eyebrow: "오늘, 이것부터",
      title: `${urgent.categoryLabel} 준비를 먼저 확인해요`,
      description,
      ctaLabel: "체크리스트 열기",
      route: "/checklist",
    };
  }

  const todayTask = todayTasks[0];
  if (todayTask) {
    const remainingCount = Math.max(0, todayTasks.length - 1);
    return {
      kind: "today",
      eyebrow: "오늘, 이것부터",
      title: todayTask.title,
      description:
        remainingCount > 0
          ? `오늘 저장한 할 일이 ${remainingCount}개 더 있어요. 하나씩 마치면 충분해요.`
          : "오늘 일정에 저장한 항목이에요. 하나를 끝내고 가볍게 다음으로 넘어가요.",
      ctaLabel: "오늘 일정 보기",
      route: "/schedule",
    };
  }

  const booking = bookingOutcomeTasks[0];
  if (booking) {
    return {
      kind: "booking",
      eyebrow: "다녀온 뒤 기록",
      title: `${booking.vendorName} 결과를 남겨주세요`,
      description:
        "실제 진행 여부를 직접 확인한 뒤, 사용자가 입력한 기록 지출과 만족도를 남겨보세요. 이 입력값은 결제 증빙이 아니에요.",
      ctaLabel: "결과 기록하기",
      route: "/bookings",
      bookingId: booking.id,
    };
  }

  const nextTask = urgentTasks[0];
  if (nextTask) {
    return {
      kind: "next",
      eyebrow: "다음 준비",
      title: `${nextTask.categoryLabel}을 천천히 시작해요`,
      description:
        "아직 여유가 있어요. 체크리스트를 보고 두 사람에게 맞는 순서로 준비해요.",
      ctaLabel: "준비 순서 보기",
      route: "/checklist",
    };
  }

  return {
    kind: "calm",
    eyebrow: "저장된 일정 확인",
    title: "현재 저장된 일정 기준, 오늘 확인 항목이 없어요",
    description:
      "등록하지 않은 일정과 실제 계약·업체·가족 일정은 포함되지 않아요. 필요하면 아모라와 다음 준비를 정리해 보세요.",
    ctaLabel: "아모라와 계획하기",
    route: "/(tabs)/chat",
  };
}

export function getWeddingMomentMessage(dday) {
  if (dday === null) {
    return "아직 못 정했어도 오늘부터 시작할 수 있어요";
  }
  if (dday === 0) {
    return "오늘, 두 사람의 결혼을 진심으로 축하해요";
  }
  if (dday < 0) {
    return "함께 만든 그날 이후의 이야기까지 이어가요";
  }
  return "두 사람이 고른 날까지, 오늘도 한 걸음 가까워졌어요";
}
