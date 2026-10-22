import { setupI18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { useSegments } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, ScrollView, View } from "react-native";
import { useAccount } from "../auth/clerk.tsx";
import { PrimaryButton, SecondaryButton, Words } from "../components/ui.tsx";
import { messages as en } from "../i18n/locales/analytics/en.po";
import { analyticsConfigured, captureUsage, setAnalyticsIdentity } from "./client.ts";
import { screenName } from "./events.ts";

const i18n = setupI18n({ locale: "en", messages: { en } });
let storageWrites = Promise.resolve();
const read = async (key: string) => {
  await storageWrites;
  return Platform.OS === "web" ? localStorage.getItem(key) : SecureStore.getItemAsync(key);
};
const write = (key: string, value: string) => {
  const saved = storageWrites.then(async () => {
    if (Platform.OS === "web") localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  });
  storageWrites = saved.catch(() => {});
  return saved;
};

/** Separate optional choice, scoped to an account. No identity before that choice. */
export function UsageAnalytics() {
  const account = useAccount();
  const scope = account.signedIn ? account.userId : "guest";
  return analyticsConfigured ? <ScopedUsage key={scope} scope={scope ?? "guest"} /> : null;
}
function ScopedUsage({ scope }: { scope: string }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const generation = useRef(0);
  const segments = useSegments();
  const screen = screenName(segments);
  useEffect(() => {
    let current = true;
    const revision = ++generation.current;
    setAnalyticsIdentity(null);
    void digestStringAsync(CryptoDigestAlgorithm.SHA256, `vela.usage.v1:${scope}`)
      .then(async (hash) => {
        const storageKey = `vela.usage.${hash}`;
        const stored = await read(storageKey).catch(() => null);
        if (!current || generation.current !== revision) return;
        setKey(storageKey);
        const id = stored && /^[a-f0-9-]{36}$/.test(stored) ? stored : null;
        setChoice(id ?? (stored === "off" ? "off" : null));
        setAnalyticsIdentity(id);
        setVisible(stored === null);
        if (id) captureUsage("app_usage_started");
      })
      .catch(() => {});
    return () => {
      current = false;
      ++generation.current;
      setAnalyticsIdentity(null);
    };
  }, [scope]);
  useEffect(() => {
    if (!choice || choice === "off" || !screen || visible) return;
    let started = AppState.currentState === "active" ? Date.now() : null;
    captureUsage("screen_viewed", screen, undefined, choice);
    const flush = () => {
      if (started !== null) {
        captureUsage("screen_active_time", screen, (Date.now() - started) / 1000, choice);
        started = null;
      }
    };
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") started ??= Date.now();
      else flush();
    });
    return () => {
      flush();
      listener.remove();
    };
  }, [screen, choice, visible]);
  const decide = (allow: boolean) => {
    if (!key) return;
    const id = allow ? (choice && choice !== "off" ? choice : randomUUID()) : "off";
    setAnalyticsIdentity(null);
    setChoice("off");
    setVisible(false);
    setSaveFailed(false);
    const revision = ++generation.current;
    void write(key, id)
      .then(() => {
        if (generation.current !== revision) return;
        if (allow) {
          setAnalyticsIdentity(id);
          setChoice(id);
          captureUsage("app_usage_started");
        }
      })
      .catch(() => {
        if (generation.current !== revision) return;
        setSaveFailed(true);
        setVisible(true);
      });
  };
  return (
    <>
      <View style={{ paddingHorizontal: 16 }}>
        <SecondaryButton label={i18n._(msg`Usage privacy`)} onPress={() => setVisible(true)} />
      </View>
      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <ScrollView contentContainerStyle={{ padding: 32, paddingTop: 80, gap: 20 }}>
          <Words variant="title">{i18n._(msg`Help improve Vela?`)}</Words>
          <Words>
            {i18n._(
              msg`Optional usage counts help us see which screens work well. PostHog receives a random ID, screen names, opening times and time on screen. No names, family messages, photos, audio or recordings are included. This is separate from your family permissions. Choosing no changes nothing in Vela.`,
            )}
          </Words>
          <Words>
            {i18n._(
              msg`The analytics service receives network details when your phone connects. Counts are stored for up to 1 year in the configured PostHog region. You can stop future counts here anytime. Turning this off clears this device's analytics identity; it does not delete earlier counts. For access or deletion, contact t.aiusheev@gmail.com.`,
            )}
          </Words>
          <Words>
            {process.env.EXPO_PUBLIC_POSTHOG_REGION === "eu"
              ? i18n._(msg`Storage region: European Union.`)
              : i18n._(msg`Storage region: United States.`)}
          </Words>
          {choice && choice !== "off" ? (
            <Words selectable>
              {i18n._(msg`Analytics ID for access or deletion:`)} {choice}
            </Words>
          ) : null}
          {saveFailed ? (
            <Words>
              {i18n._(
                msg`Your choice could not be saved on this device. Counts are stopped for this session. Please choose turn off again to save it for future openings.`,
              )}
            </Words>
          ) : null}
          <PrimaryButton
            label={i18n._(msg`Allow usage counts`)}
            disabled={!key}
            onPress={() => decide(true)}
          />
          <SecondaryButton
            label={i18n._(msg`No thanks / turn off`)}
            disabled={!key}
            onPress={() => decide(false)}
          />
        </ScrollView>
      </Modal>
    </>
  );
}
