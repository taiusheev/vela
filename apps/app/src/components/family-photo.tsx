import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { AppState, Image, Text, View } from "react-native";
import { fetchPhoto } from "../api/upload.ts";
import { useAccount } from "../auth/clerk.tsx";
import {
  familyPhotoKey,
  forgetPhoto,
  loadPhoto,
  type PhotoSnapshot,
  photoAvailable,
  selectedPhoto,
  shownPhoto,
  withFreshToken,
} from "../data/photos.ts";
import type { ExchangePhoto } from "../data/today.ts";
import { useToday } from "../data/useToday.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space, type } from "../theme/tokens.ts";
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
  /**
   * Her pick on a photo choice: ringed in the action teal, as the prototype rings it (4 pt at full
   * width, 3 on a thumbnail), never in amber, which is the light's own colour and would read as lit.
   */
  picked?: boolean;
  /** The number she chose it by on a photo choice, "1" or "2". */
  number?: number;
  aspectRatio?: number;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const account = useAccount();
  const token = account.token;
  const mediaId = photo.id;
  const stored = photo.stored;
  const expiresAt = photo.expires_at;
  const cacheKey = familyPhotoKey(account, familyId, mediaId);
  const selection = JSON.stringify([cacheKey, stored, expiresAt ?? null]);
  const authorised = account.ready && account.signedIn && familyId !== undefined;
  const available = authorised && photoAvailable(photo);
  const [snapshot, setSnapshot] = useState<PhotoSnapshot>(() => ({
    selection,
    uri: available ? shownPhoto(cacheKey) : undefined,
    failed: false,
  }));
  // Re-render at expiry and on foreground; suspended background timers may resume late.
  const [, setClock] = useState(0);

  useEffect(() => {
    if (expiresAt == null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const remaining = Date.parse(expiresAt) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        forgetPhoto(cacheKey);
        setSnapshot({ selection, failed: false });
      } else {
        timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
      }
      setClock((tick) => tick + 1);
    };
    check();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (timer !== undefined) clearTimeout(timer);
        check();
      }
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      listener.remove();
    };
  }, [cacheKey, expiresAt, selection]);

  useEffect(() => {
    if (!available || familyId === undefined) {
      forgetPhoto(cacheKey);
      setSnapshot({ selection, failed: false });
      return;
    }
    const kept = shownPhoto(cacheKey);
    setSnapshot({ selection, uri: kept, failed: false });
    if (kept !== undefined) {
      return;
    }
    let current = true;
    loadPhoto(
      cacheKey,
      () => withFreshToken(token, (fresh) => fetchPhoto(familyId, mediaId, fresh)),
      expiresAt,
    ).then(
      (next) => {
        if (current) setSnapshot({ selection, uri: next, failed: false });
      },
      () => {
        if (current) setSnapshot({ selection, failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, [available, cacheKey, expiresAt, familyId, mediaId, selection, token]);

  const label = picked ? t`The picked photo` : t`Photo`;
  // A lone photo with nothing to show keeps to a strip at full width; one on its way keeps its
  // shape, so the screen does not jump when it arrives, and a numbered pair stays square.
  const failed = snapshot.selection === selection && snapshot.failed;
  const nothing = !available || failed;
  const strip = nothing && number === undefined;
  const frame =
    size === "full"
      ? { flex: 1, aspectRatio: strip ? Math.max(aspectRatio, 3) : aspectRatio }
      : { width: size, height: size, flexShrink: 0 };
  const shown = authorised ? selectedPhoto(selection, photo, snapshot) : undefined;
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
          borderWidth: picked ? (size === "full" ? 4 : 3) : 1,
          borderColor: picked ? palette.action : palette.rule,
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

/** "1" or "2" in a corner, the number she answers a photo choice with; her pick's in the teal. */
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
        backgroundColor: picked ? palette.action : palette.surface,
      }}
    >
      <Text style={[type.caption, { color: picked ? palette.bg : palette.ink }]}>
        {String(number)}
      </Text>
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

/**
 * The photos the family sent back, each under the line that says who sent it: thumbnails on Today
 * and in Exchanges, the whole width on one exchange. Never numbered, never ringed.
 */
export function ReplyPhoto({ photo, size }: { photo: ExchangePhoto; size: PhotoSize }) {
  const { familyId } = useToday();
  return (
    <FamilyPhoto
      familyId={familyId}
      photo={photo}
      size={size}
      aspectRatio={size === "full" ? shapeOf(photo) : 1}
    />
  );
}

/** The family's reply photos on a card, as thumbnails in a row; nothing when there are none. */
export function ReplyThumbnails({ photos }: { photos: readonly ExchangePhoto[] }) {
  if (photos.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      {photos.map((photo) => (
        <ReplyPhoto key={photo.id} photo={photo} size={72} />
      ))}
    </View>
  );
}
