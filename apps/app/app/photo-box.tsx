import { Trans, useLingui } from "@lingui/react/macro";
import { PHOTO_BOX_CAPTION_MAX, type PhotoBoxEra } from "@vela/contracts";
import { Stack } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { photoKey } from "../src/api/upload.ts";
import { BackButton } from "../src/components/back-button.tsx";
import { FamilyPhoto } from "../src/components/family-photo.tsx";
import { LoadingLight } from "../src/components/loading-light.tsx";
import { Text } from "../src/components/scaled-text.tsx";
import {
  Card,
  Chip,
  PrimaryButton,
  SecondaryButton,
  TextField,
  Words,
} from "../src/components/ui.tsx";
import { localDayMonth } from "../src/data/format.ts";
import { pickPhotos } from "../src/data/pick-photo.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import {
  type AddFailure,
  type BoxPhoto,
  type PendingPhoto,
  usePhotoBox,
} from "../src/data/usePhotoBox.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { radius, readingColumn, space, type } from "../src/theme/tokens.ts";

/** How many photos one pick may bring, so marking them stays a short list. */
const PICK_AT_ONCE = 10;
const COLUMNS = 3;

/**
 * The family's photo box (ADR-58), opened from You: photos the family adds once, marked new or old
 * with an optional line, which Vela shows her on a morning nobody wrote for, about twice a week.
 * Anyone in the family adds; whoever added a photo, or an organiser, changes or takes it out.
 */
export default function PhotoBoxScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useLingui();
  const { width } = useWindowDimensions();
  const day = useToday();
  const { capabilities } = useCapabilities();
  const box = usePhotoBox(day.familyId, capabilities?.photo_box === true);
  const name = day.today.lights[0]?.displayName ?? t`Mom`;
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [problem, setProblem] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const column = Math.min(width, readingColumn) - space.margin * 2;
  const tile = Math.floor((column - space.s * (COLUMNS - 1)) / COLUMNS);
  const free = box.room - pending.length;
  const open = box.photos.find((photo) => photo.id === openId);
  const held = box.photos.length;
  const limit = box.limit;
  const waiting = pending.length;

  const failureLine = (failure: AddFailure, count: number): string => {
    switch (failure) {
      case "full":
        return t`The photo box is full. Take a photo out to make room.`;
      case "limit":
        return t`That is enough photos for today. Try the rest tomorrow.`;
      case "unusable":
        return t`${count} of these photos could not be used.`;
      default:
        return t`Some photos did not go in. Check your connection and try again.`;
    }
  };

  const choose = async () => {
    setProblem(undefined);
    try {
      const picked = await pickPhotos(Math.min(PICK_AT_ONCE, free));
      setPending((current) => [
        ...current,
        ...picked.photos.map((photo) => ({
          uri: photo.uri,
          key: photoKey(),
          era: "new" as const,
          caption: "",
        })),
      ]);
      if (picked.unusable > 0) setProblem(failureLine("unusable", picked.unusable));
    } catch {
      setProblem(failureLine("unusable", 1));
    }
  };

  const addAll = async () => {
    setProblem(undefined);
    const failed = await box.add(pending);
    setPending(failed.map((entry) => entry.photo));
    const first = failed[0];
    if (first !== undefined) setProblem(failureLine(first.failure, failed.length));
  };

  const edit = (key: string, next: Partial<Pick<PendingPhoto, "era" | "caption">>) =>
    setPending((current) =>
      current.map((photo) => (photo.key === key ? { ...photo, ...next } : photo)),
    );

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Photo box`, headerLeft: () => <BackButton /> }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: palette.bg }}
        contentContainerStyle={{
          paddingTop: space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap: space.xl,
          width: "100%",
          maxWidth: readingColumn,
          alignSelf: "center",
        }}
      >
        <Words variant="body" tone="ink2">
          <Trans>
            Add photos once. On a morning nobody writes for, about twice a week, Vela sends {name}{" "}
            one of them with a short question. Old photos ask for the story behind them.
          </Trans>
        </Words>

        {box.loading ? (
          <LoadingLight label={t`Loading the photo box…`} />
        ) : box.trouble ? (
          <SecondaryButton label={t`Try again`} onPress={() => void box.refresh()} />
        ) : (
          <>
            {pending.length === 0 ? (
              <View style={{ gap: space.s }}>
                <PrimaryButton
                  icon="photo"
                  label={t`Add from Photos`}
                  disabled={free <= 0}
                  onPress={() => void choose()}
                />
                <Words variant="caption" tone="ink3">
                  {free <= 0
                    ? t`The photo box is full. Take a photo out to make room.`
                    : t`${held} of ${limit} photos · Vela sees only the photos you choose.`}
                </Words>
              </View>
            ) : (
              <Card style={{ gap: space.l }}>
                <Words variant="heading">
                  {pending.length === 1
                    ? t`Is this photo new or old?`
                    : t`Are these photos new or old?`}
                </Words>
                {pending.map((photo) => (
                  <PendingRow
                    key={photo.key}
                    photo={photo}
                    disabled={box.adding}
                    onEra={(era) => edit(photo.key, { era })}
                    onCaption={(caption) => edit(photo.key, { caption })}
                    onDrop={() =>
                      setPending((current) => current.filter((other) => other.key !== photo.key))
                    }
                  />
                ))}
                <PrimaryButton
                  label={
                    box.adding
                      ? t`Adding…`
                      : pending.length === 1
                        ? t`Add 1 photo`
                        : t`Add ${waiting} photos`
                  }
                  disabled={box.adding}
                  onPress={() => void addAll()}
                />
                <SecondaryButton
                  label={t`Cancel`}
                  disabled={box.adding}
                  onPress={() => {
                    setPending([]);
                    setProblem(undefined);
                  }}
                />
              </Card>
            )}
            {problem === undefined ? null : (
              <Words variant="caption" tone="error">
                {problem}
              </Words>
            )}

            {open === undefined ? null : (
              <OpenPhoto
                key={open.id}
                familyId={day.familyId}
                photo={open}
                size={column}
                busy={box.busy}
                onSave={async (change) => {
                  if (await box.change(open.id, change)) setOpenId(undefined);
                  else setProblem(t`That change did not save. Try again.`);
                }}
                onRemove={async () => {
                  if (await box.remove(open.id)) setOpenId(undefined);
                  else setProblem(t`That photo is still in the box. Try again.`);
                }}
                onClose={() => setOpenId(undefined)}
              />
            )}

            {box.photos.length === 0 && pending.length === 0 ? (
              <Words variant="body" tone="ink3">
                <Trans>
                  No photos yet. A grandchild's new drawing, a day out, or an old family photo all
                  make a good morning.
                </Trans>
              </Words>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
                {box.photos.map((photo) => (
                  <Pressable
                    key={photo.id}
                    accessibilityRole="button"
                    accessibilityLabel={
                      photo.caption ?? (photo.era === "old" ? t`Old photo` : t`New photo`)
                    }
                    accessibilityState={{ selected: photo.id === openId }}
                    onPress={() => setOpenId(photo.id === openId ? undefined : photo.id)}
                    style={{
                      width: tile,
                      borderRadius: radius.card,
                      overflow: "hidden",
                      borderWidth: photo.id === openId ? 3 : 0,
                      borderColor: palette.action,
                    }}
                  >
                    <BoxImage familyId={day.familyId} photo={photo} size={tile} />
                    <Badge old={photo.era === "old"} shown={photo.last_used_on !== null} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

/** A box photo: from the API like any family photo, or from this phone in the example family. */
function BoxImage({
  familyId,
  photo,
  size,
}: {
  familyId: string | undefined;
  photo: BoxPhoto;
  size: number;
}) {
  if (photo.localUri !== undefined) {
    return (
      <Image
        source={{ uri: photo.localUri }}
        style={{ width: size, height: size }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <FamilyPhoto
      familyId={familyId}
      photo={{
        id: photo.media_id,
        width: photo.width,
        height: photo.height,
        stored: true,
        expires_at: null,
      }}
      size={size}
    />
  );
}

/** "Old" on an old photo, and the light's dot once Vela has shown it to her. */
function Badge({ old, shown }: { old: boolean; shown: boolean }) {
  const palette = usePalette();
  const { t } = useLingui();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: space.xs,
        right: space.xs,
        bottom: space.xs,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-end",
      }}
    >
      {old ? (
        <Text
          style={[
            type.caption,
            {
              fontSize: 11,
              lineHeight: 14,
              paddingHorizontal: 6,
              borderRadius: 8,
              overflow: "hidden",
              backgroundColor: palette.action,
              color: palette.onAction,
            },
          ]}
        >
          {t`Old`}
        </Text>
      ) : (
        <View />
      )}
      {shown ? (
        <View
          accessibilityLabel={t`Shown to her`}
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: palette.light,
            borderWidth: 2,
            borderColor: palette.surface,
          }}
        />
      ) : null}
    </View>
  );
}

function EraChoice({
  era,
  disabled,
  onChange,
}: {
  era: PhotoBoxEra;
  disabled: boolean;
  onChange: (era: PhotoBoxEra) => void;
}) {
  const { t } = useLingui();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
      <Chip
        label={t`New`}
        selected={era === "new"}
        disabled={disabled}
        onPress={() => onChange("new")}
      />
      <Chip
        label={t`Old`}
        selected={era === "old"}
        disabled={disabled}
        onPress={() => onChange("old")}
      />
    </View>
  );
}

/** A chosen photo waiting to go in: new or old, and its one line. */
function PendingRow({
  photo,
  disabled,
  onEra,
  onCaption,
  onDrop,
}: {
  photo: PendingPhoto;
  disabled: boolean;
  onEra: (era: PhotoBoxEra) => void;
  onCaption: (caption: string) => void;
  onDrop: () => void;
}) {
  const { t } = useLingui();
  return (
    <View style={{ flexDirection: "row", gap: space.m, alignItems: "flex-start" }}>
      <Image
        source={{ uri: photo.uri }}
        style={{ width: 72, height: 72, borderRadius: radius.card }}
        accessibilityIgnoresInvertColors
      />
      <View style={{ flex: 1, minWidth: 0, gap: space.s }}>
        <EraChoice era={photo.era} disabled={disabled} onChange={onEra} />
        <TextField
          value={photo.caption}
          onChangeText={onCaption}
          placeholder={
            photo.era === "old" ? t`Who or where? e.g. Our first flat` : t`e.g. Lily at the beach`
          }
          maxLength={PHOTO_BOX_CAPTION_MAX}
          disabled={disabled}
        />
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onDrop}>
          <Words variant="caption" tone="action">
            <Trans>Leave this one out</Trans>
          </Words>
        </Pressable>
      </View>
    </View>
  );
}

/** One box photo opened: its line and era to change, and the way to take it out. */
function OpenPhoto({
  familyId,
  photo,
  size,
  busy,
  onSave,
  onRemove,
  onClose,
}: {
  familyId: string | undefined;
  photo: BoxPhoto;
  size: number;
  busy: boolean;
  onSave: (change: { era?: PhotoBoxEra; caption?: string | null }) => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [era, setEra] = useState(photo.era);
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [confirming, setConfirming] = useState(false);
  const trimmed = caption.trim();
  const changed = era !== photo.era || trimmed !== (photo.caption ?? "");
  const added = photo.added_by_name;
  const shown = photo.last_used_on;
  const shownOn = shown === null ? "" : localDayMonth(shown);
  return (
    <Card style={{ gap: space.l }}>
      <View style={{ borderRadius: radius.card, overflow: "hidden", alignSelf: "center" }}>
        <BoxImage familyId={familyId} photo={photo} size={Math.min(size - space.l * 2, 360)} />
      </View>
      <Words variant="caption" tone="ink3">
        {[
          added === null ? undefined : t`Added by ${added}`,
          shown === null ? t`Not shown yet` : t`Last shown ${shownOn}`,
        ]
          .filter((line) => line !== undefined)
          .join(" · ")}
      </Words>
      {photo.can_change ? (
        <>
          <EraChoice era={era} disabled={busy} onChange={setEra} />
          <TextField
            label={t`One line about it`}
            value={caption}
            onChangeText={setCaption}
            maxLength={PHOTO_BOX_CAPTION_MAX}
            disabled={busy}
            helper={t`Vela puts these words in her question, as you wrote them.`}
          />
          <PrimaryButton
            label={t`Save`}
            disabled={busy || !changed}
            onPress={() =>
              void onSave({
                ...(era === photo.era ? {} : { era }),
                ...(trimmed === (photo.caption ?? "")
                  ? {}
                  : { caption: trimmed.length === 0 ? null : trimmed }),
              })
            }
          />
          {confirming ? (
            <View style={{ gap: space.s }}>
              <Words variant="body">
                <Trans>Take this photo out? It is deleted within a day.</Trans>
              </Words>
              <PrimaryButton
                icon="trash"
                label={t`Yes, take it out`}
                disabled={busy}
                onPress={() => void onRemove()}
              />
              <SecondaryButton
                label={t`Keep it`}
                disabled={busy}
                onPress={() => setConfirming(false)}
              />
            </View>
          ) : (
            <SecondaryButton
              icon="trash"
              label={t`Take out of the box`}
              disabled={busy}
              onPress={() => setConfirming(true)}
            />
          )}
        </>
      ) : (
        <>
          {photo.caption === null ? null : <Words variant="body">{photo.caption}</Words>}
          <Words variant="caption" tone="ink3">
            <Trans>Whoever added this photo, or an organiser, can change it.</Trans>
          </Words>
        </>
      )}
      <SecondaryButton label={t`Close`} disabled={busy} onPress={onClose} />
    </Card>
  );
}
