import { useSignIn, useSignUp } from "@clerk/clerk-expo";
import { Trans, useLingui } from "@lingui/react/macro";
import { getLocales } from "expo-localization";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { accountsConfigured } from "../src/auth/clerk.tsx";
import {
  COUNTRIES,
  type Country,
  countryName,
  defaultCountry,
  flagOf,
  readable,
  toInternational,
} from "../src/auth/phone.ts";
import { Light } from "../src/components/light.tsx";
import { LocaleChips } from "../src/components/locale-chips.tsx";
import { Chip, PrimaryButton, SecondaryButton, TextField, Words } from "../src/components/ui.tsx";
import { usePalette } from "../src/theme/theme.tsx";
import { space } from "../src/theme/tokens.ts";

type Step = "identifier" | "code";
/** Which of Clerk's two one-time codes this attempt is carrying. */
type Strategy = "email_code" | "phone_code";
/**
 * What went wrong, kept as what happened and put into words only as the screen draws, so the words
 * follow the app's language when it changes (build plan 3.1).
 */
type Trouble = {
  kind:
    | "cannot_receive"
    | "did_not_work"
    | "bot_check"
    | "needs_more"
    | "wrong_code"
    | "code_took_too_long"
    | "number_invalid"
    | "country_unsupported"
    | "phone_off"
    | "email_invalid";
};

/**
 * In development only, Clerk's error codes (such as `form_code_incorrect`) to the bundler's log, so
 * a sign-in that fails on a test phone can be read from the Mac. Never the message or the identifier,
 * which can name the person.
 */
function logClerkCodes(step: "lookup" | "send" | "verify", error: unknown): void {
  if (!__DEV__) return;
  const errors = (error as { errors?: { code?: unknown }[] } | null)?.errors;
  const codes = Array.isArray(errors) ? errors.map((entry) => String(entry.code)) : [];
  console.warn(
    `[sign-in] ${step} failed:`,
    codes.length === 0 ? String((error as Error)?.name) : codes.join(", "),
  );
}

function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}

/** Clerk's error codes, which name what went wrong without naming the person. */
function codesOf(error: unknown): string[] {
  const errors = (error as { errors?: { code?: unknown }[] } | null)?.errors;
  return Array.isArray(errors) ? errors.map((entry) => String(entry.code)) : [];
}

/** What a refused number or address means for the person, from Clerk's codes. */
function refusalOf(error: unknown, phone: boolean): Trouble {
  const codes = codesOf(error).join(" ");
  if (/country/.test(codes)) return { kind: "country_unsupported" };
  if (/strategy|not_allowed|not_enabled/.test(codes)) {
    return { kind: phone ? "phone_off" : "did_not_work" };
  }
  if (/format|invalid/.test(codes)) return { kind: phone ? "number_invalid" : "email_invalid" };
  return { kind: "did_not_work" };
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
      <Words variant="title">
        <Trans>No accounts yet</Trans>
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>This build has no sign-in configured, so it shows example days.</Trans>
      </Words>
      <LocaleChips />
    </View>
  );
}

function CodeSignIn() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const [step, setStep] = useState<Step>("identifier");
  // Which half of Clerk is carrying this attempt: an account it knows, or one it is meeting.
  const [joining, setJoining] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>("email_code");
  // A number by default, chosen country first; an email is one tap away.
  const [mode, setMode] = useState<"phone" | "email">("phone");
  const [country, setCountry] = useState<Country>(() =>
    defaultCountry(getLocales()[0]?.regionCode ?? null),
  );
  const [picking, setPicking] = useState(false);
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const international = toInternational(country, number);
  const identifier = mode === "phone" ? (international ?? "") : email.trim();
  const [code, setCode] = useState("");
  const [trouble, setTrouble] = useState<Trouble | undefined>();
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
    const entered = identifier;
    if (mode === "phone" && international === null) {
      setTrouble({ kind: "number_invalid" });
      return;
    }
    if (mode === "email" && !looksLikeEmail(entered)) {
      setTrouble({ kind: "email_invalid" });
      return;
    }
    setWorking(true);
    setTrouble(undefined);
    try {
      const attempt = await within(signIn.create({ identifier: entered }));
      // Whichever way this account can be reached; an account made with an email has no number.
      const factor = attempt.supportedFirstFactors?.find(
        (candidate) => candidate.strategy === "email_code" || candidate.strategy === "phone_code",
      );
      if (factor === undefined) {
        setTrouble({ kind: "cannot_receive" });
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
    } catch (lookup: unknown) {
      logClerkCodes("lookup", lookup);
      // The first family through the door has no account yet, so something Clerk does not know is
      // the ordinary first run, not a mistake. Only one it cannot use either is worth saying.
      try {
        if (await startJoining(entered)) setStep("code");
        else setTrouble({ kind: "did_not_work" });
      } catch (error: unknown) {
        logClerkCodes("send", error);
        // Clerk's message can name the account; the screen says only what the person can act on.
        setTrouble(
          error instanceof TookTooLong ? { kind: "bot_check" } : refusalOf(error, mode === "phone"),
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
          setTrouble({ kind: "needs_more" });
          return;
        }
        session = attempt.status === "complete" ? attempt.createdSessionId : null;
      } else {
        const attempt = await within(signIn.attemptFirstFactor({ strategy, code: code.trim() }));
        session = attempt.status === "complete" ? attempt.createdSessionId : null;
      }
      if (session === null) {
        setTrouble({ kind: "wrong_code" });
        return;
      }
      await setActive({ session });
      router.replace("/");
    } catch (error: unknown) {
      logClerkCodes("verify", error);
      setTrouble(
        error instanceof TookTooLong ? { kind: "code_took_too_long" } : { kind: "wrong_code" },
      );
    } finally {
      setWorking(false);
    }
  };

  /** The words for what went wrong, in the language the screen is in now. */
  function troubleWords(what: Trouble): string {
    switch (what.kind) {
      case "cannot_receive":
        return t`That account cannot receive a code yet.`;
      case "did_not_work":
        return t`That did not work. Check it and try again.`;
      case "bot_check":
        return t`The bot check did not finish. Try again in a moment.`;
      case "number_invalid": {
        const where = countryName(country);
        return t`That does not look like a number in ${where}. Check the country and the number.`;
      }
      case "country_unsupported": {
        const where = countryName(country);
        return t`Codes by text message do not reach ${where} yet. Use your email instead.`;
      }
      case "phone_off":
        return t`Signing in with a number is not open yet. Use your email instead.`;
      case "email_invalid":
        return t`That does not look like an email address.`;
      case "needs_more":
        return t`That code was right, but this account needs more than that to finish.`;
      case "wrong_code":
        return t`That code did not work. Ask for a new one.`;
      case "code_took_too_long":
        return t`That took too long to check. Try the code again.`;
    }
  }

  const sentTo = mode === "phone" ? readable(identifier) : identifier;
  const phone = international === null ? "" : readable(international);

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
            <View style={{ flexDirection: "row", gap: space.s }}>
              <Chip
                label={t`Phone number`}
                selected={mode === "phone"}
                onPress={() => {
                  setMode("phone");
                  setTrouble(undefined);
                }}
              />
              <Chip
                label={t`Email`}
                selected={mode === "email"}
                onPress={() => {
                  setMode("email");
                  setTrouble(undefined);
                }}
              />
            </View>
            {mode === "phone" ? (
              <>
                <Words variant="body" tone="ink2">
                  <Trans>
                    Choose your country, type your number as you would at home, and we text you a
                    code.
                  </Trans>
                </Words>
                <SecondaryButton
                  label={`${flagOf(country)}  ${countryName(country)}  +${country.dial}  ▾`}
                  onPress={() => setPicking(true)}
                />
                <TextField
                  value={number}
                  onChangeText={(next) => {
                    setNumber(next);
                    setTrouble(undefined);
                  }}
                  placeholder={country.example}
                  helper={
                    international === null
                      ? t`Your mobile number. The country code is added for you.`
                      : t`We will text ${phone}.`
                  }
                  keyboardType="phone-pad"
                  autoComplete="tel-national"
                  autoFocus
                  onSubmit={() => void sendCode()}
                />
              </>
            ) : (
              <>
                <Words variant="body" tone="ink2">
                  <Trans>Type your email, and we send you a code.</Trans>
                </Words>
                <TextField
                  value={email}
                  onChangeText={(next) => {
                    setEmail(next);
                    setTrouble(undefined);
                  }}
                  placeholder={t`name@example.com`}
                  keyboardType="email-address"
                  autoComplete="email"
                  autoFocus
                  onSubmit={() => void sendCode()}
                />
              </>
            )}
            <PrimaryButton label={working ? t`Sending…` : t`Send me a code`} onPress={sendCode} />
          </>
        ) : (
          <>
            <Words variant="body" tone="ink2">
              {strategy === "email_code" ? (
                <Trans>We sent a code to your email.</Trans>
              ) : (
                <Trans>We sent a code to {sentTo}.</Trans>
              )}
            </Words>
            <TextField
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              helper={t`Six digits, good for ten minutes.`}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              onSubmit={() => void enter()}
            />
            <PrimaryButton
              label={
                working
                  ? t`Checking…`
                  : t({ comment: "button: sign in with the code", message: "Enter" })
              }
              onPress={enter}
            />
            <SecondaryButton
              label={t`Use something else`}
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
            {troubleWords(trouble)}
          </Words>
        )}
        {trouble?.kind === "country_unsupported" || trouble?.kind === "phone_off" ? (
          <SecondaryButton
            label={t`Use my email instead`}
            onPress={() => {
              setMode("email");
              setTrouble(undefined);
            }}
          />
        ) : null}
        <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
          <ScrollView
            style={{ backgroundColor: palette.bg }}
            contentContainerStyle={{
              paddingTop: insets.top + space.xl,
              paddingBottom: insets.bottom + space.xl,
              paddingHorizontal: space.margin,
              gap: space.s,
            }}
          >
            <Words variant="heading">
              <Trans>Your country</Trans>
            </Words>
            {COUNTRIES.map((candidate) => (
              <Pressable
                key={candidate.iso}
                accessibilityRole="button"
                accessibilityState={{ selected: candidate.iso === country.iso }}
                onPress={() => {
                  setCountry(candidate);
                  setPicking(false);
                  setTrouble(undefined);
                }}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: space.m,
                  borderBottomWidth: 1,
                  borderBottomColor: palette.rule,
                }}
              >
                <Words variant={candidate.iso === country.iso ? "bodyMedium" : "body"}>
                  {`${flagOf(candidate)}  ${countryName(candidate)}`}
                </Words>
                <Words variant="body" tone="ink3">{`+${candidate.dial}`}</Words>
              </Pressable>
            ))}
            <SecondaryButton label={t`Close`} onPress={() => setPicking(false)} />
          </ScrollView>
        </Modal>
        {/* The app's language, before there is an account to keep it (build plan 3.1). */}
        {step === "identifier" ? <LocaleChips /> : null}
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
