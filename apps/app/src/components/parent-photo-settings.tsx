import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { usePortrait } from "../data/usePortrait.ts";
import { readFlag, writeFlag } from "../storage/flags.ts";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Portrait } from "./portrait-lamp.tsx";
import { Card, Eyebrow, SecondaryButton, Words } from "./ui.tsx";

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

/**
 * On Today, once for each parent on this device: a family set up before setup asked for photos is
 * offered one, so her face is in her window when her light comes on. "Not now" is remembered.
 */
export function ParentPhotoNudge({
  familyId,
  memberId,
  name,
}: {
  familyId: string;
  memberId: string;
  name: string;
}) {
  const { t } = useLingui();
  const photo = usePortrait(familyId, memberId);
  const flag = `photo-offered.${familyId}.${memberId}`;
  const [offered, setOffered] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  useEffect(() => {
    let current = true;
    void readFlag(flag).then((seen) => {
      if (current) setOffered(seen);
    });
    return () => {
      current = false;
    };
  }, [flag]);
  if (offered !== false || photo.uri !== null) return null;
  return (
    <Card>
      <View style={{ flexDirection: "row", gap: space.m, alignItems: "center" }}>
        <Portrait uri={null} name={name} width={52} height={66} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Words variant="bodyMedium">{t`Add a photo of ${name}`}</Words>
          <Words variant="caption" tone="ink2">
            {t`See their face in the window when their light comes on. Only on this phone.`}
          </Words>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: space.s }}>
        <View style={{ flex: 1 }}>
          <SecondaryButton
            label={busy ? t`Opening photos…` : t`Add photo`}
            icon="photo"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              setPhotoError(false);
              void photo
                .choose()
                .catch(() => setPhotoError(true))
                .finally(() => setBusy(false));
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <SecondaryButton
            label={t`Not now`}
            disabled={busy}
            onPress={() => {
              setOffered(true);
              void writeFlag(flag);
            }}
          />
        </View>
      </View>
      {photoError ? (
        <Words variant="caption" tone="ink2">
          <Trans>That photo could not be opened. Try another.</Trans>
        </Words>
      ) : null}
    </Card>
  );
}
