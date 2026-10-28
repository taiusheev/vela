import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { usePortrait } from "../data/usePortrait.ts";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Portrait } from "./portrait-lamp.tsx";
import { Card, Eyebrow, Words } from "./ui.tsx";

export function ParentPhotoSettings({
  familyId,
  memberId,
  name,
}: {
  familyId: string;
  memberId: string;
  name: string;
}) {
  const { t } = useLingui();
  const p = usePalette();
  const photo = usePortrait(familyId, memberId);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  return (
    <Card>
      <Eyebrow>
        <Trans>Parent photo</Trans>
      </Eyebrow>
      <View style={{ alignItems: "center" }}>
        <Portrait uri={photo.uri} name={name} width={104} height={132} />
      </View>
      <View style={{ gap: space.s }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => {
              setBusy(true);
              setPhotoError(false);
              void photo
                .choose()
                .catch(() => setPhotoError(true))
                .finally(() => setBusy(false));
            }}
            style={{
              minHeight: 44,
              flexDirection: "row",
              gap: space.s,
              alignItems: "center",
              opacity: busy ? 0.5 : 1,
            }}
          >
            <BrandIcon name="photo" color={p.action} size={18} />
            <Words variant="button" tone="action">
              {busy
                ? t`Opening photos…`
                : photo.uri === null
                  ? t`Add a photo of ${name}`
                  : t`Change ${name}’s photo`}
            </Words>
          </Pressable>
          {photo.uri === null ? null : (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                try {
                  photo.remove();
                } catch {
                  setPhotoError(true);
                }
              }}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Words variant="button" tone="action">
                <Trans>Remove photo</Trans>
              </Words>
            </Pressable>
          )}
        </View>
        <Words variant="caption" tone="ink2">
          <Trans>Only on this device. Removed when you sign out.</Trans>
        </Words>
        {photoError ? (
          <Words variant="caption" tone="ink2">
            <Trans>
              The photo could not be changed. Your previous photo is still here. Try again.
            </Trans>
          </Words>
        ) : null}
      </View>
    </Card>
  );
}
