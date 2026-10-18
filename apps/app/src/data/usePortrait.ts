import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import { Platform } from "react-native";
import { useAccount } from "../auth/clerk.tsx";
import { portraits } from "../storage/portraits.ts";
import { sessionScope } from "./live-state.ts";

/** Chosen portraits stay in this signed-in session's private app files; web keeps memory only. */
export function usePortrait(familyId: string, memberId: string) {
  const account = useAccount();
  const scope = sessionScope(account);
  const queries = useQueryClient();
  const key = ["portrait", scope, familyId, memberId];
  const photo = useQuery({
    queryKey: key,
    queryFn: () => portraits.read(scope, familyId, memberId),
    staleTime: Infinity,
  });
  return {
    uri: photo.data ?? null,
    choose: async () => {
      const picked = await launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 1,
        exif: false,
      });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return;
      const drawing = ImageManipulator.manipulate(asset.uri);
      const resize = drawing.resize({ width: 480 });
      const image = await resize.renderAsync();
      try {
        const saved = await image.saveAsync({
          format: SaveFormat.JPEG,
          compress: 0.8,
          base64: Platform.OS === "web",
        });
        try {
          const source =
            Platform.OS === "web" ? `data:image/jpeg;base64,${saved.base64}` : saved.uri;
          const uri = portraits.save(scope, familyId, memberId, source);
          queries.setQueryData(key, uri);
        } finally {
          if (Platform.OS !== "web") {
            for (const uri of [saved.uri, asset.uri]) {
              if (uri.startsWith(`${new Directory(Paths.cache).uri.replace(/\/+$/, "")}/`)) {
                const temporary = new File(uri);
                if (temporary.exists) temporary.delete();
              }
            }
          }
        }
      } finally {
        image.release();
        drawing.release();
      }
    },
    remove: () => {
      portraits.remove(scope, familyId, memberId);
      queries.setQueryData(key, null);
    },
  };
}
