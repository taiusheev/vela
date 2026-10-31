import { useLingui } from "@lingui/react/macro";
import { Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { photoKey } from "../src/api/upload.ts";
import { BackButton } from "../src/components/back-button.tsx";
import { LoadingLight } from "../src/components/loading-light.tsx";
import {
  AddSheet,
  AddTile,
  NextMorning,
  nextUp,
  PhotoSheet,
  PhotoTile,
} from "../src/components/photo-box.tsx";
import { SectionTitle } from "../src/components/today-hero.tsx";
import { PrimaryButton, SecondaryButton, Words } from "../src/components/ui.tsx";
import { pickPhotos } from "../src/data/pick-photo.ts";
import { useCapabilities } from "../src/data/useCapabilities.ts";
import { type AddFailure, type PendingPhoto, usePhotoBox } from "../src/data/usePhotoBox.ts";
import { useToday } from "../src/data/useToday.ts";
import { usePalette } from "../src/theme/theme.tsx";
import { readingColumn, space } from "../src/theme/tokens.ts";

/** How many photos one pick may bring, so marking them stays a short list. */
const PICK_AT_ONCE = 10;
const COLUMNS = 3;
const GAP = 6;

/**
 * The family's photo box (ADR-58), opened from You: photos the family adds once, which Vela turns
 * into her mornings nobody wrote for, about twice a week. The lit room shows what she sees next;
 * the box's photos sit below; adding is always one tap away at the foot of the screen.
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
  const [addProblem, setAddProblem] = useState<string>();
  const [pageProblem, setPageProblem] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const [sheetProblem, setSheetProblem] = useState<string>();
  const column = Math.min(width, readingColumn) - space.margin * 2;
  const tile = Math.floor((column - GAP * (COLUMNS - 1)) / COLUMNS);
  const open = box.photos.find((photo) => photo.id === openId);
  const held = box.photos.length;
  const limit = box.limit;
  const full = box.room <= 0;

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
    setPageProblem(undefined);
    setAddProblem(undefined);
    try {
      const picked = await pickPhotos(Math.min(PICK_AT_ONCE, box.room));
      if (picked.unusable > 0) setPageProblem(failureLine("unusable", picked.unusable));
      setPending(
        picked.photos.map((photo) => ({
          uri: photo.uri,
          key: photoKey(),
          era: "new" as const,
          caption: "",
        })),
      );
    } catch {
      setPageProblem(failureLine("unusable", 1));
    }
  };

  const addAll = async () => {
    setAddProblem(undefined);
    const failed = await box.add(pending);
    setPending(failed.map((entry) => entry.photo));
    const first = failed[0];
    if (first !== undefined) setAddProblem(failureLine(first.failure, failed.length));
  };

  const closeOpen = () => {
    setOpenId(undefined);
    setSheetProblem(undefined);
  };

  return (
    <>
      <Stack.Screen
        options={{ headerShown: true, title: t`Photo box`, headerLeft: () => <BackButton /> }}
      />
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: space.xl,
            paddingBottom: space.xxxl,
            paddingHorizontal: space.margin,
            gap: space.xxl,
            width: "100%",
            maxWidth: readingColumn,
            alignSelf: "center",
          }}
        >
          {box.loading ? (
            <LoadingLight label={t`Loading the photo box…`} />
          ) : box.trouble ? (
            <SecondaryButton label={t`Try again`} onPress={() => void box.refresh()} />
          ) : (
            <>
              <NextMorning
                familyId={day.familyId}
                name={name}
                photo={nextUp(box.photos)}
                onAdd={() => void choose()}
              />
              {pageProblem === undefined ? null : (
                <Words variant="caption" tone="error">
                  {pageProblem}
                </Words>
              )}
              {held === 0 ? null : (
                <View style={{ gap: space.l }}>
                  <SectionTitle title={t`In the box · ${held} of ${limit}`} />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
                    {box.photos.map((photo) => (
                      <PhotoTile
                        key={photo.id}
                        familyId={day.familyId}
                        photo={photo}
                        size={tile}
                        onPress={() => setOpenId(photo.id)}
                      />
                    ))}
                    {full ? null : <AddTile size={tile} onPress={() => void choose()} />}
                  </View>
                  <Words variant="caption" tone="ink3">
                    {full
                      ? t`The photo box is full. Take a photo out to make room.`
                      : t`A lit dot marks a photo Vela has already sent. Only the photos you choose leave your phone.`}
                  </Words>
                </View>
              )}
            </>
          )}
        </ScrollView>
        {box.loading || box.trouble || held === 0 ? null : (
          <View
            style={{
              paddingHorizontal: space.margin,
              paddingTop: space.m,
              paddingBottom: insets.bottom + space.m,
              borderTopWidth: 1,
              borderTopColor: palette.rule,
              backgroundColor: palette.bg,
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: readingColumn - space.margin * 2,
                alignSelf: "center",
              }}
            >
              <PrimaryButton
                icon="photo"
                label={t`Add photos`}
                disabled={full}
                onPress={() => void choose()}
              />
            </View>
          </View>
        )}
      </View>

      {pending.length === 0 ? null : (
        <AddSheet
          pending={pending}
          adding={box.adding}
          progress={box.progress}
          problem={addProblem}
          onEdit={(key, next) =>
            setPending((current) =>
              current.map((photo) => (photo.key === key ? { ...photo, ...next } : photo)),
            )
          }
          onDrop={(key) => setPending((current) => current.filter((photo) => photo.key !== key))}
          onAdd={() => void addAll()}
          onClose={() => {
            setPending([]);
            setAddProblem(undefined);
          }}
        />
      )}

      {open === undefined ? null : (
        <PhotoSheet
          key={open.id}
          familyId={day.familyId}
          photo={open}
          busy={box.busy}
          problem={sheetProblem}
          onSave={async (change) => {
            if (await box.change(open.id, change)) closeOpen();
            else setSheetProblem(t`That change did not save. Try again.`);
          }}
          onRemove={async () => {
            if (await box.remove(open.id)) closeOpen();
            else setSheetProblem(t`That photo is still in the box. Try again.`);
          }}
          onClose={closeOpen}
        />
      )}
    </>
  );
}
