import { Trans, useLingui } from "@lingui/react/macro";
import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import * as Updates from "expo-updates";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, Switch, View } from "react-native";
import { apiConfigured } from "../../src/api/client.ts";
import { useAccount } from "../../src/auth/clerk.tsx";
import { ScreenHeading } from "../../src/components/brand/experience.tsx";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import { ConfirmationDialog } from "../../src/components/confirmation-dialog.tsx";
import { FamilyChooser } from "../../src/components/family-chooser.tsx";
import { LoadingLight } from "../../src/components/loading-light.tsx";
import { LocaleChips } from "../../src/components/locale-chips.tsx";
import { Portrait } from "../../src/components/portrait-lamp.tsx";
import { Text } from "../../src/components/scaled-text.tsx";
import { ServiceStatus } from "../../src/components/service-status.tsx";
import {
  RowAction,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "../../src/components/settings-list.tsx";
import { useRoom } from "../../src/components/today-hero.tsx";
import { SecondaryButton, Words } from "../../src/components/ui.tsx";
import { RoomCard, WarmPage } from "../../src/components/warm.tsx";
import type { KeptLightRow } from "../../src/data/family.ts";
import {
  momentLine,
  nobodyTellsLine,
  phoneLine,
  toldOfQuiet,
} from "../../src/data/notifications.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useFamily } from "../../src/data/useFamily.ts";
import { useMyMemories } from "../../src/data/useMyMemories.ts";
import { useNotificationPreferences } from "../../src/data/useNotificationPreferences.ts";
import { useOneMoment } from "../../src/data/useOneMoment.ts";
import { photoBoxDemo } from "../../src/data/usePhotoBox.ts";
import { usePortrait } from "../../src/data/usePortrait.ts";
import { usePullRefresh } from "../../src/data/usePullRefresh.ts";
import { type TodayView, useToday } from "../../src/data/useToday.ts";
import { usePush } from "../../src/push/provider.tsx";
import { usePalette } from "../../src/theme/theme.tsx";
import { space, type } from "../../src/theme/tokens.ts";
import { runningUpdateLabel } from "../../src/updates/apply-pending.ts";

/** One parent whose light the family keeps: her face, her name and her plan; tapping opens her page. */
function KeptLightLine({ familyId, parent }: { familyId: string; parent: KeptLightRow }) {
  const room = useRoom();
  const photo = usePortrait(familyId, parent.memberId);
  return (
    <Pressable
      accessibilityRole="button"
      testID={`you-parent-${parent.memberId}`}
      onPress={() => router.push({ pathname: "/kept-light", params: { member: parent.memberId } })}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        padding: space.m,
        borderRadius: 16,
        backgroundColor: room.glass,
        borderWidth: 1,
        borderColor: room.glassRule,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Portrait uri={photo.uri} name={parent.name} width={40} height={40} round />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.button, { color: room.ink }]}>{parent.name}</Text>
        <Text style={[type.caption, { fontSize: 13, color: room.muted }]}>{parent.line}</Text>
      </View>
      <BrandIcon name="chevron" color={room.muted} size={16} strokeWidth={2} />
    </Pressable>
  );
}

/**
 * The reader first, as a phone's own settings begin: their face and name, tapped to change the
 * name. It replaces the "Your name · Change" row, so there is one way in and no second profile.
 */
function MeLine({ name, line, loading }: { name: string; line: string; loading: boolean }) {
  const palette = usePalette();
  const { t } = useLingui();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t`Your name, ${name}`}
      accessibilityHint={t`Change the name your family sees`}
      testID="you-name"
      disabled={loading}
      onPress={() => router.push("/profile")}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.l,
        paddingHorizontal: space.xs,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Portrait uri={null} name={loading ? "" : name} width={56} height={56} round />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Words variant="heading">{loading ? t`Loading…` : name}</Words>
        {loading ? null : (
          <Words variant="caption" tone="ink2">
            {line}
          </Words>
        )}
      </View>
      <BrandIcon name="chevron" color={palette.ink3} size={20} />
    </Pressable>
  );
}

export default function YouScreen() {
  const day = useToday();
  return <YouPage key={day.familyId ?? ""} day={day} />;
}

/**
 * You is the one page for everything the reader can change, as a phone's own Settings is: who they
 * are, then the family they look after (each parent opens her own page), then what they reach for
 * most (memories, notifications), then the rarer things, and last the account, one page further
 * down, where leaving and deleting wait behind their own questions. Settings used to be a second
 * page under this one; everything on it is here now, so nothing is a tap deeper than it must be.
 */
function YouPage({ day }: { day: TodayView }) {
  const { t } = useLingui();
  const palette = usePalette();
  const room = useRoom();
  const account = useAccount();
  const { pilot, englishOnly, capabilities } = useCapabilities();
  const { familyId, noAccount, pushSent, loading: todayLoading } = day;
  const push = usePush();
  const moment = useOneMoment();
  const notificationChoices = useNotificationPreferences();
  const notificationState = notificationChoices.available ? notificationChoices : moment;
  const memories = useMyMemories(familyId);
  const { family, refresh, live, trouble, loading, setPaused, changing, refused } = useFamily(
    familyId,
    familyId !== undefined,
  );
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

  const her = family.keptLight[0]?.name ?? t`Mom`;
  const { familyName } = family;
  // What this phone can do about notifications, and whether it is the reader's to do.
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
  const photoBox = capabilities?.photo_box === true || photoBoxDemo();
  const version = Constants.expoConfig?.version;
  const update = runningUpdateLabel(Updates.updateId, Updates.isEmbeddedLaunch);
  const switchColours = {
    trackColor: { false: palette.rule, true: palette.action },
    thumbColor: palette.surface,
    ...webThumb(palette.surface),
  };

  return (
    <>
      <WarmPage
        gap={space.xxl}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.refresh} />}
      >
        <View style={{ gap: space.xl }}>
          <ScreenHeading title={<Trans context="tab">You</Trans>} />
          <MeLine name={family.me.name} line={family.me.line} loading={loading} />
          <FamilyChooser day={day} />
        </View>

        {trouble || day.trouble ? (
          <View style={{ gap: space.m }}>
            <Words variant="body" tone="ink2">
              <Trans>Your family could not be reached just now.</Trans>
            </Words>
            <SecondaryButton label={t`Try again`} onPress={retry} />
          </View>
        ) : null}
        {noAccount || day.noFamily ? (
          <SecondaryButton
            label={t`Connect your family`}
            onPress={() => router.push("/onboarding")}
          />
        ) : null}

        {/* The family is what this tab is about, so it is lit as Today lights her morning. Each
          parent opens her own page: her morning, away days, people nearby, photo and plan. */}
        {familyName === "" && !loading ? null : (
          <RoomCard id="you-family">
            <Text style={[type.label, { letterSpacing: 0, color: room.muted }]}>
              <Trans>Your family</Trans>
            </Text>
            <Text accessibilityRole="header" style={[type.title, { color: room.ink }]}>
              {loading || todayLoading ? t`Loading your family…` : familyName}
            </Text>
            {family.keptLight.map((parent) => (
              <KeptLightLine key={parent.memberId} familyId={familyId ?? ""} parent={parent} />
            ))}
            {family.others === undefined ? null : (
              <Text style={[type.caption, { color: room.muted }]}>
                {family.others.names} · {family.others.line}
              </Text>
            )}
            {pilot ? (
              <Text style={[type.caption, { color: room.muted }]}>
                <Trans>
                  Your pilot is free. Quiet notices and important updates arrive in the organiser’s
                  private chat with Vela in their messenger.
                </Trans>
              </Text>
            ) : null}
          </RoomCard>
        )}
        {loading && familyName === "" ? <LoadingLight label={t`Loading your family…`} /> : null}

        {memories.available || photoBox ? (
          <SettingsSection>
            {memories.available ? (
              <SettingsRow
                icon="heart"
                title={t`Your memories`}
                detail={t`From your own answers`}
                onPress={() => router.push("/my-memories")}
              />
            ) : null}
            {photoBox ? (
              <SettingsRow
                icon="photo"
                title={t`Photo box`}
                detail={t`Shown on free mornings`}
                testID="you-photo-box"
                onPress={() => router.push("/photo-box")}
              />
            ) : null}
          </SettingsSection>
        ) : null}

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
                detail={t`At most once a day, never at night.`}
                trailing={
                  <Switch
                    accessibilityLabel={t`When a parent replies`}
                    accessibilityState={{ busy: notificationChoices.changing }}
                    value={notificationChoices.values.replies}
                    disabled={notificationChoices.changing}
                    onValueChange={(on) => notificationChoices.set("replies", on)}
                    {...switchColours}
                  />
                }
              />,
              <SettingsRow
                key="turn-reminders"
                icon="sunday"
                title={t`Before your turn`}
                detail={t`When tomorrow’s question still needs you. Never at night.`}
                trailing={
                  <Switch
                    accessibilityLabel={t`Before your turn`}
                    accessibilityState={{ busy: notificationChoices.changing }}
                    value={notificationChoices.values.turns}
                    disabled={notificationChoices.changing}
                    onValueChange={(on) => notificationChoices.set("turns", on)}
                    {...switchColours}
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
                  {...switchColours}
                />
              }
            />
          )}
        </SettingsSection>

        <SettingsSection
          title={t`Language`}
          footer={
            <SettingsNote>
              <Trans>The app's words. Her mornings keep the language she reads.</Trans>
            </SettingsNote>
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

        <SettingsSection title={t`Help and privacy`}>
          <SettingsRow
            icon="mail"
            title={t`Get help or request your data`}
            onPress={() => router.push("/help")}
          />
          <SettingsRow
            icon="privacy"
            title={t`What the family sees about you`}
            expanded={seesOpen}
            onPress={() => setSeesOpen((open) => !open)}
          />
          {seesOpen ? (
            <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.s }}>
              <Words variant="caption" tone="ink2">
                <Trans>Your name, the asks you write, and your replies.</Trans>
              </Words>
              <Words variant="caption" tone="ink2">
                {family.me.lightOn
                  ? t`With your light on, they also see whether you answered each morning and when, and are told if it stays quiet.`
                  : t`Your light is off, so nothing about your mornings is shown.`}
              </Words>
              <Words variant="caption" tone="ink2">
                <Trans>
                  Your parent can ask “what does the family see” in their own chat. Health-word
                  sharing is their separate choice, and saying stop pauses their light.
                </Trans>
              </Words>
            </View>
          ) : null}
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
            title={t`Privacy, terms and security`}
            onPress={() => router.push("/legal")}
          />
        </SettingsSection>

        {ownTurns && familyName !== "" ? (
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
                {refused === undefined || pausing ? null : (
                  <SettingsNote tone="ink2">{refused}</SettingsNote>
                )}
              </>
            }
          >
            <SettingsRow
              icon={family.me.paused ? "play" : "pause"}
              title={family.me.paused ? t`Resume` : t`Pause`}
              detail={
                family.me.paused ? undefined : t`A break from your turns. Nothing is deleted.`
              }
              disabled={changing}
              onPress={() => {
                if (family.me.paused) setPaused(false);
                else confirmPause(true);
              }}
            />
          </SettingsSection>
        ) : null}

        {/* Last, and one page further down: signing out, leaving and deleting (account.tsx). */}
        <SettingsSection>
          <SettingsRow
            icon="you"
            title={t`Account`}
            detail={
              account.signedIn
                ? t`Sign out, leave the family, delete account`
                : t`Sign in to connect your family.`
            }
            testID="you-account"
            onPress={() => router.push("/account")}
          />
        </SettingsSection>

        {/* Whether Vela itself is running, and which Vela this is: what support asks first. */}
        <View style={{ gap: space.s, paddingHorizontal: space.xs }}>
          <ServiceStatus compact />
          {version === undefined ? null : (
            <SettingsNote>
              {update === null ? (
                <Trans>Vela {version}</Trans>
              ) : (
                <Trans>
                  Vela {version} · update {update}
                </Trans>
              )}
            </SettingsNote>
          )}
        </View>
      </WarmPage>
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
    </>
  );
}

/** React Native Web draws a switch that is on with a teal thumb of its own unless told otherwise. */
function webThumb(colour: string): object {
  return { activeThumbColor: colour };
}
