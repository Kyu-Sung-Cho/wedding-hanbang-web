import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@hanbang/design-tokens";
import {
  PREPARATION_PROGRESS_CATEGORY_KEYS,
  PREPARATION_PROGRESS_STATUS_OPTIONS,
  createPreparationProgressItems,
  defaultPreparationProgressStatus,
  type PreparationProgressCategoryKey,
  type PreparationProgressStatus,
} from "@hanbang/shared";

/**
 * 19항목의 목록·순서·라벨·상태 어휘를 전부 `@hanbang/shared` 정본에서 가져온다.
 *
 * 예전에는 카테고리 템플릿에서 키를 뽑아 라벨 사전으로 걸러 목록을 만들었다. 지금
 * 19개와 우연히 같았을 뿐, 템플릿에 카테고리가 하나 늘면 앱은 서버가 모르는 키를
 * 보낸다. 그때 서버는 그 항목만 버리는 게 아니라 **온보딩 요청 전체를 400으로
 * 거절한다** — 카테고리 하나 추가했다가 앱 온보딩이 통째로 막히는 구조였다.
 *
 * 상태 네 갈래도 여기 적지 않는다. 앱과 웹이 서로 다른 말을 고르면 같은 커플의 두
 * 사람이 같은 데이터를 다르게 보게 된다.
 */
const PREPARATION_PROGRESS_ITEMS = createPreparationProgressItems();

export type PreparationStatusMap = Record<
  PreparationProgressCategoryKey,
  PreparationProgressStatus
>;

/**
 * 고른 단계의 제안값으로 화면 초깃값을 만든다.
 *
 * 여기서 만든 값은 화면에만 있다. 사용자가 이 화면을 보고 저장을 눌러야 서버로
 * 가고, 건너뛰면 한 항목도 저장되지 않는다 — 확인하지 않은 "완료"는 체크리스트
 * 완료율과 예산을 사실이 아닌 쪽으로 밀어버린다.
 */
export function createPreparationStatuses(
  suggested?: Partial<
    Record<PreparationProgressCategoryKey, PreparationProgressStatus>
  >,
): PreparationStatusMap {
  const statuses = {} as PreparationStatusMap;
  for (const key of PREPARATION_PROGRESS_CATEGORY_KEYS) {
    // 시작 상태도 정본에서 온다. 안 하는 집이 더 많은 분야는 체크리스트에서 "안 해요"로
    // 시작하는데 여기만 "아직"으로 물으면 같은 분야를 두 화면이 다르게 말한다.
    statuses[key] = suggested?.[key] ?? defaultPreparationProgressStatus(key);
  }
  return statuses;
}

/**
 * 서버로 보낼 자격이 있는 것만 남긴다.
 *
 * 시작 상태와 같은 값은 사용자가 새로 말한 것이 아니다. 그대로 보내면 파트너가 이미
 * 켜 둔 분야가 이쪽 기본값으로 되돌아간다 — `not_started` 를 안 보내는 이유와 같고
 * (`onboardingFirstValue.mjs`), 기본값이 분야마다 다를 뿐이다.
 */
export function withoutDefaultPreparationStatuses(
  statuses: PreparationStatusMap,
): Record<string, PreparationProgressStatus> {
  const changed: Record<string, PreparationProgressStatus> = {};
  for (const key of PREPARATION_PROGRESS_CATEGORY_KEYS) {
    if (statuses[key] === defaultPreparationProgressStatus(key)) continue;
    changed[key] = statuses[key];
  }
  return changed;
}

interface PreparationProgressListProps {
  statuses: PreparationStatusMap;
  onChange: (
    key: PreparationProgressCategoryKey,
    status: PreparationProgressStatus,
  ) => void;
  disabled?: boolean;
}

export default function PreparationProgressList({
  statuses,
  onChange,
  disabled = false,
}: PreparationProgressListProps) {
  const answered = PREPARATION_PROGRESS_CATEGORY_KEYS.filter(
    (key) => statuses[key] !== defaultPreparationProgressStatus(key),
  ).length;

  return (
    <View style={styles.container}>
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          보통 이 단계면 이 정도예요. 다르면 바꿔주세요.
        </Text>
        <Text style={styles.noticeSubText}>
          여기서 고른 상태는 저장을 눌러야 기록돼요. 건너뛰면 아무 항목도 저장하지 않아요.
        </Text>
      </View>

      <Text style={styles.summaryText}>
        {answered === 0
          ? "아직 표시한 항목이 없어요"
          : `${answered}개 항목의 현재 상태를 표시했어요`}
      </Text>

      {PREPARATION_PROGRESS_ITEMS.map(({ key, label }) => {
        const current = statuses[key];
        return (
          <View key={key} style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <View style={styles.statusRow}>
              {PREPARATION_PROGRESS_STATUS_OPTIONS.map((option) => {
                const selected = current === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[
                      styles.statusChip,
                      selected && styles.statusChipActive,
                      disabled && styles.statusChipDisabled,
                    ]}
                    onPress={() => !disabled && onChange(key, option.value)}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} ${option.label}`}
                    accessibilityState={{ selected, disabled }}
                  >
                    <Text
                      style={[
                        styles.statusChipLabel,
                        selected && styles.statusChipLabelActive,
                      ]}
                      numberOfLines={1}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },

  notice: {
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noticeText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
    lineHeight: 19,
  },
  noticeSubText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    lineHeight: 18,
  },

  summaryText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginBottom: 2,
  },

  row: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  rowLabel: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  statusRow: {
    flexDirection: "row",
    gap: 6,
  },
  statusChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.ivory[200],
    borderWidth: 1,
    borderColor: "transparent",
  },
  statusChipActive: {
    backgroundColor: colors.rose.pale + "30",
    borderColor: colors.rose[500],
  },
  statusChipDisabled: {
    opacity: 0.4,
  },
  statusChipLabel: {
    fontSize: 11,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
  },
  statusChipLabelActive: {
    color: colors.rose[500],
  },
});
