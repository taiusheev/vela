import { Trans, useLingui } from "@lingui/react/macro";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { router, Stack } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Speech from "expo-speech";
import { useEffect, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KitchenTable } from "../src/device/KitchenTable.tsx";
import { IDLE_MS, isKitchenTable } from "../src/device/kitchen.ts";
import { useParent } from "../src/device/useParent.ts";
import { VoiceAnswer } from "../src/device/VoiceAnswer.tsx";
import { lightPalette as light } from "../src/theme/tokens.ts";

/**
 * The parent surface (spec §14.2, ADR-35): one message at a time, Vela's newest to her, in large
 * type, with its buttons as large targets, her voice (P4) and her own words below. It is her consent
 * (P1), her morning's question (P2), a photo choice's two photos with their 1 and 2 (P3), and Vela's
 * thanks after she answers (P5), because each is the message Vela sent her phone last. Light mode
 * only, body 22 pt or more, targets 64 pt or more, ink on cream for 7:1 contrast; no tabs, no menus.
 */
export default function ParentScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const view = useParent();
  const [words, setWords] = useState("");
  const send = async () => {
    if (await view.say(words)) setWords("");
  };
  // Her screen turns with her phone or tablet; on its side it is the kitchen table (P6), until a tap
  // wakes it, and it goes back there when left alone.
  useEffect(() => {
    if (Platform.OS === "web") return;
    void ScreenOrientation.unlockAsync();
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);
  const { width, height } = useWindowDimensions();
  const sideways = isKitchenTable(width, height);
  const [wokenAt, setWokenAt] = useState<number | null>(null);
  useEffect(() => {
    if (wokenAt === null || !sideways) return;
    const timer = setTimeout(() => setWokenAt(null), IDLE_MS);
    return () => clearTimeout(timer);
  }, [wokenAt, sideways]);
  const touched = () => {
    if (wokenAt !== null) setWokenAt(Date.now());
  };

  if (sideways && wokenAt === null && view.linked && !view.loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <KitchenTable view={view} wake={() => setWokenAt(Date.now())} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 48 },
        ]}
        keyboardShouldPersistTaps="handled"
        onTouchStart={touched}
      >
        {view.loading ? (
          <Text style={styles.body}>
            <Trans>One moment…</Trans>
          </Text>
        ) : !view.linked ? (
          <>
            <Text style={styles.body}>
              <Trans>
                This phone is not set up for Vela any more. Ask your family to set it up again.
              </Trans>
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.secondary}
              onPress={() => router.replace("/sign-in")}
            >
              <Text style={styles.secondaryLabel}>
                <Trans>Sign in as family</Trans>
              </Text>
            </Pressable>
          </>
        ) : view.message === null ? (
          <Text style={styles.body}>
            <Trans>Nothing yet today. Your morning message will be here.</Trans>
          </Text>
        ) : (
          <>
            {view.name.length > 0 ? <Text style={styles.greeting}>{view.name}</Text> : null}
            <Text style={styles.message} accessibilityRole="text">
              {view.message.text}
            </Text>
            {view.photo === undefined
              ? null
              : view.message.photos.map((mediaId, index, all) => (
                  <HerPhoto
                    key={mediaId}
                    mediaId={mediaId}
                    load={view.photo}
                    {...(all.length > 1 ? { number: index + 1 } : {})}
                  />
                ))}
            {view.voice === undefined
              ? null
              : view.message.voices.map((mediaId, index, all) => (
                  <HerVoice
                    key={mediaId}
                    source={view.voice?.(mediaId)}
                    {...(all.length > 1 ? { number: index + 1 } : {})}
                  />
                ))}
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
              onPress={() => readAloud(view.message?.text ?? "", view.language)}
            >
              <Text style={styles.secondaryLabel}>
                <Trans>Read this aloud</Trans>
              </Text>
            </Pressable>
            <View style={styles.buttons}>
              {view.message.buttons.flat().map((button) => (
                <Pressable
                  key={button.id}
                  accessibilityRole="button"
                  disabled={view.sending}
                  style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
                  onPress={() => view.tap(button.id)}
                >
                  <Text style={styles.primaryLabel}>{button.label}</Text>
                </Pressable>
              ))}
            </View>
            <VoiceAnswer disabled={view.sending} send={view.sendVoice} />
            <TextInput
              value={words}
              onChangeText={setWords}
              placeholder={t`Or say it in your own words`}
              placeholderTextColor={light.ink3}
              multiline
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={view.sending || words.trim().length === 0}
              style={({ pressed }) => [
                styles.secondary,
                words.trim().length === 0 ? styles.disabled : null,
                pressed ? styles.pressed : null,
              ]}
              onPress={() => void send()}
            >
              <Text style={styles.secondaryLabel}>{view.sending ? t`Sending…` : t`Send`}</Text>
            </Pressable>
          </>
        )}
        {view.trouble === undefined ? null : <Text style={styles.body}>{view.trouble}</Text>}
      </ScrollView>
    </>
  );
}

/**
 * One photo of her message, the whole width, square when two are numbered for her to choose by
 * ("1", "2" in large type in its corner, as her buttons say). It loads with her phone's token and
 * is kept in memory only; one that cannot be loaded leaves a quiet frame, never an error.
 */
function HerPhoto({
  mediaId,
  load,
  number,
}: {
  mediaId: string;
  load: ((mediaId: string) => Promise<string>) | undefined;
  number?: number;
}) {
  const { t } = useLingui();
  const [uri, setUri] = useState<string | undefined>();
  useEffect(() => {
    if (load === undefined) return;
    let current = true;
    load(mediaId).then(
      (next) => {
        if (current) setUri(next);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [load, mediaId]);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={number === undefined ? t`Photo` : t`Photo ${number}`}
      style={[styles.photo, number === undefined ? styles.photoAlone : null]}
    >
      {uri === undefined ? null : (
        <Image source={{ uri }} resizeMode="cover" style={styles.photoImage} />
      )}
      {number === undefined ? null : (
        <View style={styles.photoNumber}>
          <Text style={styles.photoNumberLabel}>{String(number)}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * One voice note the family sent her, played from the API with her phone's token, the whole width:
 * one large button that plays it and, while it plays, stops it.
 */
function HerVoice({
  source,
  number,
}: {
  source: { uri: string; headers: Record<string, string> } | undefined;
  number?: number;
}) {
  const { t } = useLingui();
  const player = useAudioPlayer(source ?? null);
  const status = useAudioPlayerStatus(player);
  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (status.didJustFinish || status.currentTime >= status.duration) await player.seekTo(0);
    player.play();
  };
  const label = status.playing
    ? t`Stop`
    : number === undefined
      ? t`▶ Play the voice message`
      : t`▶ Play voice message ${number}`;
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
      onPress={() => void toggle()}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * Her message in her own language with the phone's own voice (spec §14.2: every text readable
 * aloud), free and on the phone; a second tap starts it again rather than speaking over itself.
 */
function readAloud(text: string, language: string): void {
  if (text.length === 0) return;
  void Speech.stop();
  Speech.speak(text, { language: language === "zh-TW" ? "zh-TW" : "en-US", rate: 0.9 });
}

const styles = StyleSheet.create({
  page: { backgroundColor: light.bg },
  content: { paddingHorizontal: 24, gap: 24 },
  greeting: { fontFamily: "Inter_500Medium", fontSize: 22, lineHeight: 30, color: light.ink2 },
  message: { fontFamily: "Literata_400Regular", fontSize: 28, lineHeight: 40, color: light.ink },
  body: { fontFamily: "Inter_400Regular", fontSize: 22, lineHeight: 32, color: light.ink },
  buttons: { gap: 16 },
  primary: {
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: light.action,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  primaryLabel: { fontFamily: "Inter_600SemiBold", fontSize: 22, color: light.surface },
  secondary: {
    minHeight: 64,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: light.action,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  secondaryLabel: { fontFamily: "Inter_600SemiBold", fontSize: 22, color: light.action },
  input: {
    minHeight: 112,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: light.rule,
    backgroundColor: light.surface,
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontFamily: "Inter_400Regular",
    fontSize: 22,
    color: light.ink,
    textAlignVertical: "top",
  },
  photo: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: light.rule,
    backgroundColor: light.surface2,
    overflow: "hidden",
  },
  photoAlone: { aspectRatio: 4 / 3 },
  photoImage: { width: "100%", height: "100%" },
  photoNumber: {
    position: "absolute",
    top: 12,
    left: 12,
    minWidth: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  photoNumberLabel: { fontFamily: "Inter_600SemiBold", fontSize: 32, color: light.ink },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
});
