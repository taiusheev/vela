import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiCreatedFamily, CreateFamily } from "@vela/contracts";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { alreadyOrganiser, createFamily, provisionAccount } from "../src/api/client.ts";
import { useIdempotencyKey } from "../src/api/idempotency.ts";
import { useAccount } from "../src/auth/clerk.tsx";
import { Light } from "../src/components/light.tsx";
import {
  Card,
  Chip,
  Eyebrow,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import {
  arrivalAfter,
  countries,
  deviceZone,
  languages,
  wakeTimes,
} from "../src/data/onboarding.ts";
import { useToday } from "../src/data/useToday.ts";
import { useAppLocale } from "../src/i18n/provider.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type Step = "who" | "invite" | "ready";

/**
 * Onboarding (spec §14.1 A1, A4, A5): who she is, the words to send her, and the light ready and
 * waiting for her yes. A2's first ask comes once she has said yes, from Ask, because nobody may
 * ask her anything before; A3's nearby contacts come with the Vela Light screens.
 */
export default function OnboardingScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useLingui();
  const { locale } = useAppLocale();
  const account = useAccount();
  const queries = useQueryClient();
  const { noAccount } = useToday();
  const [step, setStep] = useState<Step>("who");
  const [yourName, setYourName] = useState("");
  const [herName, setHerName] = useState("");
  const [address, setAddress] = useState("");
  const [language, setLanguage] = useState<"en" | "zh-TW">("en");
  const [countryCode, setCountryCode] = useState("TW");
  const [zone, setZone] = useState("Asia/Taipei");
  const [wake, setWake] = useState<string>("07:30");
  const [created, setCreated] = useState<ApiCreatedFamily | null>(null);
  const [shareTrouble, setShareTrouble] = useState(false);
  const provisionKey = useIdempotencyKey("provision");
  const familyKey = useIdempotencyKey("family");

  const country = countries.find((choice) => choice.code === countryCode) ?? countries[0];
  const chooseCountry = (code: string) => {
    setCountryCode(code);
    const first = countries.find((choice) => choice.code === code)?.zones[0];
    if (first !== undefined) setZone(first.zone);
  };

  const create = useMutation({
    mutationFn: async () => {
      const token = await account.token();
      // A first run has no account yet: the organiser's name, language and zone live there. The
      // language is the one the app is in, which the organiser chose or the device gave.
      if (noAccount) {
        const profile = {
          display_name: yourName.trim(),
          language: locale,
          tz: deviceZone(zone),
        };
        await provisionAccount(profile, provisionKey(profile), token);
      }
      const family: CreateFamily = {
        country: countryCode,
        kept_light_member: {
          display_name: herName.trim(),
          address_form: address.trim().length > 0 ? address.trim() : herName.trim(),
          language,
          tz: zone,
          wake_time: wake,
        },
      };
      return createFamily(family, familyKey(family), token);
    },
    onSuccess: async (family) => {
      setCreated(family);
      setStep("invite");
      // Today must learn there is a family now, or it would send the organiser straight back here.
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["me"] }),
        queries.invalidateQueries({ queryKey: ["today"] }),
      ]);
    },
  });

  const needsYourName = noAccount && yourName.trim().length === 0;
  const ready = herName.trim().length > 0 && !needsYourName && !create.isPending;
  // When her morning comes: after the waking time chosen so far, then as the family was made.
  const time = created?.kept_light_member.arrival_time ?? arrivalAfter(wake);
  const name = created?.kept_light_member.display_name;
  const refusal = create.isError
    ? alreadyOrganiser(create.error)
      ? t`This account already runs a family.`
      : t`That could not be saved just now. Nothing was lost; try again.`
    : null;

  const share = async () => {
    if (created === null) return;
    try {
      await Share.share({ message: created.invite.text });
    } catch {
      setShareTrouble(true);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        {step === "who" ? (
          <>
            <Words variant="title">
              <Trans>Who are you keeping a light on for?</Trans>
            </Words>
            {noAccount ? (
              <TextField
                value={yourName}
                onChangeText={setYourName}
                placeholder="Mia"
                helper={t`Your name, as the family says it.`}
              />
            ) : null}
            <TextField
              value={herName}
              onChangeText={setHerName}
              placeholder={t`Mom`}
              helper={t`Her name, as the family calls her.`}
            />
            <TextField
              value={address}
              onChangeText={setAddress}
              placeholder={t`Mrs Chen`}
              helper={t`How Vela greets her each morning.`}
            />

            <View style={{ gap: space.m }}>
              <Words variant="heading">
                <Trans>She reads</Trans>
              </Words>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                {languages.map((choice) => (
                  <Chip
                    key={choice.value}
                    label={choice.label}
                    selected={language === choice.value}
                    onPress={() => setLanguage(choice.value)}
                  />
                ))}
              </View>
            </View>

            <View style={{ gap: space.m }}>
              <Words variant="heading">
                <Trans>She lives in</Trans>
              </Words>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                {countries.map((choice) => (
                  <Chip
                    key={choice.code}
                    label={i18n._(choice.label)}
                    selected={countryCode === choice.code}
                    onPress={() => chooseCountry(choice.code)}
                  />
                ))}
              </View>
              {country !== undefined && country.zones.length > 1 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                  {country.zones.map((choice) => (
                    <Chip
                      key={choice.zone}
                      label={i18n._(choice.label)}
                      selected={zone === choice.zone}
                      onPress={() => setZone(choice.zone)}
                    />
                  ))}
                </View>
              ) : null}
            </View>

            <View style={{ gap: space.m }}>
              <Words variant="heading">
                <Trans>She usually wakes at</Trans>
              </Words>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                {wakeTimes.map((choice) => (
                  <Chip
                    key={choice}
                    label={choice}
                    selected={wake === choice}
                    onPress={() => setWake(choice)}
                  />
                ))}
              </View>
              <Words variant="body" tone="ink2">
                <Trans>Her morning comes at {time}, half an hour after she wakes.</Trans>
              </Words>
            </View>

            {refusal === null ? null : (
              <Words variant="body" tone="ink2">
                {refusal}
              </Words>
            )}
            <PrimaryButton
              label={create.isPending ? t`Setting up…` : t`Next`}
              onPress={() => create.mutate()}
              disabled={!ready}
            />
            {create.isError && alreadyOrganiser(create.error) ? (
              <SecondaryButton label={t`Go to Today`} onPress={() => router.replace("/")} />
            ) : null}
          </>
        ) : null}

        {step === "invite" && created !== null ? (
          <>
            <Words variant="title">
              <Trans>Now ask {name}</Trans>
            </Words>
            <Words variant="body" tone="ink2">
              <Trans>
                Nothing reaches her until she says yes. Send her these words; the link tells her
                what Vela is and asks her.
              </Trans>
            </Words>
            <Card>
              <Eyebrow>
                <Trans>What you send her</Trans>
              </Eyebrow>
              <Words variant="voice" selectable>
                {created.invite.text}
              </Words>
            </Card>
            <Words variant="caption" tone="ink3">
              <Trans>She answers on Telegram for now. LINE and WhatsApp come next.</Trans>
            </Words>
            {shareTrouble ? (
              <Words variant="body" tone="ink2">
                <Trans>
                  This device cannot share from here. Copy the words above and send them to her
                  yourself.
                </Trans>
              </Words>
            ) : null}
            <PrimaryButton label={t`Send it to her`} onPress={() => void share()} />
            <SecondaryButton label={t`I have sent it`} onPress={() => setStep("ready")} />
          </>
        ) : null}

        {step === "ready" && created !== null ? (
          <View style={{ alignItems: "center", gap: space.l }}>
            <Light state="resting" height={120} />
            <Words variant="title">
              <Trans>The light is ready</Trans>
            </Words>
            <Words variant="body" tone="ink2">
              <Trans>Her first morning is the day after she says yes, at {time}.</Trans>
            </Words>
            <PrimaryButton label={t`Go to Today`} onPress={() => router.replace("/")} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
