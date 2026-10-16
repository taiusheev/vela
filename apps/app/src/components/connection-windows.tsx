import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import type { TodayLight } from "../data/today.ts";
import { space } from "../theme/tokens.ts";
import { Light } from "./light.tsx";
import { Words } from "./ui.tsx";

/** A record of real messages, never an inferred wellbeing score or a streak that resets. */
export function ConnectionWindows({ light }: { light: TodayLight }) {
  const { t, i18n } = useLingui();
  const days = light.connectionDays;
  if (days === undefined) return null;
  const count = days.filter((day) => day.hasMessage).length;
  const name = light.displayName;
  return (
    <View style={{ gap: space.m }}>
      <Words variant="heading">
        <Trans>
          {name} · {count} days with messages
        </Trans>
      </Words>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.xs }}>
        {days.map((day) => {
          const date = new Date(`${day.date}T12:00:00Z`);
          const label = date.toLocaleDateString(i18n.locale, {
            timeZone: "UTC",
            month: "short",
            day: "numeric",
          });
          return (
            <View
              key={day.date}
              accessible
              accessibilityLabel={
                day.hasMessage ? t`${label}: a family message` : t`${label}: no message recorded`
              }
              style={{ alignItems: "center", gap: space.xs, flex: 1 }}
            >
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Light state={day.hasMessage ? "lit" : "resting"} height={44} />
              </View>
              <Words variant="caption" tone="ink2">
                {date.toLocaleDateString(i18n.locale, { timeZone: "UTC", weekday: "narrow" })}
              </Words>
            </View>
          );
        })}
      </View>
      <Words variant="caption" tone="ink2">
        <Trans>A window for each day with a message. Quiet days keep the earlier lights.</Trans>
      </Words>
    </View>
  );
}
