import { useLingui } from "@lingui/react/macro";
import { Pressable, View } from "react-native";
import { dayName, localDayMonth, localMonth, shortDayName } from "../data/format.ts";
import { calendarWeeks } from "../data/question-schedule.ts";
import { usePalette } from "../theme/theme.tsx";
import { space, type } from "../theme/tokens.ts";
import { Text } from "./scaled-text.tsx";

/** What a morning already holds: a question planned for her, or one that leaves no room for another. */
export type MorningMark = "planned" | "taken";

/**
 * The next two weeks of her mornings as one small calendar, Monday first, so a day is chosen with a
 * tap instead of read out of fourteen buttons (founder, 24 Oct 2026). A planned morning carries a
 * small amber light; the chosen one is filled with the action's espresso.
 */
export function MorningCalendar({
  dates,
  selected,
  marks,
  tomorrow,
  disabled = false,
  onSelect,
}: {
  /** The mornings that can be chosen, first one first: `questionDates`. */
  dates: readonly string[];
  selected?: string | undefined;
  marks?: ReadonlyMap<string, MorningMark>;
  tomorrow?: string;
  disabled?: boolean;
  onSelect: (date: string) => void;
}) {
  const { t } = useLingui();
  const p = usePalette();
  const weeks = calendarWeeks(dates);
  const open = new Set(dates);
  const first = dates[0];
  const last = dates.at(-1);
  if (first === undefined || last === undefined || weeks[0] === undefined) return null;
  const months = [localMonth(first), localMonth(last)];
  return (
    <View style={{ gap: space.s }}>
      <Text accessibilityRole="header" style={[type.label, { letterSpacing: 0, color: p.ink2 }]}>
        {months[0] === months[1] ? months[0] : `${months[0]} – ${months[1]}`}
      </Text>
      <View style={{ flexDirection: "row" }}>
        {weeks[0].map((date) => (
          <Text
            key={date}
            importantForAccessibility="no"
            style={[
              type.caption,
              { flex: 1, textAlign: "center", fontSize: 12, lineHeight: 16, color: p.ink3 },
            ]}
          >
            {shortDayName(date)}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={{ flexDirection: "row" }}>
          {week.map((date) => {
            const inRange = open.has(date);
            const mark = marks?.get(date);
            const chosen = inRange && date === selected;
            const blocked = disabled || mark === "taken";
            const label = `${dayName(date)}, ${localDayMonth(date)}`;
            const named = date === tomorrow ? t`Tomorrow, ${label}` : label;
            if (!inRange)
              return (
                <View
                  key={date}
                  importantForAccessibility="no-hide-descendants"
                  style={{ flex: 1, height: 48, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={[type.body, { color: p.ink3, opacity: 0.4 }]}>
                    {Number(date.slice(8))}
                  </Text>
                </View>
              );
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityLabel={
                  mark === "planned"
                    ? t`${named}, a question is planned`
                    : mark === "taken"
                      ? t`${named}, another question is planned`
                      : named
                }
                accessibilityState={{ selected: chosen, disabled: blocked }}
                disabled={blocked}
                onPress={() => onSelect(date)}
                style={({ pressed }) => ({
                  flex: 1,
                  height: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: chosen
                      ? p.action
                      : mark === "planned"
                        ? p.lightSoft
                        : "transparent",
                    borderWidth: date === tomorrow && !chosen ? 1.5 : 0,
                    borderColor: p.control,
                  }}
                >
                  <Text
                    style={[
                      type.bodyMedium,
                      {
                        fontSize: 16,
                        lineHeight: 20,
                        color: chosen ? p.onAction : blocked ? p.ink3 : p.ink,
                      },
                    ]}
                  >
                    {Number(date.slice(8))}
                  </Text>
                  {mark === undefined ? null : (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 5,
                        width: 5,
                        height: 5,
                        borderRadius: 3,
                        backgroundColor: chosen
                          ? p.onAction
                          : mark === "planned"
                            ? p.light
                            : p.control,
                      }}
                    />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
      {Array.from(marks?.values() ?? []).includes("taken") ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: p.control }} />
          <Text style={[type.caption, { color: p.ink2 }]}>
            {t`A dot means that morning already has a question.`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
