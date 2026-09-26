import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { fetchPhoto } from "../api/upload.ts";
import { useAccount } from "../auth/clerk.tsx";
import { loadPhoto, shownPhoto, withFreshToken } from "../data/photos.ts";
import type { ExchangePhoto } from "../data/today.ts";
import { useToday } from "../data/useToday.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space } from "../theme/tokens.ts";
import { Words } from "./ui.tsx";

/** A thumbnail's side in points, or the whole width a screen gives the photos. */
type PhotoSize = number | "full";

/** Below this a placeholder says nothing, since its words would not fit; it is still labelled. */
const WORDS_FROM = 120;

/**
 * One photo the family may see (ADR-33), loaded from the API with a token fetched for it and shown
 * from a `data:` URI kept in memory for the session, never from a file. A photo only Telegram
 * holds has nothing the API can show, and says where it is instead; one that cannot be loaded
 * shows a quiet placeholder.
 */
export function FamilyPhoto({
  familyId,
  photo,
  size,
  picked = false,
  number,
  aspectRatio = 1,
}: {
  familyId: string | undefined;
  photo: ExchangePhoto;
  size: PhotoSize;
  /** Her pick on a photo choice: ringed in the candle's colour. */
  picked?: boolean;
  /** The number she chose it by on a photo choice, "1" or "2". */
  number?: number;
  aspectRatio?: number;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const token = useAccount().token;
  const mediaId = photo.id;
  const stored = photo.stored;
  const [uri, setUri] = useState<string | undefined>(() => shownPhoto(mediaId));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!stored || familyId === undefined) return;
    const kept = shownPhoto(mediaId);
    if (kept !== undefined) {
      setUri(kept);
      return;
    }
    let current = true;
    setFailed(false);
    loadPhoto(mediaId, () =>
      withFreshToken(token, (fresh) => fetchPhoto(familyId, mediaId, fresh)),
    ).then(
      (next) => {
        if (current) setUri(next);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [familyId, mediaId, stored, token]);

  const label = picked ? t`The picked photo` : t`Photo`;
  // A lone photo with nothing to show keeps to a strip at full width; one on its way keeps its
  // shape, so the screen does not jump when it arrives, and a numbered pair stays square.
  const nothing = !stored || failed;
  const strip = nothing && number === undefined;
  const frame =
    size === "full"
      ? { flex: 1, aspectRatio: strip ? Math.max(aspectRatio, 3) : aspectRatio }
      : { width: size, height: size, flexShrink: 0 };
  const shown = stored && !failed ? uri : undefined;
  const words = size === "full" || size >= WORDS_FROM;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={stored ? label : t`Photo in the family group`}
      style={[
        frame,
        {
          borderRadius: size === "full" ? radius.card : radius.button,
          borderWidth: picked ? 3 : 1,
          borderColor: picked ? palette.light : palette.rule,
          backgroundColor: palette.surface2,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        },
      ]}
    >
      {shown !== undefined ? (
        <Image
          source={{ uri: shown }}
          resizeMode={size === "full" ? "contain" : "cover"}
          style={{ width: "100%", height: "100%" }}
        />
      ) : words && nothing ? (
        <View style={{ padding: space.m }}>
          <Words variant="caption" tone="ink3">
            {stored ? label : t`Photo in the family group`}
          </Words>
        </View>
      ) : null}
      {number === undefined ? null : <PhotoNumber number={number} picked={picked} />}
    </View>
  );
}

/** "1" or "2" in a corner, the number she answers a photo choice with. */
export function PhotoNumber({ number, picked = false }: { number: number; picked?: boolean }) {
  const palette = usePalette();
  return (
    <View
      style={{
        position: "absolute",
        top: space.xs,
        left: space.xs,
        minWidth: 22,
        height: 22,
        borderRadius: radius.chip,
        paddingHorizontal: space.xs,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: picked ? palette.light : palette.surface,
      }}
    >
      <Words variant="caption" tone="ink">
        {String(number)}
      </Words>
    </View>
  );
}

/** A lone photo keeps its own shape on the detail screen, within reason. */
function shapeOf(photo: ExchangePhoto): number {
  if (photo.width === null || photo.height === null) return 4 / 3;
  return Math.min(Math.max(photo.width / photo.height, 0.6), 1.8);
}

/**
 * The photos an ask showed her, in the order she saw them: thumbnails on Today and in Exchanges,
 * the whole width on one exchange. Two are numbered as she answers them, and her pick is ringed.
 */
export function ExchangePhotos({
  photos,
  picked,
  size,
}: {
  photos: readonly ExchangePhoto[] | undefined;
  picked: string | undefined;
  size: PhotoSize;
}) {
  const { familyId } = useToday();
  if (photos === undefined || photos.length === 0) return null;
  const numbered = photos.length > 1;
  return (
    <View style={{ flexDirection: "row", gap: space.s }}>
      {photos.map((photo, index) => (
        <FamilyPhoto
          key={photo.id}
          familyId={familyId}
          photo={photo}
          size={size}
          picked={photo.id === picked}
          {...(numbered ? { number: index + 1 } : {})}
          aspectRatio={numbered ? 1 : shapeOf(photo)}
        />
      ))}
    </View>
  );
}
