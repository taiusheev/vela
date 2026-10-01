import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Image, View } from "react-native";
import { photoKey } from "../api/upload.ts";
import { pickPhoto } from "../data/pick-photo.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space } from "../theme/tokens.ts";
import { PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/** A photo chosen for a reply, re-encoded on the phone, with the key it goes up under. */
export interface ChosenPhoto {
  uri: string;
  key: string;
  width: number;
  height: number;
}

/**
 * A photo reply on one exchange (spec §14.1 A8): choose one from the phone, see it, then send it or
 * choose another. It goes up under a key minted when it was chosen, so sending it again after
 * trouble is the same photo, and the reply then names it. Her next morning shows it to her, unless
 * that morning's ask shows photos of its own.
 */
export function PhotoReply({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (photo: ChosenPhoto) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const [chosen, setChosen] = useState<ChosenPhoto | null>(null);
  const [unusable, setUnusable] = useState(false);

  const choose = async () => {
    setUnusable(false);
    try {
      const picked = await pickPhoto();
      if (picked !== null) setChosen({ ...picked, key: photoKey() });
    } catch {
      setUnusable(true);
    }
  };

  if (chosen !== null) {
    return (
      <View style={{ gap: space.s }}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={t`The photo you chose`}
          style={{
            width: "100%",
            aspectRatio: Math.min(Math.max(chosen.width / chosen.height, 0.6), 1.8),
            borderRadius: radius.card,
            overflow: "hidden",
            backgroundColor: palette.surface2,
          }}
        >
          <Image source={{ uri: chosen.uri }} style={{ width: "100%", height: "100%" }} />
        </View>
        <PrimaryButton
          label={disabled ? t`Sending…` : t`Send photo`}
          disabled={disabled}
          onPress={() => {
            void send(chosen).then((sent) => {
              if (sent) setChosen(null);
            });
          }}
        />
        <SecondaryButton label={t`Choose another`} onPress={() => void choose()} />
      </View>
    );
  }

  return (
    <View style={{ gap: space.s }}>
      <SecondaryButton label={t`📷 Reply with a photo`} onPress={() => void choose()} />
      {unusable ? (
        <Words variant="caption" tone="ink3">
          <Trans>That photo could not be used. Try another one.</Trans>
        </Words>
      ) : null}
    </View>
  );
}
