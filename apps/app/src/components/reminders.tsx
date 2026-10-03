import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { View } from "react-native";
import { dayName } from "../data/format.ts";
import { useReminders } from "../data/useReminders.ts";
import { space } from "../theme/tokens.ts";
import { Card, Eyebrow, Hairline, SecondaryButton, Words } from "./ui.tsx";

/** The phone's own date, as the API writes dates: a reminder is due on the reader's day. */
function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Reminders on Today (spec §12): a reminder that is due asks the reader to ask her how it went,
 * with Ask and Done; the plans she mentioned are offered as "Remind me to ask", and one already
 * set says when. Nothing shows when there is nothing coming. It never reaches her: to her it is
 * only a person asking.
 */
export function RemindersCard({ familyId }: { familyId: string | undefined }) {
  const { t } = useLingui();
  const view = useReminders(familyId);
  const today = localToday();
  const due = view.reminders.filter((reminder) => reminder.due_date <= today);
  const later = view.reminders.filter((reminder) => reminder.due_date > today);
  const offered = view.suggestions.slice(0, 3);
  if (due.length === 0 && later.length === 0 && offered.length === 0) return null;
  return (
    <Card>
      <Eyebrow>
        <Trans>Coming up</Trans>
      </Eyebrow>
      {due.map((reminder) => {
        const name = reminder.about_name;
        const what = reminder.what;
        return (
          <View key={reminder.id} style={{ gap: space.s }}>
            <Words variant="bodyMedium">
              <Trans>
                Ask {name} how {what} went
              </Trans>
            </Words>
            <SecondaryButton
              label={t`Ask ${name}`}
              onPress={() =>
                router.push({
                  pathname: "/ask",
                  params: { recipient: reminder.about_member_id, text: t`How did ${what} go?` },
                })
              }
            />
            <SecondaryButton label={t`Done`} onPress={() => view.finish(reminder.id)} />
          </View>
        );
      })}
      {due.length > 0 && later.length + offered.length > 0 ? <Hairline /> : null}
      {later.map((reminder) => {
        const name = reminder.about_name;
        const what = reminder.what;
        const day = dayName(reminder.due_date);
        return (
          <Words key={reminder.id} variant="body" tone="ink2">
            <Trans>
              {name}: {what}. You will be reminded to ask on {day}.
            </Trans>
          </Words>
        );
      })}
      {offered.map((plan) => {
        const name = plan.about_name;
        const what = plan.what;
        const day = dayName(plan.on);
        return (
          <View key={plan.fact_id} style={{ gap: space.s }}>
            <Words variant="body">
              <Trans>
                {name}: {what}, {day}
              </Trans>
            </Words>
            <SecondaryButton
              label={view.busy ? t`Saving…` : t`Remind me to ask how it went`}
              onPress={() => view.remind(plan.fact_id)}
            />
          </View>
        );
      })}
    </Card>
  );
}
