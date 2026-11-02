import { Trans, useLingui } from "@lingui/react/macro";
import { PHOTO_BOX_CAPTION_MAX, type PhotoBoxEra } from "@vela/contracts";
import { type ReactNode, useState } from "react";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../accessibility/use-reduced-motion.ts";
import { localDayMonth } from "../data/format.ts";
import type { BoxPhoto, PendingPhoto } from "../data/usePhotoBox.ts";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, linkHitSlop, radius, softShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { FamilyPhoto } from "./family-photo.tsx";
import { Text } from "./scaled-text.tsx";
import { useRoom } from "./today-hero.tsx";
import { PrimaryButton, SecondaryButton, TextField, Words } from "./ui.tsx";
import { RoomCard } from "./warm.tsx";

/**
 * The photo box's pieces (ADR-58): her next picture morning as she will see it, the box's photos,
 * and the two sheets that add photos and change one. Kept Light: the lit room holds the one thing
 * that matters (what she sees), everything else is paper.
 */

/** A box photo: from the API like any family photo, or this phone's own file in the example. */
export function BoxImage({
  familyId,
  photo,
  size,
  aspectRatio = 1,
}: {
  familyId: string | undefined;
  photo: BoxPhoto;
  size: number | "full";
  aspectRatio?: number;
}) {
  if (photo.localUri !== undefined) {
    return (
      <Image
        source={{ uri: photo.localUri }}
        style={
          size === "full"
            ? { width: "100%", aspectRatio }
            : { width: size, height: size / aspectRatio }
        }
        resizeMode="cover"
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
      aspectRatio={aspectRatio}
    />
  );
}

/** The question Vela writes for a photo, as the server words it, to show the family before she sees it. */
export function useQuestionFor(): (photo: Pick<BoxPhoto, "era" | "caption">) => string {
  const { t } = useLingui();
  return ({ era, caption }) => {
    if (era === "old") {
      return caption === null
        ? t`An old photo from your family. What do you remember about it?`
        : t`An old photo from your family: “${caption}”. What do you remember about that time?`;
    }
    return caption === null
      ? t`A new photo from your family. What does it make you think of?`
      : t`A new photo from your family: “${caption}”. What does it make you think of?`;
  };
}

/** Her next picture morning as the server plans it: the photos she will see and the words. */
export interface PreviewMorning {
  memberId: string;
  name: string;
  photos: BoxPhoto[];
  text: string;
  signature: string;
}

/**
 * The example family's preview, made on the phone (there is no server to plan it): a photo she
 * has not been shown, newest first, with the question its era asks.
 */
export function examplePreview(
  photos: readonly BoxPhoto[],
  name: string,
  question: (photo: Pick<BoxPhoto, "era" | "caption">) => string,
  signature: string,
): PreviewMorning | undefined {
  const photo =
    photos.find((one) => one.last_used_on === null) ??
    [...photos].sort((a, b) => (a.last_used_on ?? "").localeCompare(b.last_used_on ?? ""))[0];
  return photo === undefined
    ? undefined
    : { memberId: "example", name, photos: [photo], text: question(photo), signature };
}

/** Before there is a photo: the window waits, with the way to fill it. */
export function FirstPhoto({ name, onAdd }: { name: string; onAdd: () => void }) {
  const room = useRoom();
  const { t } = useLingui();
  return (
    <RoomCard id="photo-box-next">
      <Text accessibilityRole="header" style={[type.heading, { color: room.ink }]}>
        {t`Start ${name}'s mornings with a photo`}
      </Text>
      <Text style={[type.body, { color: room.muted }]}>
        <Trans>
          On a morning nobody writes for, about twice a week, Vela sends one of your photos with a
          short question. Old photos ask for the story behind them.
        </Trans>
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onAdd}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: space.s,
          paddingHorizontal: space.l,
          minHeight: 44,
          borderRadius: radius.chip,
          backgroundColor: room.cream,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <BrandIcon name="plus" color={room.creamInk} size={18} />
        <Text style={[type.button, { color: room.creamInk }]}>{t`Add photos`}</Text>
      </Pressable>
    </RoomCard>
  );
}

/**
 * Her next picture morning, drawn as her message will read: the photo (or the two to choose
 * from, numbered as her buttons are), Vela's question in her language, Vela's name.
 */
export function NextMorning({
  familyId,
  next,
}: {
  familyId: string | undefined;
  next: PreviewMorning;
}) {
  const room = useRoom();
  const { t } = useLingui();
  const name = next.name;
  const choice = next.photos.length > 1;
  return (
    <RoomCard id={`photo-box-next-${next.memberId}`}>
      <Text accessibilityRole="header" style={[type.heading, { color: room.ink }]}>
        {t`What ${name} sees next`}
      </Text>
      <View style={{ borderRadius: 20, overflow: "hidden", backgroundColor: room.cream }}>
        {choice ? (
          <View style={{ flexDirection: "row", gap: 2 }}>
            {next.photos.map((photo, index) => (
              <View key={photo.id} style={{ flex: 1 }}>
                <BoxImage familyId={familyId} photo={photo} size="full" aspectRatio={4 / 5} />
                <View
                  style={{
                    position: "absolute",
                    left: space.s,
                    top: space.s,
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(30,26,22,0.72)",
                  }}
                >
                  <Text style={[type.button, { color: "#FFF8EE" }]}>{String(index + 1)}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : next.photos[0] === undefined ? null : (
          <BoxImage familyId={familyId} photo={next.photos[0]} size="full" aspectRatio={16 / 10} />
        )}
        <View style={{ padding: space.l, gap: space.s }}>
          <Text style={[type.preview, { color: room.creamInk }]}>{next.text}</Text>
          <Text style={[type.caption, { color: room.creamInk, opacity: 0.72 }]}>
            {next.signature}
          </Text>
        </View>
      </View>
      <Text style={[type.caption, { color: room.muted }]}>
        <Trans>
          On a free morning, about twice a week, in {name}'s own language. Your own questions always
          come first.
        </Trans>
      </Text>
    </RoomCard>
  );
}

/** One photo in the grid: "Old" on an old one, and a lit dot once Vela has shown it to her. */
export function PhotoTile({
  familyId,
  photo,
  size,
  onPress,
}: {
  familyId: string | undefined;
  photo: BoxPhoto;
  size: number;
  onPress: () => void;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const label = [
    photo.era === "old" ? t`Old photo` : t`New photo`,
    photo.caption ?? undefined,
    photo.last_used_on === null ? undefined : t`Shown to her`,
  ]
    .filter((part) => part !== undefined)
    .join(", ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t`Opens the photo to change or take it out`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: 14,
        overflow: "hidden",
        backgroundColor: palette.surface2,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <BoxImage familyId={familyId} photo={photo} size={size} />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: space.s,
          right: space.s,
          top: space.s,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {photo.era === "old" ? (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 10,
              backgroundColor: "rgba(30,26,22,0.72)",
            }}
          >
            <Text style={[type.caption, { fontSize: 12, lineHeight: 16, color: "#FFF8EE" }]}>
              {t`Old`}
            </Text>
          </View>
        ) : (
          <View />
        )}
        {photo.last_used_on === null ? null : (
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: palette.light,
              borderWidth: 2,
              borderColor: "#FFF8EE",
            }}
          />
        )}
      </View>
    </Pressable>
  );
}

/** The grid's last place: room for more, the same size as a photo. */
export function AddTile({ size, onPress }: { size: number; onPress: () => void }) {
  const palette = usePalette();
  const { t } = useLingui();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t`Add photos`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: 14,
        borderWidth: 1.5,
        borderStyle: "dashed",
        borderColor: palette.control,
        backgroundColor: pressed ? palette.actionSoft : palette.surface,
        alignItems: "center",
        justifyContent: "center",
        gap: space.xs,
      })}
    >
      <BrandIcon name="plus" color={palette.ink2} size={26} />
      <Text style={[type.caption, { color: palette.ink2 }]}>{t`Add`}</Text>
    </Pressable>
  );
}

/**
 * New or old, as a phone's own two-part switch, with what each means under it: the choice decides
 * the question she is asked, so its effect is said where it is made.
 */
export function EraSwitch({
  era,
  disabled = false,
  onChange,
  all = false,
}: {
  /** Undefined when photos marked together differ: neither half is lit. */
  era: PhotoBoxEra | undefined;
  disabled?: boolean;
  onChange: (era: PhotoBoxEra) => void;
  /** Marks several photos at once: its halves say so, and it says nothing under itself. */
  all?: boolean;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const options: { era: PhotoBoxEra; label: string }[] = [
    { era: "new", label: all ? t`All new` : t`New photo` },
    { era: "old", label: all ? t`All old` : t`Old photo` },
  ];
  return (
    <View style={{ gap: space.s }}>
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: "row",
          padding: 3,
          borderRadius: 12,
          backgroundColor: palette.surface2,
          borderWidth: 1,
          borderColor: palette.rule,
        }}
      >
        {options.map((option) => {
          const selected = option.era === era;
          return (
            <Pressable
              key={option.era}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              hitSlop={hitSlop}
              onPress={() => onChange(option.era)}
              style={[
                {
                  flex: 1,
                  minHeight: 40,
                  borderRadius: 9,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selected ? palette.surface : "transparent",
                },
                selected ? softShadow : null,
              ]}
            >
              <Text style={[type.button, { color: selected ? palette.ink : palette.ink2 }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {all || era === undefined ? null : (
        <Words variant="caption" tone="ink3">
          {era === "old"
            ? t`Vela asks for the story behind it.`
            : t`Vela asks what it makes her think of.`}
        </Words>
      )}
    </View>
  );
}

/** A sheet rising over the box, with its title, a way to close, its body, and its action pinned below. */
function Sheet({
  title,
  onClose,
  closeDisabled = false,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { t } = useLingui();
  return (
    <Modal
      visible
      animationType={reducedMotion ? "none" : "slide"}
      presentationStyle="pageSheet"
      onRequestClose={closeDisabled ? () => {} : onClose}
    >
      <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: palette.bg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.m,
            paddingHorizontal: space.margin,
            paddingTop: space.l,
            paddingBottom: space.m,
            borderBottomWidth: 1,
            borderBottomColor: palette.rule,
          }}
        >
          <Text
            accessibilityRole="header"
            style={[type.heading, { color: palette.ink, flex: 1 }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={closeDisabled}
            hitSlop={linkHitSlop}
            onPress={onClose}
          >
            <Words variant="button" tone={closeDisabled ? "ink3" : "action"}>
              {t`Close`}
            </Words>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: space.margin,
            gap: space.xl,
            width: "100%",
            maxWidth: 640,
            alignSelf: "center",
          }}
        >
          {children}
        </ScrollView>
        <View
          style={{
            paddingHorizontal: space.margin,
            paddingTop: space.m,
            paddingBottom: insets.bottom + space.l,
            borderTopWidth: 1,
            borderTopColor: palette.rule,
            backgroundColor: palette.bg,
            gap: space.s,
          }}
        >
          {footer}
        </View>
      </View>
    </Modal>
  );
}

/**
 * The photos just chosen, each to mark new or old and give a line, then added together. Photos
 * that did not go in stay here, with why, to try again.
 */
export function AddSheet({
  pending,
  adding,
  progress,
  problem,
  onEdit,
  onEditAll,
  onDrop,
  onAdd,
  onClose,
}: {
  pending: readonly PendingPhoto[];
  adding: boolean;
  progress: { done: number; total: number } | undefined;
  problem: string | undefined;
  onEdit: (key: string, next: Partial<Pick<PendingPhoto, "era" | "caption">>) => void;
  /** Marks every chosen photo new or old at once. */
  onEditAll: (era: PhotoBoxEra) => void;
  onDrop: (key: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const count = pending.length;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? count;
  const step = Math.min(done + 1, total);
  return (
    <Sheet
      title={count === 1 ? t`Add 1 photo` : t`Add ${count} photos`}
      onClose={onClose}
      closeDisabled={adding}
      footer={
        <>
          {problem === undefined ? null : (
            <Words variant="caption" tone="error">
              {problem}
            </Words>
          )}
          <PrimaryButton
            icon="photo"
            label={
              adding
                ? t`Adding ${step} of ${total}…`
                : count === 1
                  ? t`Put 1 photo in the box`
                  : t`Put ${count} photos in the box`
            }
            disabled={adding || count === 0}
            onPress={onAdd}
          />
        </>
      }
    >
      <Words variant="body" tone="ink2">
        <Trans>
          Say whether each one is new or old, and add a line if it helps: who, where, or when. Vela
          puts your line in her question as you wrote it.
        </Trans>
      </Words>
      {count < 2 ? null : (
        <View style={{ gap: space.s }}>
          <Words variant="caption" tone="ink2">
            <Trans>Mark them all</Trans>
          </Words>
          <EraSwitch
            all
            era={
              pending.every((photo) => photo.era === "new")
                ? "new"
                : pending.every((photo) => photo.era === "old")
                  ? "old"
                  : undefined
            }
            disabled={adding}
            onChange={onEditAll}
          />
        </View>
      )}
      {pending.map((photo, index) => {
        const number = index + 1;
        return (
          <View
            key={photo.key}
            style={[
              {
                borderRadius: radius.panel,
                overflow: "hidden",
                backgroundColor: palette.surface,
                borderWidth: 1,
                borderColor: palette.rule,
              },
              softShadow,
            ]}
          >
            <Image
              source={{ uri: photo.uri }}
              style={{ width: "100%", aspectRatio: 16 / 9, maxHeight: 220 }}
              resizeMode="cover"
              accessibilityLabel={t`Photo ${number}`}
              accessibilityIgnoresInvertColors
            />
            <View style={{ padding: space.l, gap: space.l }}>
              <EraSwitch
                era={photo.era}
                disabled={adding}
                onChange={(era) => onEdit(photo.key, { era })}
              />
              <TextField
                label={t`One line about it (optional)`}
                value={photo.caption}
                onChangeText={(caption) => onEdit(photo.key, { caption })}
                placeholder={
                  photo.era === "old" ? t`e.g. Our first flat, 1982` : t`e.g. Lily at the beach`
                }
                maxLength={PHOTO_BOX_CAPTION_MAX}
                disabled={adding}
              />
              <Pressable
                accessibilityRole="button"
                disabled={adding}
                hitSlop={linkHitSlop}
                onPress={() => onDrop(photo.key)}
                style={{ alignSelf: "flex-start" }}
              >
                <Words variant="button" tone={adding ? "ink3" : "action"}>
                  <Trans>Leave this one out</Trans>
                </Words>
              </Pressable>
            </View>
          </View>
        );
      })}
    </Sheet>
  );
}

/** One box photo, opened: who added it, when she last saw it, its era and line, and taking it out. */
export function PhotoSheet({
  familyId,
  photo,
  busy,
  problem,
  onSave,
  onRemove,
  onClose,
}: {
  familyId: string | undefined;
  photo: BoxPhoto;
  busy: boolean;
  problem: string | undefined;
  onSave: (change: { era?: PhotoBoxEra; caption?: string | null }) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const { t } = useLingui();
  const question = useQuestionFor();
  const [era, setEra] = useState(photo.era);
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [confirming, setConfirming] = useState(false);
  const trimmed = caption.trim();
  const changed = era !== photo.era || trimmed !== (photo.caption ?? "");
  const adder = photo.added_by_name;
  const shownOn = photo.last_used_on === null ? "" : localDayMonth(photo.last_used_on);
  const meta = [
    adder === null ? undefined : t`Added by ${adder}`,
    photo.last_used_on === null ? t`Not shown yet` : t`Shown ${shownOn}`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
  const save = () =>
    onSave({
      ...(era === photo.era ? {} : { era }),
      ...(trimmed === (photo.caption ?? "")
        ? {}
        : { caption: trimmed.length === 0 ? null : trimmed }),
    });
  return (
    <Sheet
      title={photo.era === "old" ? t`Old photo` : t`New photo`}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          {problem === undefined ? null : (
            <Words variant="caption" tone="error">
              {problem}
            </Words>
          )}
          {!photo.can_change ? null : confirming ? (
            <>
              <Words variant="body">
                <Trans>
                  Take this photo out? It is deleted within a day, and Vela won't send it.
                </Trans>
              </Words>
              <PrimaryButton
                icon="trash"
                label={t`Yes, take it out`}
                disabled={busy}
                onPress={onRemove}
              />
              <SecondaryButton
                label={t`Keep it`}
                disabled={busy}
                onPress={() => setConfirming(false)}
              />
            </>
          ) : (
            <>
              <PrimaryButton label={t`Save changes`} disabled={busy || !changed} onPress={save} />
              <SecondaryButton
                icon="trash"
                label={t`Take out of the box`}
                disabled={busy}
                onPress={() => setConfirming(true)}
              />
            </>
          )}
        </>
      }
    >
      <View style={{ borderRadius: radius.panel, overflow: "hidden" }}>
        <BoxImage familyId={familyId} photo={photo} size="full" aspectRatio={4 / 3} />
      </View>
      <Words variant="caption" tone="ink3">
        {meta}
      </Words>
      {photo.can_change ? (
        <>
          <EraSwitch era={era} disabled={busy} onChange={setEra} />
          <TextField
            label={t`One line about it (optional)`}
            value={caption}
            onChangeText={setCaption}
            maxLength={PHOTO_BOX_CAPTION_MAX}
            disabled={busy}
          />
        </>
      ) : (
        <Words variant="caption" tone="ink3">
          <Trans>Whoever added this photo, or an organiser, can change it.</Trans>
        </Words>
      )}
      <View
        style={{
          padding: space.l,
          gap: space.xs,
          borderRadius: radius.panel,
          backgroundColor: palette.surface2,
        }}
      >
        <Words variant="caption" tone="ink3">
          <Trans>Her question</Trans>
        </Words>
        <Words variant="preview">
          {question({ era, caption: trimmed.length === 0 ? null : trimmed })}
        </Words>
      </View>
    </Sheet>
  );
}
