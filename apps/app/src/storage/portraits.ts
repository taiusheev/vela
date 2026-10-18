import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { type PortraitFiles, PortraitStore, portraitPath } from "./portrait-store.ts";

const browser = new Map<string, string>();
const scopeDirectory = (scope: string) =>
  new Directory(Paths.cache, "vela-portraits", portraitPath(scope));
const personDirectory = (scope: string, person: string) =>
  new Directory(scopeDirectory(scope), portraitPath(person));
const files: PortraitFiles =
  Platform.OS === "web"
    ? {
        read: (scope, person) => browser.get(JSON.stringify([scope, person])) ?? null,
        save: (scope, person, uri) => {
          browser.set(JSON.stringify([scope, person]), uri);
          return uri;
        },
        remove: (scope, person) => {
          browser.delete(JSON.stringify([scope, person]));
        },
        clear: (scope) => {
          for (const key of browser.keys())
            if ((JSON.parse(key) as string[])[0] === scope) browser.delete(key);
        },
      }
    : {
        read: (scope, person) => {
          const directory = personDirectory(scope, person);
          if (!directory.exists) return null;
          const photos = directory
            .list()
            .filter(
              (entry): entry is File =>
                entry instanceof File && /^portrait-\d+-[a-z0-9]+\.jpg$/.test(entry.name),
            );
          return photos.sort((a, b) => b.name.localeCompare(a.name))[0]?.uri ?? null;
        },
        save: (scope, person, uri) => {
          const directory = personDirectory(scope, person);
          directory.create({ intermediates: true, idempotent: true });
          const photo = new File(
            directory,
            `portrait-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`,
          );
          try {
            new File(uri).copy(photo);
          } catch (error) {
            if (photo.exists) photo.delete();
            throw error;
          }
          // Install the replacement before removing the old portrait. Never return a stale image URI.
          for (const previous of directory.list())
            if (previous.uri !== photo.uri) {
              try {
                previous.delete();
              } catch {
                /* A failed obsolete-file cleanup does not undo the installed photo. Sign-out deletes the directory. */
              }
            }
          return photo.uri;
        },
        remove: (scope, person) => {
          const directory = personDirectory(scope, person);
          if (directory.exists) directory.delete();
        },
        clear: (scope) => {
          const directory = scopeDirectory(scope);
          if (directory.exists) directory.delete();
        },
      };
export const portraits = new PortraitStore(files);
export function activatePortraitSession(scope: string): void {
  portraits.activate(scope);
}
export function clearPortraitSession(scope: string): void {
  portraits.clear(scope);
}
