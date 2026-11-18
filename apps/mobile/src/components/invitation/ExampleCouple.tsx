import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  EXAMPLE_COMPARE,
  EXAMPLE_COPY,
  EXAMPLE_JOURNEY,
  EXAMPLE_LETTER,
  type CompareModel,
  type CompareSortId,
  type InvitationRouteKey,
  type JourneyModel,
  type LetterModel,
  type LetterShare,
} from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import InvitationButton from "./InvitationButton";
import { lineHeight, palette, typo } from "./invitationStyle";

/**
 * "예시 커플로 둘러보기"(로그인 없이 보는 예시 화면)의 상태와 이동.
 *
 * 데이터는 `EXAMPLE_*` 만 쓰고 서버를 부르지 않는다. 하트·정렬·스위치·준비 순서 빼기처럼 누르면
 * 바뀌는 것은 이 화면 묶음 안의 기억(React 상태)에만 두고, 예시를 나가면 처음으로 돌아간다.
 * 비교에서 담은 곳이 편지 받는 곳과 개수가 되도록 한 묶음으로 둔다.
 */
type ExampleState = {
  picked: Readonly<Record<string, boolean>>;
  sort: CompareSortId;
  off: ReadonlySet<string>;
  added: ReadonlySet<string>;
  shares: Readonly<Record<LetterShare["key"], boolean>>;
  letterBody: string;
};

type ExampleCouple = {
  compare: CompareModel;
  letter: LetterModel;
  journey: JourneyModel;
  sort: CompareSortId;
  setSort: (sort: CompareSortId) => void;
  togglePick: (hallId: string) => void;
  toggleShare: (key: LetterShare["key"]) => void;
  setLetterBody: (body: string) => void;
  toggleStage: (key: string) => void;
  toggleAddOn: (key: string) => void;
};

const initialState: ExampleState = {
  picked: Object.fromEntries(EXAMPLE_COMPARE.halls.map((hall) => [hall.id, hall.picked])),
  sort: "total",
  off: new Set(EXAMPLE_JOURNEY.rows.filter((row) => row.off).map((row) => row.key)),
  added: new Set(EXAMPLE_JOURNEY.addOns.filter((addOn) => addOn.added).map((addOn) => addOn.key)),
  shares: {
    name: EXAMPLE_LETTER.shares.find((share) => share.key === "name")?.on ?? false,
    phone: EXAMPLE_LETTER.shares.find((share) => share.key === "phone")?.on ?? false,
    budget: EXAMPLE_LETTER.shares.find((share) => share.key === "budget")?.on ?? false,
  },
  letterBody: EXAMPLE_LETTER.body,
};

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

const ExampleCoupleContext = createContext<ExampleCouple | null>(null);

export function ExampleCoupleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ExampleState>(initialState);

  const value = useMemo<ExampleCouple>(() => {
    const halls = EXAMPLE_COMPARE.halls.map((hall) => ({ ...hall, picked: state.picked[hall.id] === true }));
    return {
      compare: { ...EXAMPLE_COMPARE, halls },
      letter: {
        ...EXAMPLE_LETTER,
        recipients: halls.filter((hall) => hall.picked).map((hall) => hall.name),
        body: state.letterBody,
        shares: EXAMPLE_LETTER.shares.map((share) => ({ ...share, on: state.shares[share.key] })),
      },
      journey: {
        rows: EXAMPLE_JOURNEY.rows.map((row) => (row.optional ? { ...row, off: state.off.has(row.key) } : row)),
        addOns: EXAMPLE_JOURNEY.addOns.map((addOn) => ({ ...addOn, added: state.added.has(addOn.key) })),
      },
      sort: state.sort,
      setSort: (sort) => setState((current) => ({ ...current, sort })),
      togglePick: (hallId) =>
        setState((current) => ({ ...current, picked: { ...current.picked, [hallId]: !current.picked[hallId] } })),
      toggleShare: (key) =>
        setState((current) => ({ ...current, shares: { ...current.shares, [key]: !current.shares[key] } })),
      setLetterBody: (letterBody) => setState((current) => ({ ...current, letterBody })),
      toggleStage: (key) => setState((current) => ({ ...current, off: toggled(current.off, key) })),
      toggleAddOn: (key) => setState((current) => ({ ...current, added: toggled(current.added, key) })),
    };
  }, [state]);

  return <ExampleCoupleContext.Provider value={value}>{children}</ExampleCoupleContext.Provider>;
}

export function useExampleCouple(): ExampleCouple {
  const value = useContext(ExampleCoupleContext);
  if (!value) throw new Error("useExampleCouple must be used inside ExampleCoupleProvider");
  return value;
}

/** 화면 이름 → 예시 스택의 주소. 웹 `/example/...` 과 같은 모양이다. */
export const EXAMPLE_ROUTES: Readonly<Record<InvitationRouteKey, { name: string; href: string }>> = {
  home: { name: "index", href: "/example" },
  chat: { name: "chat", href: "/example/chat" },
  journey: { name: "journey", href: "/example/journey" },
  compare: { name: "halls", href: "/example/halls" },
  letter: { name: "letter", href: "/example/letter" },
  status: { name: "consultation", href: "/example/consultation" },
};

type Href = Parameters<typeof router.push>[0];

/**
 * 아티팩트의 링크를 예시 스택 이동으로 바꾼다. 이미 스택에 있는 화면이면 그 화면까지 돌아가고
 * (홈으로·비교로 돌아가기), 없으면 새로 쌓는다.
 */
export function useExampleNavigate(): (route: InvitationRouteKey) => void {
  const navigation = useNavigation();
  return useCallback((route: InvitationRouteKey) => {
    const target = EXAMPLE_ROUTES[route];
    const inStack = navigation.getState()?.routes.some((entry) => entry.name === target.name) ?? false;
    if (inStack) router.dismissTo(target.href as Href);
    else router.push(target.href as Href);
  }, [navigation]);
}

/** 한 화면 뒤로. 뒤가 없으면(바로 들어온 경우) 예시 홈으로 간다. */
export function goBackInExample() {
  if (router.canGoBack()) router.back();
  else router.replace(EXAMPLE_ROUTES.home.href as Href);
}

/** 예시를 나가 시작 화면으로 돌아간다. */
export function leaveExample() {
  router.dismissTo("/" as Href);
}

/**
 * 예시 화면 맨 위의 작고 조용한 한 줄. 업체 이름·가격·사진이 예시라는 것을 늘 함께 보인다
 * (아티팩트 메모: "업체명과 가격도 예시입니다"). 오른쪽에 나가기.
 * 상태 표시줄 아래 공간을 이 띠가 차지하므로, 안의 화면에는 위 안전 영역을 0 으로 넘긴다.
 */
export function ExampleFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.banner, { paddingTop: insets.top + 6 }]}>
        <Text style={[typo.sans, styles.bannerText]}>{EXAMPLE_COPY.banner}</Text>
        <InvitationButton label={EXAMPLE_COPY.leave} onPress={leaveExample} variant="plain" height={28} fontSize={12} weight="500" />
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 6,
    backgroundColor: palette.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.divider,
  },
  bannerText: { flex: 1, fontSize: 12, lineHeight: lineHeight(12, 1.4), color: palette.muted },
  body: { flex: 1 },
});
