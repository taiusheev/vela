import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { type ReactNode, useCallback, useState } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiBaseUrl, apiConfigured } from "../../src/api/client.ts";
import { PRODUCTION_NOTICE_ORIGIN, SUPPORT_EMAIL } from "../../src/api/support.ts";
import { useAccount } from "../../src/auth/clerk.tsx";
import { FamilyAction, ScreenHeading } from "../../src/components/brand/experience.tsx";
import { BrandIcon } from "../../src/components/brand/icon.tsx";
import { CallingNumberEditor } from "../../src/components/calling-number-editor.tsx";
import { ConfirmationDialog } from "../../src/components/confirmation-dialog.tsx";
import { FamilyChooser } from "../../src/components/family-chooser.tsx";
import { Light } from "../../src/components/light.tsx";
import { LocaleChips } from "../../src/components/locale-chips.tsx";
import { ServiceStatus } from "../../src/components/service-status.tsx";
import { SetUpPhone } from "../../src/components/set-up-phone.tsx";
import { TestSignInDetails } from "../../src/components/test-sign-in-details.tsx";
import { Card, Eyebrow, Hairline, SecondaryButton, Words } from "../../src/components/ui.tsx";
import {
  momentLine,
  nobodyTellsLine,
  phoneLine,
  toldOfQuiet,
} from "../../src/data/notifications.ts";
import { useCapabilities } from "../../src/data/useCapabilities.ts";
import { useFamily } from "../../src/data/useFamily.ts";
import { useOneMoment } from "../../src/data/useOneMoment.ts";
import { type TodayView, useToday } from "../../src/data/useToday.ts";
import { useAppLocale } from "../../src/i18n/provider.tsx";
import { usePush } from "../../src/push/provider.tsx";
import { usePalette } from "../../src/theme/theme.tsx";
import { hitSlop, space } from "../../src/theme/tokens.ts";

/** One line of You: an optional glyph, a name with its caption, and whatever sits at the end. */
function Row({
  leading,
  title,
  caption,
  trailing,
}: {
  leading?: ReactNode;
  title: string;
  caption?: string;
  trailing?: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      style={{
        flexDirection: fontScale > 1.3 ? "column" : "row",
        alignItems: fontScale > 1.3 ? "flex-start" : "center",
        gap: space.m,
      }}
    >
      {leading}
      <View style={{ flex: fontScale > 1.3 ? undefined : 1, alignSelf: "stretch", gap: space.xs }}>
        <Words variant="bodyMedium">{title}</Words>
        {caption === undefined ? null : (
          <Words variant="caption" tone="ink3">
            {caption}
          </Words>
        )}
      </View>
      {trailing}
    </View>
  );
}

export default function YouScreen() {
  const day = useToday();
  return <FamilyYou key={day.familyId ?? ""} day={day} />;
}

function FamilyYou({ day }: { day: TodayView }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const { capabilities, pilot, englishOnly } = useCapabilities();
  const [linkFailed, setLinkFailed] = useState(false);
  const openLink = async (url: string) => {
    setLinkFailed(false);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkFailed(true);
    }
  };
  const { t } = useLingui();
  const language = useAppLocale();
  const { familyId, noAccount, pushSent, loading: todayLoading } = day;
  const push = usePush();
  const signingOut = useMutation({ mutationFn: () => push.signOut() });
  const moment = useOneMoment();
  const {
    family,
    refresh,
    refreshing,
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
  const retry = () => {
    day.refresh();
    refresh();
  };
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

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={retry} />}
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      {/* The tab's own name, so the title reads as the tab bar does. */}
      <ScreenHeading title={<Trans context="tab">You</Trans>} />
      <FamilyChooser day={day} />
      <ServiceStatus compact />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.l,
          paddingVertical: space.m,
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.actionSoft,
          }}
        >
          <BrandIcon name="you" size={26} color={palette.action} />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Words variant="title">{family.me.name}</Words>
          <Words variant="caption" tone="ink2">
            {family.me.line}
          </Words>
        </View>
      </View>
      {trouble || day.trouble ? (
        <Words variant="body" tone="ink2">
          <Trans>Your family could not be reached just now.</Trans>
        </Words>
      ) : null}

      {trouble || day.trouble ? <SecondaryButton label={t`Try again`} onPress={retry} /> : null}
      {familyLoading || todayLoading ? (
        <Words variant="body" tone="ink2">
          <Trans>Loading your family…</Trans>
        </Words>
      ) : null}
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
      <View style={{ gap: space.m }}>
        <Eyebrow>
          <Trans>Family</Trans>
        </Eyebrow>
        <Card>
          {family.keptLight.map((member, index) => (
            <View key={member.memberId} style={{ gap: space.m }}>
              {index === 0 ? null : <Hairline />}
              <Row
                leading={<Light state={member.paused ? "paused" : "resting"} height={24} />}
                title={member.name}
                caption={pilot && member.light === "on" ? t`Free pilot` : member.line}
                trailing={
                  capabilities?.billing === true && family.me.organiser && member.light === "on" ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: "/vela-light",
                          params: { member: member.memberId },
                        })
                      }
                    >
                      <Words variant="button" tone="action">
                        Vela Light
                      </Words>
                    </Pressable>
                  ) : undefined
                }
              />
              {/* Away mode (spec §8): any member may say she is away. */}
              {member.paused ? null : <AwayLink memberId={member.memberId} name={member.name} />}
            </View>
          ))}
          {family.others === undefined ? null : (
            <>
              {family.keptLight.length === 0 ? null : <Hairline />}
              <Row title={family.others.names} caption={family.others.line} />
            </>
          )}
          {family.me.organiser
            ? family.keptLight.map((member) => {
                const nearby = member.nearby ?? family.nearby;
                if (nearby === undefined) return null;
                const name = member.name;
                return (
                  <View key={`nearby:${member.memberId}`} style={{ gap: space.m }}>
                    <Hairline />
                    <FamilyAction
                      icon="nearby"
                      actionLabel={t`Change`}
                      title={family.keptLight.length > 1 ? t`People near ${name}` : nearby.names}
                      detail={
                        family.keptLight.length > 1
                          ? `${nearby.names} · ${nearby.line}`
                          : nearby.line
                      }
                      onPress={() =>
                        router.push({ pathname: "/nearby", params: { member: member.memberId } })
                      }
                    />
                  </View>
                );
              })
            : null}
          {family.me.organiser ? (
            <>
              <Hairline />
              {/* Organisers only: they are the ones told of a quiet morning (spec §8). */}
              <FamilyAction
                icon="today"
                title={t`How Vela is doing`}
                detail={t`How the quiet notices ended, in your family and across Vela`}
                onPress={() => router.push("/precision")}
              />
            </>
          ) : null}
        </Card>
      </View>

      {live && family.me.organiser
        ? family.keptLight.map((member) => (
            <CallingNumberEditor
              key={member.memberId}
              familyId={family.familyId}
              memberId={member.memberId}
              name={member.name}
            />
          ))
        : null}

      {capabilities?.parent_app === true && family.me.organiser
        ? family.keptLight.map((member) => {
            const name = member.name;
            return (
              <View key={`phone:${member.memberId}`} style={{ gap: space.m }}>
                <Eyebrow>{t`${name}'s phone`}</Eyebrow>
                <SetUpPhone
                  familyId={family.familyId}
                  memberId={member.memberId}
                  name={member.name}
                />
              </View>
            );
          })
        : null}

      <Card>
        <Eyebrow>
          <Trans>Notifications</Trans>
        </Eyebrow>
        <Row
          title={t`This phone`}
          caption={phoneLine(push)}
          trailing={
            phoneAction === undefined ? undefined : (
              <Pressable
                accessibilityRole="button"
                disabled={push.asking}
                onPress={() => (phoneAction === "ask" ? void push.ask() : push.openSettings())}
              >
                <Words variant="button" tone="action">
                  {phoneAction === "ask" ? t`Turn on` : t`Open settings`}
                </Words>
              </Pressable>
            )
          }
        />
        {push.availability.available && !pushSent && !todayLoading ? (
          <Words variant="caption" tone="ink3">
            <Trans>Vela does not send notifications from here yet.</Trans>
          </Words>
        ) : null}
        {nobodyTells ? (
          <Words variant="body" tone="ink2">
            {nobodyTellsLine(phoneAction !== undefined && pushSent, pushSent)}
          </Words>
        ) : null}
        <Row
          title={t`One moment a day`}
          caption={momentLine(moment.on, toldOfQuiet(family.me), her)}
          trailing={
            <Switch
              value={moment.on}
              disabled={moment.changing}
              onValueChange={moment.set}
              trackColor={{ false: palette.rule, true: palette.action }}
              thumbColor={palette.surface}
            />
          }
        />
        {moment.refused ? (
          <Words variant="caption" tone="ink2">
            <Trans>That did not go through. Try again in a moment.</Trans>
          </Words>
        ) : null}
      </Card>

      <Card>
        <Eyebrow>
          <Trans>Language</Trans>
        </Eyebrow>
        {englishOnly ? (
          <Words variant="body">
            <Trans>English pilot</Trans>
          </Words>
        ) : (
          <LocaleChips />
        )}
        <Words variant="caption" tone="ink3">
          <Trans>The app's words. Her mornings keep the language she reads.</Trans>
        </Words>
        {language.refused ? (
          <Words variant="caption" tone="ink2">
            <Trans>That did not go through. Try again in a moment.</Trans>
          </Words>
        ) : null}
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: seesOpen }}
        onPress={() => setSeesOpen((open) => !open)}
      >
        <Words variant="button" tone="action">
          <Trans>What the family sees about you</Trans>
        </Words>
      </Pressable>
      {seesOpen ? (
        <Card>
          <Words variant="body" tone="ink2">
            <Trans>Your name, the asks you write, and your replies.</Trans>
          </Words>
          <Words variant="body" tone="ink2">
            {family.me.lightOn
              ? t`With your light on, they also see whether you answered each morning and when, and are told if it stays quiet.`
              : t`Your light is off, so nothing about your mornings is shown.`}
          </Words>
        </Card>
      ) : null}

      <Card>
        <Eyebrow>
          <Trans>Privacy and help</Trans>
        </Eyebrow>
        <Words variant="body" tone="ink2">
          <Trans>
            Your parent can ask “what does the family see” in their own Telegram chat. Health-word
            sharing is their separate choice, and saying stop pauses their light.
          </Trans>
        </Words>
        <FamilyAction
          icon="privacy"
          title={t`Read the privacy notice`}
          onPress={() => void openLink(`${apiBaseUrl ?? PRODUCTION_NOTICE_ORIGIN}/privacy`)}
        />
        <FamilyAction
          icon="mail"
          title={t`Get help or request your data`}
          onPress={() => router.push("/help")}
        />
        <Words variant="caption" selectable>
          {SUPPORT_EMAIL}
        </Words>
        <Words variant="caption" tone="ink2">
          <Trans>
            Ask the founder for access, correction, deletion, or to withdraw consent. Never include
            private family content in a support message.
          </Trans>
        </Words>
        {linkFailed ? (
          <Words variant="body" tone="ink2">
            <Trans>That link could not open. Use the address above to contact the founder.</Trans>
          </Words>
        ) : null}
      </Card>

      {/* A kept light pauses and stops in her own chat, where her mornings arrive (spec §9). */}
      {(!live && apiConfigured()) || family.me.lightOn ? null : (
        <View style={{ gap: space.m }}>
          {family.me.paused ? (
            <Words variant="body" tone="ink2">
              {family.me.organiser
                ? t`You are paused: no turns come to you, and you are not told if it goes quiet.`
                : t`You are paused: no turns come to you.`}
            </Words>
          ) : null}
          <View style={{ flexDirection: "row", gap: space.xl }}>
            <Pressable
              accessibilityRole="button"
              disabled={changing}
              onPress={() => {
                setLeaving(false);
                if (family.me.paused) setPaused(false);
                else confirmPause(true);
              }}
            >
              <Words variant="button" tone="action">
                {family.me.paused ? t`Resume` : t`Pause`}
              </Words>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={changing}
              onPress={() => {
                setExampleNote(false);
                confirmPause(false);
                setLeaving(true);
              }}
            >
              <Words variant="button" tone="action">
                <Trans>Leave</Trans>
              </Words>
            </Pressable>
          </View>
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
          {refused === undefined ? null : (
            <Words variant="caption" tone="ink2">
              {refused}
            </Words>
          )}
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
                  You will stop seeing the family's days and taking turns. Thirty days on, what is
                  kept about you is deleted.
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
          {exampleNote ? (
            <Words variant="caption" tone="ink3">
              <Trans>This is the example family, so nobody left.</Trans>
            </Words>
          ) : null}
        </View>
      )}

      {account.signedIn ? (
        <Card>
          <Eyebrow>
            <Trans>Account</Trans>
          </Eyebrow>
          <Words variant="caption" tone="ink3">
            <Trans>You are signed in to Vela.</Trans>
          </Words>
          <TestSignInDetails />
          {/* push (A5): the phone is let go from the account first, so a phone handed on is not told. */}
          <SecondaryButton
            label={signingOut.isPending ? t`Signing out…` : t`Sign out`}
            disabled={signingOut.isPending}
            onPress={() => signingOut.mutate()}
          />
          {signingOut.isError ? (
            <Words variant="body" tone="ink2">
              <Trans>Sign-out did not finish. You are still signed in. Try again.</Trans>
            </Words>
          ) : null}
          <Pressable
            accessibilityRole="button"
            hitSlop={hitSlop}
            disabled={signingOut.isPending}
            onPress={() => router.push("/delete-account")}
          >
            <Words variant="button" tone="action">
              <Trans>Delete account</Trans>
            </Words>
          </Pressable>
        </Card>
      ) : (
        <Words variant="caption" tone="ink3">
          <Trans>Sign in to connect your family.</Trans>
        </Words>
      )}
    </ScrollView>
  );
}

/** "Is Mom away?" under her row (spec §8), which opens Away for her. */
function AwayLink({ memberId, name }: { memberId: string; name: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={hitSlop}
      onPress={() => router.push({ pathname: "/away", params: { member: memberId } })}
    >
      <Words variant="button" tone="action">
        <Trans>Is {name} away?</Trans>
      </Words>
    </Pressable>
  );
}
