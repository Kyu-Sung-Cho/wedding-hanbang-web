function pluralDay(days) {
  return `${Math.abs(days)}일`;
}

export const HOME_SERVICES = Object.freeze([
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
    title: "상담 예약",
    description: "방문과 기록",
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

  const categoryPercentages = categories.map((category) => {
    const categoryProgress = progress?.[category.key];
    const doneById = new Map();

    if (
      categoryProgress
      && typeof categoryProgress === "object"
      && Array.isArray(categoryProgress.checklist)
    ) {
      for (const item of categoryProgress.checklist) {
        if (item && typeof item.id === "string") {
          doneById.set(item.id, item.done === true);
        }
      }
    } else if (categoryProgress && typeof categoryProgress === "object") {
      for (const [key, value] of Object.entries(categoryProgress)) {
        if (typeof value === "boolean") {
          doneById.set(key, value);
        }
      }
    }

    const items = Array.isArray(category.items) ? category.items : [];
    if (items.length === 0) return 0;
    const doneCount = items.filter((item) => doneById.get(item.id) === true).length;
    return (doneCount / items.length) * 100;
  });

  const total = categoryPercentages.reduce((sum, percentage) => sum + percentage, 0);
  return Math.round(total / categoryPercentages.length);
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
      route: "/schedule",
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
        "실제 결제금액과 만족도를 기록하면 두 사람의 예산과 다음 준비가 실제 경험에 맞게 이어져요.",
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
      route: "/schedule",
    };
  }

  return {
    kind: "calm",
    eyebrow: "오늘의 여유",
    title: "오늘은 준비가 잘 흘러가고 있어요",
    description:
      "아모라에게 다음 한 주의 준비 순서를 물어보거나, 둘이 정한 내용을 한 번 더 확인해 보세요.",
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
