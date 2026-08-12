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
  {
    key: "bookings",
    title: "상담 요청 기록",
    description: "아모라 내부 후보",
    route: "/bookings",
  },
  {
    key: "community",
    title: "커뮤니티",
    description: "같은 시기 커플",
    route: "/(tabs)/community",
  },
]);

export function formatLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateChecklistProgress(progress, categories) {
  if (!Array.isArray(categories) || categories.length === 0) return 0;

  let done = 0;
  let total = 0;
  const savedCategoryKeys = new Set(Object.keys(progress ?? {}));
  for (const category of categories) {
    if (!isChecklistCategoryActivated(category, savedCategoryKeys)) {
      continue;
    }

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

  return total > 0 ? Math.round((done / total) * 100) : 0;
}

export function isChecklistCategoryActivated(category, savedCategoryKeys) {
  return (category?.introducedInVersion ?? 1) === 1
    || savedCategoryKeys.has(category.key);
}

export function shouldSurfaceChecklistCategory(category, dday) {
  if (dday === null) return category?.journeyStage !== "aftercare";
  if (dday < 0) return category?.ddayDeadline < 0;
  if (dday === 0) return category?.journeyStage === "ceremony";

  return (
    category?.journeyStage !== "aftercare"
    && dday <= category.ddayStart
  );
}

export function buildDashboardFocus({
  weddingDate,
  todayTasks,
  urgentTasks,
  bookingOutcomeTasks,
}) {
  if (!weddingDate) {
    return {
      kind: "setup",
      eyebrow: "첫 번째 준비",
      title: "결혼식 날짜를 알려주세요",
      description:
        "날짜를 저장하면 두 사람의 일정에 맞춰 오늘 할 일과 준비 순서를 정리해 드려요.",
      ctaLabel: "결혼식 날짜 설정",
      route: "/onboarding",
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
    return "두 사람만의 결혼 준비, 오늘부터 함께 시작해요";
  }
  if (dday === 0) {
    return "오늘, 두 사람의 결혼을 진심으로 축하해요";
  }
  if (dday < 0) {
    return "함께 만든 그날 이후의 이야기까지 이어가요";
  }
  return "두 사람이 고른 날까지, 오늘도 한 걸음 가까워졌어요";
}
