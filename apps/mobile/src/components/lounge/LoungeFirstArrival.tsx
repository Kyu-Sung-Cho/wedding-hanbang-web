// 웨딩 라운지 첫 도착 — 방금 말한 것을 되읽고, 다음 걸음 하나를 크게 세운다.
//
// ## 왜 이 순서인가
//
// 온보딩을 막 끝낸 사람에게 라운지는 빈 위젯의 모음이다. 안내(코치마크)가 기능을
// 짚어줘도, 안내를 닫으면 여전히 빈 화면이 남는다. 그런데 그 사람은 방금 예식일과
// 지금 어디까지 왔는지를 **말했다**. 첫 화면이 그걸 되비추지 않으면 자기가 한 입력이
// 어디로 갔는지 모른 채 빈 화면을 본다.
//
//   1) 확인했어요 — 말한 것을 그대로 되읽는다. 판정하지 않는다.
//   2) 다음 걸음 하나 — 눈에 가장 먼저 들어오는 한 장. 고를 것이 많으면 아무것도 못 고른다.
//   3) 초대 — 파트너가 아직 없을 때만.
//
// 무엇을 되읽고 무엇을 다음 걸음으로 세울지는 이 파일이 정하지 않는다. `@hanbang/shared`의
// `buildLoungeFirstRunView`가 웹과 앱에 같은 답을 준다 — 화면마다 문구를 따로 들면
// 한쪽만 고쳐지고, 그건 이 저장소가 이미 초대 코드에서 겪은 사고다.
//
// ## 목적지는 여기서 경로가 된다
//
// 계약은 `destination`이라는 **의미 키**만 준다. 경로 문자열을 계약에 적으면 앱이 화면을
// 옮길 때 웹이 죽은 링크를 열게 된다. 그래서 매핑은 각 앱이 자기 라우트로 들고 있고,
// 이 파일의 switch가 모바일 쪽 정본이다.
import { Fragment } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { router } from "expo-router";
import { ArrowRight, Check, UsersRound } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import type {
  LoungeFirstRunDestination,
  LoungeFirstRunView,
} from "@hanbang/shared";
import { AppText, appShadow } from "@/components/ui/AppUI";
import { FirstRunAnchor } from "@/components/lounge/FirstRunAnchors";

/**
 * 의미 키를 모바일 라우트로 옮긴다. 여기 적힌 다섯 곳은 전부 `apps/mobile/app` 아래에
 * 실제로 있는 화면이고, 그 사실은 테스트가 파일 존재로 확인한다.
 */
function openDestination(destination: LoungeFirstRunDestination) {
  switch (destination) {
    // 첫 도착 카드에서 온 사람은 "이제 막 시작했다"고 방금 말한 사람이다. 그 맥락을
    // `entry`로 들려 보내면 대화 화면이 입력창에 그 사람의 말로 초안을 놓아준다 —
    // 같은 목적지라도 FAB·전폭 카드에서 온 사람과 첫 줄이 달라진다.
    case "amora":
      router.push("/(tabs)/chat?entry=lounge_first_arrival");
      return;
    case "checklist":
      router.push("/checklist");
      return;
    case "budget":
      router.push("/budget");
      return;
    case "schedule":
      router.push("/schedule");
      return;
    case "price":
      router.push("/market-prices");
  }
}

/**
 * 초대 코드는 설정의 "커플 연결"에 있다. 앱의 `/invite`는 파트너가 보낸 링크로 앱이
 * 열렸을 때의 착지 화면이라 내 코드를 보여주지 않는다 — 거기로 보내면 빈손으로 돌아온다.
 */
function openInvite() {
  router.push("/settings");
}

interface LoungeFirstArrivalProps {
  view: LoungeFirstRunView;
}

export default function LoungeFirstArrival({ view }: LoungeFirstArrivalProps) {
  // 카드들을 하나의 View로 감싸지 않는 이유: 첫 실행 안내는 앵커의 onLayout y로 스크롤
  // 위치를 잡는데 그 y는 부모 기준이다. 감싸면 초대 카드의 y가 스크롤 콘텐츠 기준이
  // 아니게 되고, 안내가 엉뚱한 데로 스크롤한 뒤 그 단계를 조용히 건너뛴다.
  return (
    <Fragment>
      {view.echo.length > 0 ? (
        <View style={styles.echoCard}>
          <AppText variant="eyebrow" style={styles.echoEyebrow}>
            확인했어요
          </AppText>
          <View style={styles.echoList}>
            {view.echo.map((line) => (
              <View key={line.label} style={styles.echoRow}>
                <View style={styles.echoCheck}>
                  <Check size={12} color={colors.sage[500]} />
                </View>
                <Text style={styles.echoLabel}>{line.label}</Text>
                <Text style={styles.echoValue} numberOfLines={2}>
                  {line.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {view.echo.length > 0 ? <Pressable
        style={({ pressed }) => [styles.nextCard, pressed && styles.cardPressed]}
        onPress={() => openDestination(view.nextStep.destination)}
        accessibilityRole="button"
        accessibilityLabel={`${view.nextStep.title}. ${view.nextStep.cta}`}
      >
        <AppText variant="eyebrow" style={styles.nextEyebrow}>
          다음 걸음 하나
        </AppText>
        <Text style={styles.nextTitle}>{view.nextStep.title}</Text>
        <Text style={styles.nextBody}>{view.nextStep.body}</Text>
        <View style={styles.nextAction}>
          <Text style={styles.nextActionText}>{view.nextStep.cta}</Text>
          <ArrowRight size={16} color={colors.surface} />
        </View>
      </Pressable> : null}

      {view.invite ? (
        // 첫 실행 안내의 "파트너를 부르면 같이 봐요"가 가리킬 곳. 이 카드가 없는 사람
        // (이미 연결된 커플)에게는 앵커도 없고, 안내는 그 단계를 조용히 건너뛴다.
        <FirstRunAnchor id="lounge-invite" style={styles.inviteAnchor}>
          <Pressable
            style={({ pressed }) => [
              styles.inviteCard,
              pressed && styles.cardPressed,
            ]}
            onPress={openInvite}
            accessibilityRole="button"
            accessibilityLabel={`${view.invite.title}. ${view.invite.cta}`}
          >
            <View style={styles.inviteIcon}>
              <UsersRound size={18} color={colors.rose[600]} />
            </View>
            <View style={styles.inviteCopy}>
              <Text style={styles.inviteTitle}>{view.invite.title}</Text>
              <Text style={styles.inviteBody}>{view.invite.body}</Text>
              <View style={styles.inviteAction}>
                <Text style={styles.inviteActionText}>{view.invite.cta}</Text>
                <ArrowRight size={14} color={colors.rose[600]} />
              </View>
            </View>
          </Pressable>
        </FirstRunAnchor>
      ) : null}
    </Fragment>
  );
}

/**
 * 빈 위젯 옆에 붙는 한 줄. 왜 아직 비어 있고 무엇이 채우는지 말한다.
 *
 * 빈 화면을 설명 없이 두면 사람은 앱이 고장 났다고 읽는다. 그렇다고 없는 진척을 지어내
 * 채우는 것은 더 나쁘다 — 그래서 채우는 대신 이유를 적는다.
 */
export function LoungeEmptyNote({ note }: { note: string }) {
  if (!note) return null;
  return (
    <View style={styles.emptyNote}>
      <Text style={styles.emptyNoteText}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  echoCard: {
    marginBottom: spacing[4],
    padding: spacing[4],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[100],
  },
  echoEyebrow: {
    color: colors.sage[500],
  },
  echoList: {
    marginTop: spacing[3],
    gap: spacing[2],
  },
  echoRow: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  echoCheck: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.sage.pale,
  },
  echoLabel: {
    minWidth: 76,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  echoValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  nextCard: {
    marginBottom: spacing[4],
    padding: spacing[5],
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderColor: colors.rose.pale,
    backgroundColor: colors.surface,
    ...appShadow,
    shadowOpacity: 0.09,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  nextEyebrow: {
    color: colors.rose[600],
  },
  nextTitle: {
    marginTop: spacing[2],
    fontSize: 21,
    lineHeight: 29,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[900],
  },
  nextBody: {
    marginTop: spacing[2],
    fontSize: 13,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  nextAction: {
    alignSelf: "flex-start",
    minHeight: 44,
    marginTop: spacing[4],
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.noir[800],
  },
  nextActionText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.surface,
  },
  inviteAnchor: {
    marginBottom: spacing[4],
  },
  inviteCard: {
    padding: spacing[4],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.rose.pale,
    backgroundColor: colors.rose.glow,
  },
  inviteIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  inviteCopy: {
    flex: 1,
  },
  inviteTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  inviteBody: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  inviteAction: {
    minHeight: 32,
    marginTop: spacing[1],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  inviteActionText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  emptyNote: {
    marginBottom: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.xl,
    backgroundColor: colors.ivory[100],
  },
  emptyNoteText: {
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
});
