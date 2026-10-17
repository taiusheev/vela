import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Text, View } from "react-native";
import { shortDayName } from "../data/format.ts";
import type { TodayLight } from "../data/today.ts";
import { weekWindows } from "../data/week-windows.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space, type } from "../theme/tokens.ts";
import { Light } from "./light.tsx";

/**
 * This week's windows at the top of Sunday: a record of real messages between her and the family,
 * never an inferred wellbeing score, and never a streak that resets on a quiet day.
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
        paddingBottom: space.l,
        gap: space.l,
      }}
    >
      <View style={{ gap: space.xs }}>
        <Text style={[type.label, { color: palette.ink2, textTransform: "uppercase" }]}>
          <Trans>This week</Trans>
        </Text>
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
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
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
              style={{ alignItems: "center", gap: space.s, flex: 1 }}
            >
              <View
                style={{ opacity: day.ahead ? 0.35 : 1 }}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Light state={day.hasMessage ? "lit" : "resting"} height={40} />
              </View>
              <Text
                style={[
                  type.caption,
                  {
                    color: day.today ? palette.ink : palette.ink2,
                    fontFamily: day.today ? type.heading.fontFamily : type.caption.fontFamily,
                  },
                ]}
              >
                {label}
              </Text>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: day.today ? palette.lightDeep : "transparent",
                }}
              />
            </View>
          );
        })}
      </View>
      <Text style={[type.caption, { color: palette.ink2 }]}>
        <Trans>
          A window lights on each day you and {name} share a message. A quiet day never takes the
          earlier lights away, and Monday starts a new row.
        </Trans>
      </Text>
    </View>
  );
}
