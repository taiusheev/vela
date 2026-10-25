import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";
import { shortDayName } from "../data/format.ts";
import type { TodayLight } from "../data/today.ts";
import { weekWindows } from "../data/week-windows.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space, type } from "../theme/tokens.ts";
import { Light } from "./light.tsx";
import { Text } from "./scaled-text.tsx";

const WINDOW = 46;

/** The warm glow a lit window throws on the wall around it. */
function WindowGlow({ id }: { id: string }) {
  const palette = usePalette();
  const size = WINDOW * 1.9;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: size,
        height: size,
        left: "50%",
        top: "50%",
        marginLeft: -size / 2,
        marginTop: -size / 2,
      }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset={0} stopColor={palette.light} stopOpacity={0.45} />
            <Stop offset={0.55} stopColor={palette.light} stopOpacity={0.14} />
            <Stop offset={1} stopColor={palette.light} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={size / 2} cy={size / 2} rx={size / 2} ry={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * This week's windows at the top of Sunday: a record of real messages between her and the family,
 * never an inferred wellbeing score, and never a streak that resets on a quiet day. The windows
 * speak for themselves, so the card carries no explanation; each day's label says it for a reader.
 */
export function ConnectionWindows({ light }: { light: TodayLight }) {
  const palette = usePalette();
  const { t } = useLingui();
  const days = light.connectionDays;
  if (days === undefined || days.length === 0) return null;
  const week = weekWindows(days);
  const count = week.filter((day) => day.hasMessage).length;
  const sofar = week.filter((day) => !day.ahead).length;
  const name = light.displayName;
  return (
    <View
      style={{
        backgroundColor: palette.lightSoft,
        borderRadius: radius.card + 8,
        paddingHorizontal: space.l,
        paddingTop: space.l,
        paddingBottom: space.m,
        gap: space.l,
        overflow: "hidden",
      }}
    >
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={[type.title, { color: palette.ink }]}>
          <Trans>You and {name}</Trans>
        </Text>
        <Text style={[type.body, { color: palette.ink2 }]}>
          {sofar === 7
            ? plural(count, {
                one: "# day with messages this week",
                other: "# days with messages this week",
              })
            : plural(count, {
                one: "# day with messages so far",
                other: "# days with messages so far",
              })}
        </Text>
      </View>
      <View>
        <View style={{ flexDirection: "row" }}>
          {week.map((day) => {
            const label = shortDayName(day.date);
            return (
              <View
                key={day.date}
                accessible
                accessibilityLabel={
                  day.ahead
                    ? t`${label}: still to come`
                    : day.hasMessage
                      ? t`${label}: a family message`
                      : t`${label}: no message recorded`
                }
                style={{ alignItems: "center", flex: 1 }}
              >
                <View
                  style={{
                    height: WINDOW + space.m,
                    justifyContent: "flex-end",
                    alignItems: "center",
                    opacity: day.ahead ? 0.3 : 1,
                  }}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {day.hasMessage ? <WindowGlow id={`week-glow-${day.date}`} /> : null}
                  <Light state={day.hasMessage ? "lit" : "resting"} height={WINDOW} />
                </View>
              </View>
            );
          })}
        </View>
        {/* The sill the week's windows sit on. */}
        <View
          style={{
            height: 3,
            borderRadius: 2,
            marginTop: space.s,
            backgroundColor: palette.lightDeep,
            opacity: 0.22,
          }}
        />
        <View style={{ flexDirection: "row", marginTop: space.s }}>
          {week.map((day) => (
            <View key={day.date} style={{ flex: 1, alignItems: "center" }}>
              <View
                style={{
                  paddingHorizontal: space.s,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: day.today ? palette.action : "transparent",
                }}
              >
                <Text
                  style={[
                    type.caption,
                    {
                      fontSize: 13,
                      lineHeight: 17,
                      color: day.today ? palette.onAction : palette.ink2,
                      fontFamily: day.today ? type.button.fontFamily : type.caption.fontFamily,
                    },
                  ]}
                >
                  {shortDayName(day.date)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
