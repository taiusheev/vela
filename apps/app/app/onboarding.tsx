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
      // A first run has no account yet: the organiser's name, language and zone live there.
      if (noAccount) {
        const profile = {
          display_name: yourName.trim(),
          language: "en" as const,
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
  const arrival = arrivalAfter(wake);
  const refusal = create.isError
    ? alreadyOrganiser(create.error)
      ? "This account already runs a family."
      : "That could not be saved just now. Nothing was lost; try again."
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
            <Words variant="title">Who are you keeping a light on for?</Words>
            {noAccount ? (
              <TextField
                value={yourName}
                onChangeText={setYourName}
                placeholder="Mia"
                helper="Your name, as the family says it."
              />
            ) : null}
            <TextField
              value={herName}
              onChangeText={setHerName}
              placeholder="Mom"
              helper="Her name, as the family calls her."
            />
            <TextField
              value={address}
              onChangeText={setAddress}
              placeholder="Mrs Chen"
              helper="How Vela greets her each morning."
            />

            <View style={{ gap: space.m }}>
              <Words variant="heading">She reads</Words>
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
              <Words variant="heading">She lives in</Words>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                {countries.map((choice) => (
                  <Chip
                    key={choice.code}
                    label={choice.label}
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
                      label={choice.label}
                      selected={zone === choice.zone}
                      onPress={() => setZone(choice.zone)}
                    />
                  ))}
                </View>
              ) : null}
            </View>

            <View style={{ gap: space.m }}>
              <Words variant="heading">She usually wakes at</Words>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                {wakeTimes.map((time) => (
                  <Chip
                    key={time}
                    label={time}
                    selected={wake === time}
                    onPress={() => setWake(time)}
                  />
                ))}
              </View>
              <Words variant="body" tone="ink2">
                {`Her morning comes at ${arrival}, half an hour after she wakes.`}
              </Words>
            </View>

            {refusal === null ? null : (
              <Words variant="body" tone="ink2">
                {refusal}
              </Words>
            )}
            <PrimaryButton
              label={create.isPending ? "Setting up…" : "Next"}
              onPress={() => create.mutate()}
              disabled={!ready}
            />
            {create.isError && alreadyOrganiser(create.error) ? (
              <SecondaryButton label="Go to Today" onPress={() => router.replace("/")} />
            ) : null}
          </>
        ) : null}

        {step === "invite" && created !== null ? (
          <>
            <Words variant="title">{`Now ask ${created.kept_light_member.display_name}`}</Words>
            <Words variant="body" tone="ink2">
              {`Nothing reaches her until she says yes. Send her these words; the link tells her what Vela is and asks her.`}
            </Words>
            <Card>
              <Eyebrow>WHAT YOU SEND HER</Eyebrow>
              <Words variant="voice" selectable>
                {created.invite.text}
              </Words>
            </Card>
            <Words variant="caption" tone="ink3">
              She answers on Telegram for now. LINE and WhatsApp come next.
            </Words>
            {shareTrouble ? (
              <Words variant="body" tone="ink2">
                This device cannot share from here. Copy the words above and send them to her
                yourself.
              </Words>
            ) : null}
            <PrimaryButton label="Send it to her" onPress={() => void share()} />
            <SecondaryButton label="I have sent it" onPress={() => setStep("ready")} />
          </>
        ) : null}

        {step === "ready" && created !== null ? (
          <View style={{ alignItems: "center", gap: space.l }}>
            <Light state="resting" height={120} />
            <Words variant="title">The light is ready</Words>
            <Words variant="body" tone="ink2">
              {`Her first morning is the day after she says yes, at ${created.kept_light_member.arrival_time}.`}
            </Words>
            <PrimaryButton label="Go to Today" onPress={() => router.replace("/")} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
