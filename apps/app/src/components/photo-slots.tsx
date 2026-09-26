import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { photoKey, photoRefusal, uploadMedia } from "../api/upload.ts";
import { useAccount } from "../auth/clerk.tsx";
import type { AskType } from "../data/ask.ts";
import {
  EMPTY_SLOT,
  type PhotoSlot,
  photoAskText,
  photoCount,
  retryable,
  slotError,
} from "../data/photos.ts";
import { pickPhoto } from "../data/pick-photo.ts";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, space } from "../theme/tokens.ts";
import { PhotoNumber } from "./family-photo.tsx";
import { Words } from "./ui.tsx";

/** The photos on Ask and what can be done with them (ADR-33). */
export interface AskPhotos {
  /** How many photos the chosen kind shows her: two to pick from, one old photo, or none. */
  count: 0 | 1 | 2;
  slots: readonly PhotoSlot[];
  /** Photo asks cannot be sent from here: the API keeps no photos, or refused one for that. */
  off: boolean;
  /** Say why under the chips: the API has said so, or an upload was refused for it. */
  explain: boolean;
  /** A photo the ask named was gone when it was sent, so the photos are chosen again. */
  missing: boolean;
  /** The phone's picker is open, or the photo is being re-encoded. */
  choosing: boolean;
  choose(index: number): void;
  retry(index: number): void;
  remove(index: number): void;
  /**
   * Whether a failed compose was the route's 404 `photo_missing`; if it was, every slot empties
   * and the screen says to choose again.
   */
  refusedAsk(error: unknown): boolean;
}

/**
 * Photo state for Ask. A photo is re-encoded on the phone as it is chosen and uploaded at once
 * under a key minted for it, so the ask itself only names the ids. With no API nothing is
 * uploaded: the photo shows as chosen and the example screen sends nothing. A photo ask starts
 * with words she can answer by looking, put in only while the field is empty or still holds the
 * words the previous kind started with.
 */
export function useAskPhotos({
  kind,
  familyId,
  demo,
  on,
  known,
  text,
  setText,
}: {
  kind: AskType;
  familyId: string | undefined;
  demo: boolean;
  /** Whether the API keeps photos (`ApiMe.photos`), or there is no API at all. */
  on: boolean;
  /** Whether `on` is the API's own answer rather than a guess while it loads. */
  known: boolean;
  text: string;
  setText: (text: string) => void;
}): AskPhotos {
  const token = useAccount().token;
  const [slots, setSlots] = useState<PhotoSlot[]>([EMPTY_SLOT, EMPTY_SLOT]);
  const [refused, setRefused] = useState(false);
  const [missing, setMissing] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const words = useRef(text);
  words.current = text;
  const placed = useRef<string | undefined>(undefined);
  useEffect(() => {
    const current = words.current;
    if (current.trim().length > 0 && current !== placed.current) return;
    const start = photoAskText(kind);
    placed.current = start;
    if (current !== (start ?? "")) setText(start ?? "");
  }, [kind, setText]);

  const put = useCallback((index: number, slot: PhotoSlot) => {
    setSlots((current) => current.map((other, at) => (at === index ? slot : other)));
  }, []);
  // An upload writes only into the slot that still holds its photo: one replaced or removed
  // meanwhile keeps what took its place.
  const update = useCallback((index: number, key: string, slot: PhotoSlot) => {
    setSlots((current) =>
      current.map((other, at) =>
        at === index && other.status !== "empty" && other.key === key ? slot : other,
      ),
    );
  }, []);

  const send = useCallback(
    async (index: number, uri: string, key: string) => {
      if (demo) {
        update(index, key, { status: "done", uri, key, mediaId: key });
        return;
      }
      if (familyId === undefined) {
        update(index, key, { status: "failed", uri, key, error: "trouble" });
        return;
      }
      update(index, key, { status: "uploading", uri, key, progress: 0 });
      try {
        const uploaded = await uploadMedia(familyId, key, uri, await token(), (progress) =>
          update(index, key, { status: "uploading", uri, key, progress }),
        );
        update(index, key, { status: "done", uri, key, mediaId: uploaded.id });
      } catch (error) {
        const failure = slotError(error);
        if (failure === "off") setRefused(true);
        update(index, key, { status: "failed", uri, key, error: failure });
      }
    },
    [demo, familyId, token, update],
  );

  const choose = useCallback(
    async (index: number) => {
      const key = photoKey();
      setChoosing(true);
      try {
        const picked = await pickPhoto();
        if (picked === null) return;
        setMissing(false);
        put(index, { status: "uploading", uri: picked.uri, key, progress: 0 });
        void send(index, picked.uri, key);
      } catch {
        // The phone could not read or re-encode it: a file no upload would help.
        put(index, { status: "failed", uri: null, key, error: "unusable" });
      } finally {
        setChoosing(false);
      }
    },
    [put, send],
  );

  const count = photoCount(kind);
  const off = !on || refused;
  return {
    count,
    slots,
    off,
    explain: off && (known || refused),
    missing,
    choosing,
    choose: (index) => void choose(index),
    retry: (index) => {
      const slot = slots[index];
      // The same re-encoded file under the same key: never picked or re-encoded again.
      if (slot?.status === "failed" && slot.uri !== null && retryable(slot.error)) {
        void send(index, slot.uri, slot.key);
      }
    },
    remove: (index) => put(index, EMPTY_SLOT),
    refusedAsk: (error) => {
      if (photoRefusal(error) !== "missing") return false;
      setSlots([EMPTY_SLOT, EMPTY_SLOT]);
      setMissing(true);
      return true;
    },
  };
}

function SlotAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" hitSlop={hitSlop} onPress={onPress}>
      <Words variant="button" tone="action">
        {label}
      </Words>
    </Pressable>
  );
}

function Slot({
  slot,
  number,
  single,
  disabled,
  onChoose,
  onRetry,
  onRemove,
}: {
  slot: PhotoSlot;
  /** "1" or "2" on a photo choice, the number she will answer with. */
  number: number | undefined;
  single: boolean;
  disabled: boolean;
  onChoose: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const shape = { aspectRatio: single ? 4 / 3 : 1, borderRadius: radius.card };
  if (slot.status === "empty") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t`Choose a photo`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={onChoose}
        style={{
          flex: 1,
          ...shape,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: palette.rule,
          backgroundColor: palette.surface,
          alignItems: "center",
          justifyContent: "center",
          padding: space.m,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        {number === undefined ? null : <PhotoNumber number={number} />}
        <Words variant="button" tone="action">
          <Trans>Choose a photo</Trans>
        </Words>
      </Pressable>
    );
  }
  const uploading = slot.status === "uploading";
  const percent = uploading ? Math.round(slot.progress * 100) : 0;
  return (
    <View style={{ flex: 1, gap: space.s }}>
      <View
        style={{
          ...shape,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: palette.rule,
          backgroundColor: palette.surface2,
        }}
      >
        {slot.uri === null ? null : (
          <Image
            source={{ uri: slot.uri }}
            resizeMode="cover"
            accessibilityLabel={t`Photo`}
            style={{ width: "100%", height: "100%", opacity: uploading ? 0.6 : 1 }}
          />
        )}
        {number === undefined ? null : <PhotoNumber number={number} />}
      </View>
      {uploading ? (
        <Words variant="caption" tone="ink3">
          <Trans>Uploading {percent}%</Trans>
        </Words>
      ) : slot.status === "failed" ? (
        <Words variant="caption" tone="ink2">
          {slot.error === "unusable"
            ? t`This photo could not be used. Choose another.`
            : slot.error === "limit"
              ? t`Too many photos for now. Try again later.`
              : slot.error === "off"
                ? t`Photos are not switched on here yet.`
                : t`That photo did not go up. Try again.`}
        </Words>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.l, rowGap: space.s }}>
        {slot.status === "failed" && slot.uri !== null && retryable(slot.error) ? (
          <SlotAction label={t`Try again`} onPress={onRetry} />
        ) : null}
        {disabled ? null : <SlotAction label={t`Replace`} onPress={onChoose} />}
        <SlotAction label={t`Remove`} onPress={onRemove} />
      </View>
    </View>
  );
}

/** Keys for the slots by place, since a slot is its place: the first photo and the second. */
const PLACES = ["first", "second"] as const;

/**
 * The photos of a photo ask, side by side: two numbered as she will answer them, or one old photo.
 * Each shows its upload's progress, and why it failed if it did.
 */
export function PhotoSlots({ photos }: { photos: AskPhotos }) {
  if (photos.count === 0) return null;
  const numbered = photos.count > 1;
  return (
    <View style={{ gap: space.m }}>
      <View style={{ flexDirection: "row", gap: space.m }}>
        {PLACES.slice(0, photos.count).map((place, index) => (
          <Slot
            key={place}
            slot={photos.slots[index] ?? EMPTY_SLOT}
            number={numbered ? index + 1 : undefined}
            single={!numbered}
            disabled={photos.choosing || photos.off}
            onChoose={() => photos.choose(index)}
            onRetry={() => photos.retry(index)}
            onRemove={() => photos.remove(index)}
          />
        ))}
      </View>
      {photos.missing ? (
        <Words variant="body" tone="ink2">
          <Trans>That photo is no longer here. Choose it again.</Trans>
        </Words>
      ) : null}
    </View>
  );
}
