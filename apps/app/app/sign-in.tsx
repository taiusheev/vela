import { useSignIn, useSignUp } from "@clerk/clerk-expo";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { accountsConfigured } from "../src/auth/clerk.tsx";
import { Light } from "../src/components/light.tsx";
import { PrimaryButton, SecondaryButton, TextField, Words } from "../src/components/ui.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type Step = "identifier" | "code";
/** Which of Clerk's two one-time codes this attempt is carrying. */
type Strategy = "email_code" | "phone_code";

function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}

/**
 * However she wrote the number: spaces, dashes and brackets are hers, not its. An email keeps every
 * character it has — the dots in one are part of the address, not punctuation to tidy away.
 */
function tidy(raw: string): string {
  const trimmed = raw.trim();
  return looksLikeEmail(trimmed) ? trimmed : trimmed.replace(/[\s()\-.‐-―]/g, "");
}

/**
 * A number written the way it is said at home keeps the national 0 — 0903 224 780 in Taipei — and
 * international form drops it. Rather than guess, the screen offers the number back without it.
 */
function withoutTrunkZero(identifier: string): string | null {
  const match = /^(\+\d{1,3})0(\d{6,})$/.exec(identifier);
  return match === null ? null : `${match[1]}${match[2]}`;
}

/** A bot check that never finishes must not leave her watching "Sending…" for ever. */
const PATIENCE_MS = 25_000;

class TookTooLong extends Error {
  override readonly name = "TookTooLong";
}

async function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TookTooLong()), PATIENCE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A number or an email, whichever the account was made with, and a code to the same place (build
 * plan 3.1). Apple and Google come next; they need the app's store identifiers.
 */
export default function SignInScreen() {
  // A checkout without a Clerk key has no accounts at all; the screen says so rather than asking
  // Clerk's hooks for a provider that is not there.
  return accountsConfigured() ? <CodeSignIn /> : <NoAccounts />;
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

function CodeSignIn() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [step, setStep] = useState<Step>("identifier");
  // Which half of Clerk is carrying this attempt: an account it knows, or one it is meeting.
  const [joining, setJoining] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>("email_code");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [trouble, setTrouble] = useState<string | undefined>();
  const [working, setWorking] = useState(false);
  const ready = isLoaded && signUpLoaded && signIn !== undefined && signUp !== undefined;

  /** Not yet an account: the same code, through the other door. */
  const startJoining = async (entered: string) => {
    if (signUp === undefined) return false;
    if (looksLikeEmail(entered)) {
      await within(signUp.create({ emailAddress: entered }));
      await within(signUp.prepareEmailAddressVerification({ strategy: "email_code" }));
      setStrategy("email_code");
    } else {
      await within(signUp.create({ phoneNumber: entered }));
      await within(signUp.preparePhoneNumberVerification({ strategy: "phone_code" }));
      setStrategy("phone_code");
    }
    setJoining(true);
    return true;
  };

  const sendCode = async () => {
    if (!ready || signIn === undefined) return;
    const entered = tidy(identifier);
    if (entered.length === 0) return;
    setWorking(true);
    setTrouble(undefined);
    try {
      const attempt = await within(signIn.create({ identifier: entered }));
      // Whichever way this account can be reached; an account made with an email has no number.
      const factor = attempt.supportedFirstFactors?.find(
        (candidate) => candidate.strategy === "email_code" || candidate.strategy === "phone_code",
      );
      if (factor === undefined) {
        setTrouble("That account cannot receive a code yet.");
        return;
      }
      if (factor.strategy === "email_code") {
        await within(
          signIn.prepareFirstFactor({
            strategy: "email_code",
            emailAddressId: factor.emailAddressId,
          }),
        );
        setStrategy("email_code");
      } else if (factor.strategy === "phone_code") {
        await within(
          signIn.prepareFirstFactor({
            strategy: "phone_code",
            phoneNumberId: factor.phoneNumberId,
          }),
        );
        setStrategy("phone_code");
      }
      setJoining(false);
      setStep("code");
    } catch {
      // The first family through the door has no account yet, so something Clerk does not know is
      // the ordinary first run, not a mistake. Only one it cannot use either is worth saying.
      try {
        if (await startJoining(entered)) setStep("code");
        else setTrouble("That did not work. Check it and try again.");
      } catch (error: unknown) {
        // Clerk's message can name the account; the screen says only what the person can act on.
        const shorter = withoutTrunkZero(entered);
        setTrouble(
          error instanceof TookTooLong
            ? "The bot check did not finish. Try again in a moment."
            : shorter === null
              ? "That did not work. Check it and try again."
              : `That number did not work. The 0 after the country code is dropped abroad — try ${shorter}.`,
        );
      }
    } finally {
      setWorking(false);
    }
  };

  const enter = async () => {
    if (!ready || signIn === undefined || signUp === undefined) return;
    setWorking(true);
    setTrouble(undefined);
    try {
      // The two halves answer with different shapes, so each is asked on its own terms.
      let session: string | null;
      if (joining) {
        const attempt = await within(
          strategy === "email_code"
            ? signUp.attemptEmailAddressVerification({ code: code.trim() })
            : signUp.attemptPhoneNumberVerification({ code: code.trim() }),
        );
        // A right code that still cannot finish means this instance asks for more than this, which
        // is a setting, not something she can fix by typing the six digits again.
        if (attempt.status === "missing_requirements") {
          setTrouble("That code was right, but this account needs more than that to finish.");
          return;
        }
        session = attempt.status === "complete" ? attempt.createdSessionId : null;
      } else {
        const attempt = await within(signIn.attemptFirstFactor({ strategy, code: code.trim() }));
        session = attempt.status === "complete" ? attempt.createdSessionId : null;
      }
      if (session === null) {
        setTrouble("That code did not work. Ask for a new one.");
        return;
      }
      await setActive({ session });
      router.replace("/");
    } catch (error: unknown) {
      setTrouble(
        error instanceof TookTooLong
          ? "That took too long to check. Try the code again."
          : "That code did not work. Ask for a new one.",
      );
    } finally {
      setWorking(false);
    }
  };

  const sentTo = strategy === "email_code" ? "your email" : tidy(identifier);

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
        {step === "identifier" ? (
          <>
            <Words variant="body" tone="ink2">
              Your number or your email, and we send you a code.
            </Words>
            <TextField
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="+886 900 000 000"
              helper="A number needs its country code."
              autoComplete="tel"
              autoFocus
              onSubmit={() => void sendCode()}
            />
            <PrimaryButton label={working ? "Sending…" : "Send me a code"} onPress={sendCode} />
          </>
        ) : (
          <>
            <Words variant="body" tone="ink2">
              {`We sent a code to ${sentTo}.`}
            </Words>
            <TextField
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              helper="Six digits, good for ten minutes."
              keyboardType="number-pad"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              onSubmit={() => void enter()}
            />
            <PrimaryButton label={working ? "Checking…" : "Enter"} onPress={enter} />
            <SecondaryButton
              label="Use something else"
              onPress={() => {
                setStep("identifier");
                setCode("");
                setJoining(false);
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
        {/*
          Clerk's bot check for a new account mounts itself into an element of this name, and says
          so loudly when it cannot find one. On the web this renders that element; on a phone it is
          an empty view, and Clerk uses its own native check there.
        */}
        <View nativeID="clerk-captcha" style={{ alignItems: "center" }} />
      </ScrollView>
    </>
  );
}
