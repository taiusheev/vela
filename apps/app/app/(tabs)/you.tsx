import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccount } from "../../src/auth/clerk.tsx";
import { Light } from "../../src/components/light.tsx";
import { LocaleChips } from "../../src/components/locale-chips.tsx";
import { SetUpPhone } from "../../src/components/set-up-phone.tsx";
import { Card, Eyebrow, Hairline, SecondaryButton, Words } from "../../src/components/ui.tsx";
import {
  momentLine,
  nobodyTellsLine,
  phoneLine,
  toldOfQuiet,
} from "../../src/data/notifications.ts";
import { useFamily } from "../../src/data/useFamily.ts";
import { useOneMoment } from "../../src/data/useOneMoment.ts";
import { useToday } from "../../src/data/useToday.ts";
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
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.m }}>
      {leading}
      <View style={{ flex: 1, gap: space.xs }}>
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

/** A switch that shows where a setting stands while the app cannot change it yet. */
function Fixed({ on }: { on: boolean }) {
  const palette = usePalette();
  return (
    <Switch
      value={on}
      disabled
      trackColor={{ false: palette.rule, true: palette.action }}
      thumbColor={palette.surface}
    />
  );
}

export default function YouScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const { t } = useLingui();
  const language = useAppLocale();
  const {
    familyId,
    live: todayLive,
    trouble: todayTrouble,
    noAccount,
    pushSent,
    loading: todayLoading,
  } = useToday();
  const push = usePush();
  const moment = useOneMoment();
  const { family, live, trouble, setPaused, leave, changing, refused } = useFamily(
    familyId,
    familyId !== undefined,
  );
  const [seesOpen, setSeesOpen] = useState(false);
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
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.xl,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.xl,
      }}
    >
      {/* The tab's own name, so the title reads as the tab bar does. */}
      <Words variant="title">
        <Trans context="tab">You</Trans>
      </Words>
      <View style={{ gap: space.xs }}>
        <Words variant="heading">{family.me.name}</Words>
        <Words variant="caption" tone="ink3">
          {family.me.line}
        </Words>
      </View>
      {trouble ? (
        <Words variant="body" tone="ink2">
          <Trans>Your family could not be reached just now, so this is the example one.</Trans>
        </Words>
      ) : null}

      <View style={{ gap: space.m }}>
        <Eyebrow>
          <Trans>Your own light</Trans>
        </Eyebrow>
        {/* Symmetry (spec §9): anyone can keep a light, and would be seen as she is. */}
        <Row
          leading={<Light state={family.me.lightOn ? "lit" : "resting"} height={24} />}
          title={t`Keep a light on for me`}
          caption={t`${her} would see your light, and you choose who else. Not in the app yet.`}
          trailing={<Fixed on={family.me.lightOn} />}
        />
      </View>

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
                caption={member.line}
                trailing={
                  family.me.organiser && member.light === "on" ? (
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
          {family.nearby === undefined ? null : (
            <>
              <Hairline />
              {/* Organisers only see this row, and they choose who is on it (spec A3). */}
              <Pressable
                accessibilityRole="button"
                accessibilityHint={t`Change the people nearby`}
                onPress={() =>
                  router.push(
                    family.keptLight[0] === undefined
                      ? "/nearby"
                      : { pathname: "/nearby", params: { member: family.keptLight[0].memberId } },
                  )
                }
              >
                <Row
                  title={family.nearby.names}
                  caption={family.nearby.line}
                  trailing={
                    <Words variant="button" tone="action">
                      <Trans>Change</Trans>
                    </Words>
                  }
                />
              </Pressable>
            </>
          )}
          {family.me.organiser ? (
            <>
              <Hairline />
              {/* Organisers only: they are the ones told of a quiet morning (spec §8). */}
              <Pressable
                accessibilityRole="button"
                accessibilityHint={t`Open how the quiet notices ended`}
                onPress={() => router.push("/precision")}
              >
                <Row
                  title={t`How Vela is doing`}
                  caption={t`How the quiet notices ended, in your family and across Vela`}
                  trailing={
                    <Words variant="button" tone="action">
                      <Trans>Open</Trans>
                    </Words>
                  }
                />
              </Pressable>
            </>
          ) : null}
        </Card>
      </View>

      {family.me.organiser && family.keptLight[0] !== undefined ? (
        <View style={{ gap: space.m }}>
          <Eyebrow>
            <Trans>Her phone</Trans>
          </Eyebrow>
          <SetUpPhone
            familyId={family.familyId}
            memberId={family.keptLight[0].memberId}
            name={family.keptLight[0].name}
          />
        </View>
      ) : null}

      <View style={{ gap: space.m }}>
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
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>
          <Trans>Language</Trans>
        </Eyebrow>
        <LocaleChips />
        <Words variant="caption" tone="ink3">
          <Trans>The app's words. Her mornings keep the language she reads.</Trans>
        </Words>
        {language.refused ? (
          <Words variant="caption" tone="ink2">
            <Trans>That did not go through. Try again in a moment.</Trans>
          </Words>
        ) : null}
      </View>

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

      {/* A kept light pauses and stops in her own chat, where her mornings arrive (spec §9). */}
      {family.me.lightOn ? null : (
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
              onPress={() => setPaused(!family.me.paused)}
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
                setLeaving(true);
              }}
            >
              <Words variant="button" tone="action">
                <Trans>Leave</Trans>
              </Words>
            </Pressable>
          </View>
          {refused === undefined ? null : (
            <Words variant="caption" tone="ink2">
              {refused}
            </Words>
          )}
          {leaving ? (
            <Card>
              <Words variant="heading">
                <Trans>Leave {familyName}?</Trans>
              </Words>
              <Words variant="body" tone="ink2">
                <Trans>
                  You will stop seeing the family's days and taking turns. Thirty days on, what is
                  kept about you is deleted.
                </Trans>
              </Words>
              <SecondaryButton
                label={changing ? t`Leaving…` : t`Leave the family`}
                onPress={() => {
                  if (!live) {
                    setLeaving(false);
                    setExampleNote(true);
                    return;
                  }
                  leave(() => router.replace("/"));
                }}
              />
              <Pressable accessibilityRole="button" onPress={() => setLeaving(false)}>
                <Words variant="button" tone="action">
                  <Trans>Stay</Trans>
                </Words>
              </Pressable>
            </Card>
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
          {/* The id the development seed takes, so setting a family up needs no dashboard. */}
          <Words variant="bodyMedium" selectable>
            {account.userId ?? "—"}
          </Words>
          <Words variant="caption" tone="ink3">
            {live || todayLive
              ? t`Your account id. Nobody but you needs it.`
              : noAccount
                ? t`No family is set up on this account yet.`
                : todayTrouble
                  ? t`Your family could not be reached just now.`
                  : t`Looking for your family on this account…`}
          </Words>
          {/* push (A5): the phone is let go from the account first, so a phone handed on is not told. */}
          <SecondaryButton label={t`Sign out`} onPress={() => void push.signOut()} />
        </Card>
      ) : (
        <Words variant="caption" tone="ink3">
          <Trans>You are not signed in, so this is the example family.</Trans>
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
