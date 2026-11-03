import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ApiPhotoBoxNext,
  type ApiPhotoBoxPhoto,
  PHOTO_BOX_LIMIT,
  type PhotoBoxEra,
} from "@vela/contracts";
import { useCallback, useState } from "react";
import {
  addToPhotoBox,
  apiConfigured,
  changePhotoBoxPhoto,
  draftPhotoQuestions,
  fetchPhotoBox,
  photoBoxRefusal,
  removeFromPhotoBox,
} from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { photoRefusal, uploadMedia } from "../api/upload.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { demoDataAllowed } from "./live-state.ts";

/**
 * The family's photo box (ADR-58): photos the family adds once, which Vela turns into her free
 * mornings, about twice a week. Adding is two steps per photo, the upload Ask already uses (ADR-33)
 * and then the box, one photo after another so a failure names the photo it belongs to.
 */

/** A box photo as the screen shows it: from the API, or, in the example family, from this phone. */
export interface BoxPhoto extends ApiPhotoBoxPhoto {
  /** The example family's photo, shown from the phone's own file; never set for a real one. */
  localUri?: string;
}

/** A photo chosen from the library, waiting to be marked and added. */
export interface PendingPhoto {
  /** The re-encoded file on the phone; a retry sends it as it is. */
  uri: string;
  /** Minted when the photo is chosen, so a retry is answered from the upload's receipt. */
  key: string;
  era: PhotoBoxEra;
  caption: string;
  /** The adder's own question about it (ADR-61); empty leaves her morning to Vela's sentence. */
  question: string;
  /** Set once the photo went up early for Vela to draft questions about it. */
  mediaId?: string;
}

/** A photo Vela is asked to draft questions about: one still being added, or one in the box. */
export type DraftTarget =
  | { kind: "pending"; photo: PendingPhoto }
  | { kind: "box"; photo: BoxPhoto };

/** Vela's drafts, and the uploaded photo's id when a chosen photo had to go up first. */
export interface Drafts {
  questions: string[];
  mediaId?: string;
}

type BoxChange = { era?: PhotoBoxEra; caption?: string | null; question?: string | null };

/** Why a photo did not go into the box. */
export type AddFailure = "limit" | "full" | "unusable" | "trouble";

export interface PhotoBoxView {
  photos: BoxPhoto[];
  /** Each parent's next picture morning as the server plans it; empty in the example family. */
  next: ApiPhotoBoxNext[];
  limit: number;
  /** Places still free in the box. */
  room: number;
  loading: boolean;
  trouble: boolean;
  demo: boolean;
  refresh(): Promise<void>;
  /** Adds each photo in turn; answers the ones that did not go in, with why. */
  add(pending: readonly PendingPhoto[]): Promise<{ photo: PendingPhoto; failure: AddFailure }[]>;
  adding: boolean;
  /** How far an `add` has gone: photos done of the photos sent. */
  progress: { done: number; total: number } | undefined;
  change(id: string, change: BoxChange): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  busy: boolean;
  /** Vela's questions about a photo; null when they could not be had, so the adder writes one. */
  suggest(target: DraftTarget): Promise<Drafts | null>;
}

function failureOf(error: unknown): AddFailure {
  const refusal = photoBoxRefusal(error);
  if (refusal === "box_full") return "full";
  const upload = photoRefusal(error);
  if (upload === "limit") return "limit";
  if (upload === "unusable") return "unusable";
  return "trouble";
}

export function usePhotoBox(familyId: string | undefined, enabled: boolean): PhotoBoxView {
  const example = useExamplePhotoBox();
  const account = useAccount();
  const queries = useQueryClient();
  const addKey = useIdempotencyKey("photo-box-add");
  const changeKey = useIdempotencyKey("photo-box-change");
  const removeKey = useIdempotencyKey("photo-box-remove");
  const draftKey = useIdempotencyKey("photo-box-drafts");
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const live = apiConfigured() && account.signedIn && familyId !== undefined && enabled;
  const read = useQuery({
    queryKey: ["photo-box", familyId],
    enabled: live,
    queryFn: async () => fetchPhotoBox(familyId ?? "", await account.token()),
  });
  const again = useCallback(async () => {
    await queries.invalidateQueries({ queryKey: ["photo-box", familyId] });
  }, [queries, familyId]);
  const change = useMutation({
    mutationFn: async (input: { id: string } & BoxChange) => {
      const { id, ...body } = input;
      return changePhotoBoxPhoto(id, body, changeKey(input), await account.token());
    },
    onSuccess: again,
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      removeFromPhotoBox(id, removeKey({ id }), await account.token()),
    onSuccess: again,
  });

  if (demoDataAllowed(apiConfigured(), accountsConfigured())) return example;
  const photos = read.data?.photos ?? [];
  const limit = read.data?.limit ?? PHOTO_BOX_LIMIT;
  return {
    photos,
    next: read.data?.next ?? [],
    limit,
    room: Math.max(0, limit - photos.length),
    loading: live && read.isPending,
    trouble: read.isError,
    demo: false,
    refresh: again,
    adding,
    progress,
    add: async (pending) => {
      if (familyId === undefined) return pending.map((photo) => ({ photo, failure: "trouble" }));
      setAdding(true);
      setProgress({ done: 0, total: pending.length });
      const failed: { photo: PendingPhoto; failure: AddFailure }[] = [];
      try {
        for (const photo of pending) {
          try {
            const mediaId =
              photo.mediaId ??
              (await uploadMedia(familyId, photo.key, photo.uri, await account.token(), () => {}))
                .id;
            const caption = photo.caption.trim();
            const question = photo.question.trim();
            await addToPhotoBox(
              familyId,
              {
                media_id: mediaId,
                era: photo.era,
                ...(caption.length === 0 ? {} : { caption }),
                ...(question.length === 0 ? {} : { question }),
              },
              addKey({ key: photo.key, era: photo.era, caption, question }),
              await account.token(),
            );
          } catch (error) {
            failed.push({ photo, failure: failureOf(error) });
          }
          setProgress((current) =>
            current === undefined ? current : { ...current, done: current.done + 1 },
          );
        }
      } finally {
        setAdding(false);
        setProgress(undefined);
        await again();
      }
      return failed;
    },
    change: async (id, body) => {
      try {
        await change.mutateAsync({ id, ...body });
        return true;
      } catch {
        return false;
      }
    },
    remove: async (id) => {
      try {
        await remove.mutateAsync(id);
        return true;
      } catch {
        return false;
      }
    },
    busy: change.isPending || remove.isPending,
    suggest: async (target) => {
      if (familyId === undefined) return null;
      try {
        // A chosen photo goes up first, under the key its add will use, so the add reuses it.
        const mediaId =
          target.kind === "box"
            ? target.photo.media_id
            : (target.photo.mediaId ??
              (
                await uploadMedia(
                  familyId,
                  target.photo.key,
                  target.photo.uri,
                  await account.token(),
                  () => {},
                )
              ).id);
        const caption = (target.photo.caption ?? "").trim();
        const input = {
          media_id: mediaId,
          era: target.photo.era,
          ...(caption.length === 0 ? {} : { caption }),
        };
        const drafts = await draftPhotoQuestions(
          familyId,
          input,
          draftKey({ ...input, at: Date.now() }),
          await account.token(),
        );
        return { questions: drafts.questions, ...(target.kind === "pending" ? { mediaId } : {}) };
      } catch {
        return null;
      }
    },
  };
}

/** The example family's box, kept on this screen only: nothing is uploaded, sent or saved. */
function useExamplePhotoBox(): PhotoBoxView {
  const { t } = useLingui();
  const [photos, setPhotos] = useState<BoxPhoto[]>([]);
  return {
    photos,
    next: [],
    limit: PHOTO_BOX_LIMIT,
    room: PHOTO_BOX_LIMIT - photos.length,
    loading: false,
    trouble: false,
    demo: true,
    refresh: async () => {},
    adding: false,
    progress: undefined,
    add: async (pending) => {
      setPhotos((current) => [
        ...pending.map((photo) => ({
          id: photo.key,
          media_id: photo.key,
          era: photo.era,
          caption: photo.caption.trim().length === 0 ? null : photo.caption.trim(),
          question: photo.question.trim().length === 0 ? null : photo.question.trim(),
          width: null,
          height: null,
          added_by_name: null,
          can_change: true,
          last_used_on: null,
          localUri: photo.uri,
        })),
        ...current,
      ]);
      return [];
    },
    change: async (id, body) => {
      setPhotos((current) =>
        current.map((photo) =>
          photo.id === id
            ? {
                ...photo,
                ...(body.era === undefined ? {} : { era: body.era }),
                ...(body.caption === undefined ? {} : { caption: body.caption }),
                ...(body.question === undefined ? {} : { question: body.question }),
              }
            : photo,
        ),
      );
      return true;
    },
    remove: async (id) => {
      setPhotos((current) => current.filter((photo) => photo.id !== id));
      return true;
    },
    busy: false,
    // The example family has no Vela to look at the photo: it shows how drafts read.
    suggest: async (target) => ({
      questions:
        target.photo.era === "old"
          ? [t`Who took this one?`, t`Where was this?`, t`What happened that day?`]
          : [
              t`What would you cook with these?`,
              t`Which one would you pick first?`,
              t`Have you seen these at your market?`,
            ],
    }),
  };
}

/** Whether the example family, with no API, shows the photo box, so the screen can be tried. */
export function photoBoxDemo(): boolean {
  return demoDataAllowed(apiConfigured(), accountsConfigured());
}
