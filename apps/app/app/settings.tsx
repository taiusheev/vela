import { t as translate } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router, Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiConfigured } from "../src/api/client.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { BackButton } from "../src/components/back-button.tsx";
import { BrandIcon } from "../src/components/brand/icon.tsx";
import { CallingNumberEditor } from "../src/components/calling-number-editor.tsx";
import { ConfirmationDialog } from "../src/components/confirmation-dialog.tsx";
import { FamilyChooser } from "../src/components/family-chooser.tsx";
import { Light } from "../src/components/light.tsx";
import { LoadingLight } from "../src/components/loading-light.tsx";
import { LocaleChips } from "../src/components/locale-chips.tsx";
import { ServiceStatus } from "../src/components/service-status.tsx";
import { SetUpPhone } from "../src/components/set-up-phone.tsx";
import {
  RowAction,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "../src/components/settings-list.tsx";
import { TestSignInDetails } from "../src/components/test-sign-in-details.tsx";
import { SecondaryButton, Words } from "../src/components/ui.tsx";
import { momentLine, nobodyTellsLine, phoneLine, toldOfQuiet } from "../src/data/notifications.ts";
import { resetDraft } from "../src/data/onboarding-draft.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { useFamily } from "../src/data/useFamily.ts";
import { useNotificationPreferences } from "../src/data/useNotificationPreferences.ts";
import { useOneMoment } from "../src/data/useOneMoment.ts";
import { usePullRefresh } from "../src/data/usePullRefresh.ts";
import { type TodayView, useToday } from "../src/data/useToday.ts";
import { useAppLocale } from "../src/i18n/provider.tsx";
import { usePush } from "../src/push/provider.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

export default function YouScreen() {
  const day = useToday();
  return <FamilyYou key={day.familyId ?? ""} day={day} />;
}

function FamilyYou({ day }: { day: TodayView }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const { capabilities, pilot, englishOnly } = useCapabilities();
  const { t } = useLingui();
  const language = useAppLocale();
  const { familyId, noAccount, pushSent, loading: todayLoading } = day;
  const push = usePush();
  const signingOut = useMutation({ mutationFn: () => push.signOut() });
  const moment = useOneMoment();
  const notificationChoices = useNotificationPreferences();
  const notificationState = notificationChoices.available ? notificationChoices : moment;
  const {
    family,
    refresh,
    live,
    trouble,
    loading: familyLoading,
    setPaused,
    leave,
    changing,
    refused,
  } = useFamily(familyId, familyId !== undefined);
  useFocusEffect(
    useCallback(() => {
      day.refresh();
      refresh();
    }, [day.refresh, refresh]),
  );
  const retry = useCallback(async () => {
    await Promise.all([day.refresh(), refresh()]);
  }, [day.refresh, refresh]);
  const pull = usePullRefresh(retry);
  const [seesOpen, setSeesOpen] = useState(false);
  const [pausing, confirmPause] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [exampleNote, setExampleNote] = useState(false);

  const her = family.keptLight[0]?.name ?? t`Mom`;
  const { familyName } = family;
  // push: what this phone can do about notifications, and whether it is the reader's to do.
  const phone = push.phone;
  const phoneAction =
    !push.availability.available || phone === null
      ? undefined
      : phone.permission !== "granted"
        ? phone.canAskAgain
          ? "ask"
          : "settings"
        : phone.quietChannelBlocked
          ? "settings"
          : undefined;
  // An organiser, active, whom nothing can reach: nobody would be told of a quiet morning. Said
  // once `GET /v1/me` has answered whether this API sends pushes, which changes why.
  const told = family.me.toldIfQuiet;
  const nobodyTells =
    live &&
    !todayLoading &&
    family.me.organiser &&
    !family.me.paused &&
    told !== undefined &&
    !told.telegram &&
    !told.app;
  // A kept light pauses and stops in her own chat, where her mornings arrive (spec §9).
  const ownTurns = !((!live && apiConfigured()) || family.me.lightOn);
  const version = Constants.expoConfig?.version;

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Settings`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.refresh} />}
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.l,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.l,
          gap: space.xxl,
        }}
      >
        {/* Who is signed in, first, as every phone's settings begin. */}
        <View style={{ gap: space.l }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.l,
              paddingHorizontal: space.xs,
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: palette.actionSoft,
              }}
            >
              <BrandIcon name="you" size={26} color={palette.action} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Words variant="title">{family.me.name}</Words>
              <Words variant="caption" tone="ink2">
                {family.me.line}
              </Words>
            </View>
          </View>
          <FamilyChooser day={day} />
          <ServiceStatus compact />
          {trouble || day.trouble ? (
            <View style={{ gap: space.m }}>
              <Words variant="body" tone="ink2">
                <Trans>Your family could not be reached just now.</Trans>
              </Words>
              <SecondaryButton label={t`Try again`} onPress={retry} />
            </View>
          ) : null}
          {familyLoading || todayLoading ? <LoadingLight label={t`Loading your family…`} /> : null}
          {pilot ? (
            <Words variant="body" tone="ink2">
              <Trans>
                Your pilot is free. Quiet notices and important updates arrive in the organiser’s
                private Telegram chat.
              </Trans>
            </Words>
          ) : null}
          {noAccount || day.noFamily ? (
            <SecondaryButton
              label={t`Connect your Telegram family`}
              onPress={() => router.push("/onboarding")}
            />
          ) : null}
        </View>

        {/* Each parent's own group: everything about her light in one place (spec §8). */}
        {family.keptLight.map((member) => {
          const name = member.name;
          const nearby = family.me.organiser ? (member.nearby ?? family.nearby) : undefined;
          return (
            <View key={member.memberId} style={{ gap: space.xxl }}>
              <SettingsSection
                title={name}
                footer={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
                    <Light state={member.paused ? "paused" : "resting"} height={16} />
                    <SettingsNote>
                      {pilot && member.light === "on" ? t`Free pilot` : member.line}
                    </SettingsNote>
                  </View>
                }
              >
                <SettingsRow
                  icon="photo"
                  title={parentSettingsTitle(name)}
                  testID={`parent-settings-${member.memberId}`}
                  onPress={() =>
                    router.push({
                      pathname: "/parent-settings",
                      params: { member: member.memberId },
                    })
                  }
                />
                {family.me.organiser ? (
                  <SettingsRow
                    icon="time"
                    title={morningTitle(name)}
                    testID={`morning-settings-${member.memberId}`}
                    onPress={() =>
                      router.push({
                        pathname: "/morning-settings",
                        params: { member: member.memberId },
                      })
                    }
                  />
                ) : null}
                {nearby === undefined ? null : (
                  <SettingsRow
                    icon="nearby"
                    title={t`People near ${name}`}
                    detail={nearby.line}
                    onPress={() =>
                      router.push({ pathname: "/nearby", params: { member: member.memberId } })
                    }
                  />
                )}
                {/* Away mode (spec §8): any member may say she is away. */}
                {member.paused ? null : (
                  <SettingsRow
                    icon="calendar"
                    title={awayTitle(name)}
                    onPress={() =>
                      router.push({ pathname: "/away", params: { member: member.memberId } })
                    }
                  />
                )}
                {capabilities?.billing === true && family.me.organiser && member.light === "on" ? (
                  <SettingsRow
                    icon="heart"
                    title="Vela Light"
                    onPress={() =>
                      router.push({
                        pathname: "/vela-light",
                        params: { member: member.memberId },
                      })
                    }
                  />
                ) : null}
              </SettingsSection>
              {live && family.me.organiser ? (
                <CallingNumberEditor
                  familyId={family.familyId}
                  memberId={member.memberId}
                  name={name}
                />
              ) : null}
              {capabilities?.parent_app === true && family.me.organiser ? (
                <SettingsSection title={t`${name}'s phone`}>
                  <View style={{ padding: space.l }}>
                    <SetUpPhone familyId={family.familyId} memberId={member.memberId} name={name} />
                  </View>
                </SettingsSection>
              ) : null}
            </View>
          );
        })}

        <SettingsSection title={t`Family`}>
          {family.others === undefined ? null : (
            <SettingsRow icon="you" title={family.others.names} detail={family.others.line} />
          )}
          {/* Organisers only: they are the ones told of a quiet morning (spec §8). */}
          {family.me.organiser ? (
            <SettingsRow
              icon="today"
              title={t`How Vela is doing`}
              detail={t`How the quiet notices ended, in your family and across Vela`}
              onPress={() => router.push("/precision")}
            />
          ) : null}
          <SettingsRow
            icon="privacy"
            title={t`What the family sees about you`}
            expanded={seesOpen}
            onPress={() => setSeesOpen((open) => !open)}
          />
          {seesOpen ? (
            <View style={{ paddingHorizontal: space.l, paddingVertical: space.m, gap: space.s }}>
              <Words variant="caption" tone="ink2">
                <Trans>Your name, the asks you write, and your replies.</Trans>
              </Words>
              <Words variant="caption" tone="ink2">
                {family.me.lightOn
                  ? t`With your light on, they also see whether you answered each morning and when, and are told if it stays quiet.`
                  : t`Your light is off, so nothing about your mornings is shown.`}
              </Words>
            </View>
          ) : null}
        </SettingsSection>

        <SettingsSection
          title={t`Notifications`}
          footer={
            <>
              {push.availability.available && !pushSent && !todayLoading ? (
                <SettingsNote>
                  <Trans>Vela does not send notifications from here yet.</Trans>
                </SettingsNote>
              ) : null}
              {nobodyTells ? (
                <SettingsNote tone="ink2">
                  {nobodyTellsLine(phoneAction !== undefined && pushSent, pushSent)}
                </SettingsNote>
              ) : null}
              {moment.status === "unavailable" ? (
                <SecondaryButton label={t`Try again`} onPress={moment.retry} />
              ) : null}
              {notificationState.status === "saving" || notificationState.status === "saved" ? (
                <View accessibilityLiveRegion="polite">
                  <SettingsNote tone="ink2">
                    {notificationState.status === "saving"
                      ? t`Saving your preference…`
                      : t`Notification preference saved.`}
                  </SettingsNote>
                </View>
              ) : null}
              {notificationChoices.available && toldOfQuiet(family.me) ? (
                <SettingsNote>
                  <Trans>
                    Vela Light quiet-morning notices still reach you when these reminders are off.
                  </Trans>
                </SettingsNote>
              ) : null}
              {notificationState.refused ? (
                <SettingsNote tone="ink2">
                  <Trans>That did not go through. Try again in a moment.</Trans>
                </SettingsNote>
              ) : null}
            </>
          }
        >
          <SettingsRow
            icon="bell"
            title={t`This phone`}
            detail={phoneLine(push)}
            trailing={
              phoneAction === undefined ? undefined : (
                <RowAction
                  label={phoneAction === "ask" ? t`Turn on` : t`Open settings`}
                  disabled={push.asking}
                  onPress={() => (phoneAction === "ask" ? void push.ask() : push.openSettings())}
                />
              )
            }
          />
          {notificationChoices.available ? (
            [
              <SettingsRow
                key="reply-notifications"
                icon="bell"
                title={t`When a parent replies`}
                detail={t`A silent notification when a parent answers your question. At most one per family each day, between 08:00 and 21:00 in your time zone.`}
                trailing={
                  <Switch
                    accessibilityLabel={t`When a parent replies`}
                    accessibilityState={{ busy: notificationChoices.changing }}
                    value={notificationChoices.values.replies}
                    disabled={notificationChoices.changing}
                    onValueChange={(on) => notificationChoices.set("replies", on)}
                    trackColor={{ false: palette.rule, true: palette.action }}
                    thumbColor={palette.surface}
                    {...webThumb(palette.surface)}
                  />
                }
              />,
              <SettingsRow
                key="turn-reminders"
                icon="sunday"
                title={t`Before your turn`}
                detail={t`A silent reminder to prepare tomorrow’s question, only if it still needs you. At most one a day across your parents, between 08:00 and 21:00 in your time zone.`}
                trailing={
                  <Switch
                    accessibilityLabel={t`Before your turn`}
                    accessibilityState={{ busy: notificationChoices.changing }}
                    value={notificationChoices.values.turns}
                    disabled={notificationChoices.changing}
                    onValueChange={(on) => notificationChoices.set("turns", on)}
                    trackColor={{ false: palette.rule, true: palette.action }}
                    thumbColor={palette.surface}
                    {...webThumb(palette.surface)}
                  />
                }
              />,
            ]
          ) : (
            <SettingsRow
              icon="sunday"
              title={t`Replies and turn reminders`}
              detail={
                moment.status === "loading"
                  ? t`Loading your notification preference…`
                  : moment.status === "unavailable"
                    ? t`Your notification preference could not be loaded.`
                    : momentLine(moment.on, toldOfQuiet(family.me), her)
              }
              trailing={
                <Switch
                  accessibilityLabel={t`Replies and turn reminders`}
                  accessibilityState={{
                    busy: moment.status === "saving" || moment.status === "loading",
                  }}
                  value={moment.on}
                  disabled={moment.changing}
                  onValueChange={moment.set}
                  trackColor={{ false: palette.rule, true: palette.action }}
                  thumbColor={palette.surface}
                  {...webThumb(palette.surface)}
                />
              }
            />
          )}
        </SettingsSection>

        <SettingsSection
          title={t`Language`}
          footer={
            <>
              <SettingsNote>
                <Trans>The app's words. Her mornings keep the language she reads.</Trans>
              </SettingsNote>
              {language.refused ? (
                <SettingsNote tone="ink2">
                  <Trans>That did not go through. Try again in a moment.</Trans>
                </SettingsNote>
              ) : null}
            </>
          }
        >
          <View style={{ padding: space.l }}>
            {englishOnly ? (
              <Words variant="bodyMedium">
                <Trans>English pilot</Trans>
              </Words>
            ) : (
              <LocaleChips />
            )}
          </View>
        </SettingsSection>

        <SettingsSection
          title={t`Privacy and help`}
          footer={
            <SettingsNote>
              <Trans>
                Your parent can ask “what does the family see” in their own chat. Health-word
                sharing is their separate choice, and saying stop pauses their light.
              </Trans>
            </SettingsNote>
          }
        >
          <SettingsRow
            icon="mail"
            title={t`Get help or request your data`}
            onPress={() => router.push("/help")}
          />
          <SettingsRow
            icon="privacy"
            title={t`Privacy, terms and security`}
            onPress={() => router.push("/legal")}
          />
          <SettingsRow
            icon="play"
            title={t`Preview family setup`}
            onPress={() => {
              resetDraft();
              router.push("/onboarding?preview=1");
            }}
          />
        </SettingsSection>

        {ownTurns ? (
          <SettingsSection
            title={t`Your turns`}
            footer={
              <>
                {family.me.paused ? (
                  <SettingsNote tone="ink2">
                    {family.me.organiser
                      ? t`You are paused: no turns come to you, and you are not told if it goes quiet.`
                      : t`You are paused: no turns come to you.`}
                  </SettingsNote>
                ) : null}
                {refused === undefined ? null : <SettingsNote tone="ink2">{refused}</SettingsNote>}
                {exampleNote ? (
                  <SettingsNote>
                    <Trans>This is the example family, so nobody left.</Trans>
                  </SettingsNote>
                ) : null}
              </>
            }
          >
            <SettingsRow
              icon={family.me.paused ? "play" : "pause"}
              title={family.me.paused ? t`Resume` : t`Pause`}
              disabled={changing}
              onPress={() => {
                setLeaving(false);
                if (family.me.paused) setPaused(false);
                else confirmPause(true);
              }}
            />
            <SettingsRow
              careful
              icon="leave"
              title={t`Leave`}
              disabled={changing}
              onPress={() => {
                setExampleNote(false);
                confirmPause(false);
                setLeaving(true);
              }}
            />
          </SettingsSection>
        ) : null}

        {account.signedIn ? (
          <SettingsSection
            title={t`Account`}
            footer={
              <>
                {signingOut.isError ? (
                  <SettingsNote tone="ink2">
                    <Trans>Sign-out did not finish. You are still signed in. Try again.</Trans>
                  </SettingsNote>
                ) : null}
                <TestSignInDetails />
              </>
            }
          >
            {/* push (A5): the phone is let go from the account first, so a phone handed on is not told. */}
            <SettingsRow
              icon="back"
              title={signingOut.isPending ? t`Signing out…` : t`Sign out`}
              disabled={signingOut.isPending}
              onPress={() => signingOut.mutate()}
            />
            <SettingsRow
              careful
              icon="trash"
              title={t`Delete account`}
              disabled={signingOut.isPending}
              onPress={() => router.push("/delete-account")}
            />
          </SettingsSection>
        ) : (
          <View style={{ paddingHorizontal: space.xs }}>
            <SettingsNote>
              <Trans>Sign in to connect your family.</Trans>
            </SettingsNote>
          </View>
        )}

        {/* What support asks first: which Vela this is. */}
        {version === undefined ? null : (
          <View style={{ paddingHorizontal: space.xs }}>
            <SettingsNote>
              <Trans>Vela {version}</Trans>
            </SettingsNote>
          </View>
        )}
      </ScrollView>

      {pausing ? (
        <ConfirmationDialog
          onClose={() => {
            if (!changing) confirmPause(false);
          }}
        >
          <Words variant="heading">
            <Trans>Pause your turns in {familyName}?</Trans>
          </Words>
          <Words variant="body" tone="ink2">
            {family.me.organiser
              ? t`You will not receive turns or quiet notices while paused. Another active organiser must stay reachable.`
              : t`You will stop receiving turns. You can resume whenever you are ready.`}
          </Words>
          <SecondaryButton
            label={t`Pause my turns`}
            disabled={changing}
            onPress={() => {
              setPaused(true);
              confirmPause(false);
            }}
          />
          <SecondaryButton
            label={t`Keep my turns`}
            disabled={changing}
            onPress={() => confirmPause(false)}
          />
        </ConfirmationDialog>
      ) : null}
      {leaving ? (
        <ConfirmationDialog
          onClose={() => {
            if (!changing) setLeaving(false);
          }}
        >
          <Words variant="heading">
            <Trans>Leave {familyName}?</Trans>
          </Words>
          <Words variant="body" tone="ink2">
            <Trans>
              You will stop seeing the family's days and taking turns. Thirty days on, what is kept
              about you is deleted.
            </Trans>
          </Words>
          {refused === undefined ? null : (
            <Words variant="body" tone="ink2">
              {refused}
            </Words>
          )}
          <SecondaryButton
            label={changing ? t`Leaving…` : t`Leave the family`}
            disabled={changing}
            onPress={() => {
              if (!live) {
                setLeaving(false);
                setExampleNote(true);
                return;
              }
              leave(() => router.replace("/"));
            }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={changing}
            onPress={() => setLeaving(false)}
          >
            <Words variant="button" tone="action">
              <Trans>Stay</Trans>
            </Words>
          </Pressable>
        </ConfirmationDialog>
      ) : null}
    </>
  );
}

function morningTitle(name: string) {
  return translate`Change ${name}'s morning`;
}

function parentSettingsTitle(name: string) {
  return translate`${name}’s photo and parent link`;
}

function awayTitle(name: string) {
  return translate`Is ${name} away?`;
}

/** React Native Web draws a switch that is on with a teal thumb of its own unless told otherwise. */
function webThumb(colour: string): object {
  return { activeThumbColor: colour };
}
