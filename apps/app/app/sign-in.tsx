import { useSignIn } from "@clerk/clerk-expo";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { accountsConfigured } from "../src/auth/clerk.tsx";
import { Light } from "../src/components/light.tsx";
import { PrimaryButton, SecondaryButton, TextField, Words } from "../src/components/ui.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type Step = "phone" | "code";

/**
 * Phone first, because the organiser is often signing in on a train with one hand (build plan
 * 3.1). Apple and Google come next; they need the app's store identifiers.
 */
export default function SignInScreen() {
  // A checkout without a Clerk key has no accounts at all; the screen says so rather than asking
  // Clerk's hooks for a provider that is not there.
  return accountsConfigured() ? <PhoneSignIn /> : <NoAccounts />;
}

function NoAccounts() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.bg,
        paddingTop: insets.top + space.xxxl,
        paddingHorizontal: space.margin,
        gap: space.l,
        alignItems: "center",
      }}
    >
      <Light state="resting" height={120} />
      <Words variant="title">No accounts yet</Words>
      <Words variant="body" tone="ink2">
        This build has no sign-in configured, so it shows example days.
      </Words>
    </View>
  );
}

function PhoneSignIn() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [trouble, setTrouble] = useState<string | undefined>();
  const [working, setWorking] = useState(false);

  const sendCode = async () => {
    if (!isLoaded || signIn === undefined) return;
    setWorking(true);
    setTrouble(undefined);
    try {
      const attempt = await signIn.create({ identifier: phone.trim() });
      const factor = attempt.supportedFirstFactors?.find(
        (candidate) => candidate.strategy === "phone_code",
      );
      if (factor === undefined || !("phoneNumberId" in factor)) {
        setTrouble("That number cannot receive a code yet.");
        return;
      }
      await signIn.prepareFirstFactor({
        strategy: "phone_code",
        phoneNumberId: factor.phoneNumberId,
      });
      setStep("code");
    } catch {
      // Clerk's message can name the account; the screen says only what the person can act on.
      setTrouble("That number did not work. Check it and try again.");
    } finally {
      setWorking(false);
    }
  };

  const enter = async () => {
    if (!isLoaded || signIn === undefined) return;
    setWorking(true);
    setTrouble(undefined);
    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: "phone_code",
        code: code.trim(),
      });
      if (attempt.status !== "complete") {
        setTrouble("That code did not work. Ask for a new one.");
        return;
      }
      await setActive({ session: attempt.createdSessionId });
      router.replace("/");
    } catch {
      setTrouble("That code did not work. Ask for a new one.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: insets.top + space.xxxl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
        }}
      >
        <View style={{ alignItems: "center", gap: space.l }}>
          <Light state="lit" height={120} />
          <Words variant="title">Vela Light</Words>
        </View>
        {step === "phone" ? (
          <>
            <Words variant="body" tone="ink2">
              Your number, and we send you a code.
            </Words>
            <TextField
              value={phone}
              onChangeText={setPhone}
              placeholder="+886 900 000 000"
              helper="The number you answer on."
            />
            <PrimaryButton label={working ? "Sending…" : "Send me a code"} onPress={sendCode} />
          </>
        ) : (
          <>
            <Words variant="body" tone="ink2">
              {`We sent a code to ${phone.trim()}.`}
            </Words>
            <TextField
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              helper="Six digits, good for ten minutes."
            />
            <PrimaryButton label={working ? "Checking…" : "Enter"} onPress={enter} />
            <SecondaryButton
              label="Use another number"
              onPress={() => {
                setStep("phone");
                setCode("");
                setTrouble(undefined);
              }}
            />
          </>
        )}
        {trouble === undefined ? null : (
          <Words variant="body" tone="ink2">
            {trouble}
          </Words>
        )}
      </ScrollView>
    </>
  );
}
