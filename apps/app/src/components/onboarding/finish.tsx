import { ph } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { appPrivacyAcceptance, type CreateFamily } from "@vela/contracts";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  ApiError,
  addNearby,
  alreadyOrganiser,
  apiConfigured,
  composeAsk,
  createFamily,
  fetchMorningPreferences,
  provisionAccount,
  setMorningPreferences,
} from "../../api/client.ts";
import { useAccount } from "../../auth/clerk.tsx";
import { clockTime } from "../../data/format.ts";
import { sessionScope } from "../../data/live-state.ts";
import { arrivalAfter, deviceZone } from "../../data/onboarding.ts";
import {
  type OnboardingDraft,
  readDraft,
  resetDraft,
  updateDraft,
  updateDraftForRun,
} from "../../data/onboarding-draft.ts";
import { installOnboardingPortrait } from "../../data/onboarding-portrait.ts";
import { useToday } from "../../data/useToday.ts";
import { useAppLocale } from "../../i18n/provider.tsx";
import { usePush } from "../../push/provider.tsx";
import { space, type } from "../../theme/tokens.ts";
import { SetUpPhone } from "../set-up-phone.tsx";
import { NightScene, night } from "./night-scene.tsx";
import { NightButton, NightCopy } from "./story.tsx";

function clock(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return clockTime(hour ?? 0, minute ?? 0);
}

/**
 * A refusal that trying again cannot change: the API said no to this one ask or person (a phone
 * number in a name, say). Saving goes on without it, since everything else the organiser gave is
 * still worth keeping, and they can add it again from Today.
 */
function refusedForGood(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

/**
 * Saving everything onboarding gathered, once the organiser has an account: their account if it
 * is new, her family with who she is, what she loves and how she answers, her first week as their
 * asks, the people nearby, who signs on quiet days, and her photo on this phone. Each write has a
 * key from the draft's run, and the draft records how far saving got, so trying again, or coming
 * back after the app was put away, carries on rather than writing anything twice.
 */
export function Save({ name }: { name: string }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const queries = useQueryClient();
  const { locale } = useAppLocale();
  const today = useToday();
  const [problem, setProblem] = useState<"trouble" | "already" | null>(null);
  const running = useRef(false);

  const save = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setProblem(null);
    try {
      const start = readDraft();
      const run = start.run;
      if (!start.privacyAccepted) throw new Error("Privacy permission required");
      const updateDraft = (change: Partial<OnboardingDraft>) => updateDraftForRun(run, change);
      if (!apiConfigured()) {
        // The example family: nothing is sent anywhere, and the invitation is an example too.
        updateDraft({
          created: {
            familyId: "example",
            memberId: "example",
            arrival: arrivalAfter(start.wake),
            invite: {
              text: t`Hi ${name}, it’s ${ph({ you: start.you.trim() })}. I’ve set up Vela for us: one small question from me each morning. Tap to see it, then decide. (An example invitation: nothing was sent.)`,
              lineText: null,
              lineUrl: null,
            },
          },
          step: "invite",
        });
        return;
      }
      const token = await account.token();
      let created = start.created;
      if (created === null) {
        {
          const profile = {
            display_name: start.you.trim(),
            privacy_acceptance: appPrivacyAcceptance(),
            language: locale,
            tz: deviceZone(start.zone),
          };
          await provisionAccount(profile, `provision:${run}`, token);
        }
        const family: CreateFamily = {
          country: start.country,
          kept_light_member: {
            display_name: name,
            address_form: name,
            language: start.language,
            tz: start.zone,
            wake_time: start.wake,
            relationship: start.relationship,
            interests: start.interests,
            reply_ways: start.unsure ? [] : start.replyWays,
          },
        };
        const made = await createFamily(family, `family:${run}`, token);
        created = {
          familyId: made.family.id,
          memberId: made.kept_light_member.id,
          arrival: made.kept_light_member.arrival_time,
          invite: {
            text: made.invite.text,
            lineText: made.invite.line_text,
            lineUrl: made.invite.line_url,
          },
        };
        updateDraft({ created });
      }
      const { familyId, memberId } = created;

      // Her first week stays in order, one ask after the other, since they reach her in the order
      // they were queued. Everything else is independent of it and of each other, so it is saved
      // at the same time: the wait is the longest part, not the sum of them all.
      const saveAsks = async () => {
        for (let index = readDraft().saved.asks; index < start.week.length; index += 1) {
          const text = start.week[index];
          if (text !== undefined) {
            try {
              await composeAsk(
                familyId,
                `ask:${run}:${index}`,
                { recipient_id: memberId, type: "question", text, when: "whenever" },
                token,
              );
            } catch (error) {
              if (!refusedForGood(error)) throw error;
            }
          }
          updateDraft({ saved: { ...readDraft().saved, asks: index + 1 } });
        }
      };

      // Each person has their own key, so trying again repeats none of them.
      const saveNearby = async () => {
        const first = readDraft().saved.nearby;
        await Promise.all(
          start.people.slice(first).map(async (person, offset) => {
            try {
              await addNearby(
                familyId,
                { member_id: memberId, name: person.name, relation: person.relation },
                `nearby:${run}:${first + offset}`,
                token,
              );
            } catch (error) {
              if (!refusedForGood(error)) throw error;
            }
          }),
        );
        updateDraft({ saved: { ...readDraft().saved, nearby: start.people.length } });
      };

      const saveSendAsMe = async () => {
        if (start.nobody !== "me" || readDraft().saved.sendAsMe) return;
        const morning = await fetchMorningPreferences(familyId, memberId, token);
        if (morning.send_as_me_available === true) {
          await setMorningPreferences(
            familyId,
            memberId,
            { arrival_time: morning.arrival_time, language: start.language, send_as_me: true },
            `morning:${run}`,
            token,
          );
        }
        updateDraft({ saved: { ...readDraft().saved, sendAsMe: true } });
      };

      if (start.photo?.kind === "picked" && !readDraft().saved.portrait) {
        try {
          installOnboardingPortrait(sessionScope(account), familyId, memberId, start.photo.source);
        } catch {
          /* A photo that cannot be kept here leaves her initials; it can be added again later. */
        }
        updateDraft({ saved: { ...readDraft().saved, portrait: true } });
      }

      await Promise.all([saveAsks(), saveNearby(), saveSendAsMe()]);

      // The next screens read these again on their own; the invitation does not wait for them.
      void queries.invalidateQueries({ queryKey: ["me"] });
      void queries.invalidateQueries({ queryKey: ["today"] });
      void queries.invalidateQueries({ queryKey: ["portrait"] });
      updateDraft({ step: "invite" });
    } catch (error) {
      setProblem(alreadyOrganiser(error) ? "already" : "trouble");
    } finally {
      running.current = false;
    }
  }, [account, locale, name, queries, t]);

  const waiting = apiConfigured() && today.loading;
  useEffect(() => {
    if (!waiting && problem === null) void save();
  }, [waiting, problem, save]);

  return (
    <NightScene dim={0.7} glow={0.5}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: space.margin,
          paddingBottom: insets.bottom + space.xl,
          gap: space.l,
        }}
      >
        {problem === null ? (
          <>
            <ActivityIndicator color={night.amber} style={{ alignSelf: "flex-start" }} />
            <NightCopy
              eyebrow={t`Saving`}
              title={t`Keeping ${name}’s mornings safe…`}
              body={t`The family, the first week and everything you told us.`}
            />
          </>
        ) : problem === "already" ? (
          <>
            <NightCopy
              eyebrow={t`Already set up`}
              title={t`This account already runs a family.`}
              body={t`Open Today to see it.`}
            />
            <NightButton
              label={t`Go to Today`}
              onPress={() => {
                resetDraft();
                router.replace("/");
              }}
            />
          </>
        ) : (
          <>
            <NightCopy
              eyebrow={t`Not saved yet`}
              title={t`That could not be saved just now.`}
              body={t`Nothing was lost; try again.`}
            />
            <NightButton label={t`Try again`} onPress={() => void save()} />
          </>
        )}
      </View>
    </NightScene>
  );
}

/**
 * The invitation, sent by the organiser from their own chat in their own name (Locket, Life360):
 * she hears about Vela from her family, never from a stranger, and nothing reaches her until she
 * says yes. Her own phone is set up together instead, where it was chosen.
 */
export function Invite({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const [trouble, setTrouble] = useState(false);
  const created = draft.created;
  if (created === null) return null;
  const onLine = draft.messenger === "line" && created.invite.lineText !== null;
  const words = onLine ? (created.invite.lineText ?? created.invite.text) : created.invite.text;
  // Product names, the same in every language.
  const app = onLine ? "LINE" : "Telegram";
  const next = () => updateDraft({ step: "notify" });
  const send = async () => {
    try {
      const result = await Share.share({ message: words });
      if (result.action !== Share.dismissedAction) next();
    } catch {
      setTrouble(true);
    }
  };

  return (
    <NightScene dim={0.8} glow={0.3}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: space.margin,
          paddingBottom: insets.bottom + space.xl,
          gap: space.l,
        }}
      >
        {draft.messenger === "phone" ? (
          <>
            <NightCopy
              eyebrow={t`The last step is ${name}’s`}
              title={t`Set up Vela on ${name}’s phone.`}
              body={t`When you are together, sign in on ${name}’s phone. It shows one message at a time in large words, and asks ${name} first: nothing arrives before a yes.`}
            />
            <View style={{ backgroundColor: "#FBF7F0", borderRadius: 22, padding: space.l }}>
              <SetUpPhone familyId={created.familyId} memberId={created.memberId} name={name} />
            </View>
            <NightButton label={t`Next`} onPress={next} />
          </>
        ) : (
          <>
            <NightCopy
              eyebrow={t`The last step is ${name}’s`}
              title={t`Send ${name} the invitation.`}
              body={t`It comes from you, in ${app}, so ${name} knows it’s really you.`}
            />
            <View
              style={{
                alignSelf: "flex-end",
                maxWidth: 330,
                padding: space.l,
                borderRadius: 22,
                borderBottomRightRadius: 6,
                backgroundColor: "#FFFFFF",
              }}
            >
              <Text selectable style={[type.body, { color: night.onAmber }]}>
                {words}
              </Text>
            </View>
            {draft.messenger === "line" && !onLine ? (
              <Text style={[type.caption, { color: night.creamSoft }]}>
                {t`LINE isn’t open here yet, so this invitation opens Telegram.`}
              </Text>
            ) : null}
            {onLine ? null : (
              <Text style={[type.caption, { color: night.creamSoft }]}>
                {t`If the link doesn’t open for ${name}, ask ${name} to add you as a contact, then tap it again.`}
              </Text>
            )}
            {trouble ? (
              <Text style={[type.caption, { color: night.cream }]}>
                {t`This phone cannot share from here. Copy the words above and send them yourself.`}
              </Text>
            ) : null}
            <View style={{ gap: space.xs }}>
              <NightButton label={t`Send on ${app}`} onPress={() => void send()} />
              <NightButton quiet label={t`I have sent it`} onPress={next} />
            </View>
          </>
        )}
      </View>
    </NightScene>
  );
}

/**
 * Notifications, asked for after the invitation is sent, when what they are for has just been
 * said (Apple HIG; ADR-34), and only where this Vela sends them. "Not now" stays: the phone's own
 * prompt may never be forced.
 */
export function Notify({ name }: { name: string }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const push = usePush();
  const today = useToday();
  const phone = push.phone;
  const offered =
    apiConfigured() &&
    today.pushSent &&
    push.availability.available &&
    phone !== null &&
    phone.permission !== "granted";
  useEffect(() => {
    if (!offered) updateDraft({ step: "ready" });
  }, [offered]);
  if (!offered || phone === null)
    return (
      <NightScene dim={0.8} glow={0.3}>
        {null}
      </NightScene>
    );
  const settings = !phone.canAskAgain;
  return (
    <NightScene dim={0.8} glow={0.3}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: space.margin,
          paddingBottom: insets.bottom + space.xl,
          gap: space.l,
        }}
      >
        <View
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            backgroundColor: "rgba(233,162,59,0.16)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Svg width={40} height={40} viewBox="0 0 24 24">
            <Path
              d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"
              fill="none"
              stroke={night.amber}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <NightCopy
          eyebrow={t`Invitation sent`}
          title={t`Know the moment ${name} says yes.`}
          body={t`And each morning ${name} answers. Only about ${name}, never ads.`}
        />
        <View style={{ gap: space.xs }}>
          <NightButton
            label={
              settings ? t`Open settings` : push.asking ? t`Asking…` : t`Turn on notifications`
            }
            disabled={push.asking}
            onPress={() => {
              if (settings) {
                push.openSettings();
                updateDraft({ step: "ready" });
                return;
              }
              void push.ask().then(() => updateDraft({ step: "ready" }));
            }}
          />
          <NightButton quiet label={t`Not now`} onPress={() => updateDraft({ step: "ready" })} />
        </View>
      </View>
    </NightScene>
  );
}

function Milestone({ text, state }: { text: string; state: "done" | "next" | "later" }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        paddingVertical: space.m,
        borderTopWidth: 1,
        borderColor: night.creamFaint,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: state === "later" ? "rgba(251,244,231,0.3)" : night.amber,
          backgroundColor: state === "done" ? night.amber : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {state === "done" ? (
          <Svg width={12} height={12} viewBox="0 0 24 24">
            <Path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke={night.onAmber}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>
      <Text
        style={[type.body, { flex: 1, color: state === "later" ? night.creamSoft : night.cream }]}
      >
        {text}
      </Text>
    </View>
  );
}

/** The end of setup: her window, ready and waiting, and what happens next (the peak-end rule). */
export function Ready({ draft, name }: { draft: OnboardingDraft; name: string }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const time = clock(draft.created?.arrival ?? arrivalAfter(draft.wake));
  return (
    <NightScene dim={0.5} glow={0} breathing>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          paddingHorizontal: space.margin,
          paddingBottom: insets.bottom + space.xl,
          gap: space.l,
        }}
      >
        <NightCopy
          eyebrow={t`Ready`}
          title={t`${name}’s window is ready.`}
          body={t`It lights the first time ${name} answers. Nothing is sent before ${name} says yes.`}
        >
          <View>
            <Milestone text={t`Invitation sent`} state="done" />
            <Milestone text={t`${name} says yes`} state="next" />
            <Milestone text={t`First morning, the next day at ${time}`} state="later" />
          </View>
        </NightCopy>
        <NightButton
          label={t`Go to Today`}
          onPress={() => {
            resetDraft();
            router.replace("/");
          }}
        />
      </View>
    </NightScene>
  );
}
