export interface AudioDownload {
  uri: string;
  mime: string;
  bytes: number;
}
export interface AudioCachePorts {
  download(path: string, token: string): Promise<AudioDownload>;
  decode(uri: string): Promise<string>;
  remove(uri: string): Promise<void>;
  clear(): Promise<void>;
}
export interface AudioSession {
  userId: string | null;
  token(options?: { fresh?: boolean }): Promise<string | null>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED = new Set(["audio/mp4", "audio/mpeg", "audio/ogg", "audio/opus"]);
const MAX_CACHED_FILES = 3;

/** An account-bound temporary cache; each play reauthorizes and obtains fresh source bytes. */
export function createAudioCache(ports: AudioCachePorts) {
  let generation = 0;
  let owner: string | null = null;
  let clearing: Promise<void> = Promise.resolve();
  const files = new Set<string>();
  return {
    async clear() {
      generation += 1;
      owner = null;
      files.clear();
      clearing = clearing.catch(() => {}).then(() => ports.clear());
      await clearing;
    },
    async release(uri: string) {
      files.delete(uri);
      await ports.remove(uri);
    },
    async prepare(
      session: AudioSession,
      familyId: string,
      mediaId: string,
      expiresAt?: string | null,
    ) {
      if (session.userId === null || !UUID.test(familyId) || !UUID.test(mediaId))
        throw new Error("Audio unavailable");
      if (expiresAt != null && Date.parse(expiresAt) <= Date.now())
        throw new Error("Audio expired");
      if (owner !== session.userId) {
        generation += 1;
        owner = session.userId;
        files.clear();
        clearing = clearing.catch(() => {}).then(() => ports.clear());
      }
      const begun = generation;
      await clearing;
      if (begun !== generation || owner !== session.userId) throw new Error("Session ended");
      const token = await session.token();
      if (token === null || begun !== generation) throw new Error("Session ended");
      const path = `/v1/families/${familyId}/media/${mediaId}?role=original`;
      let source: AudioDownload;
      try {
        source = await ports.download(path, token);
      } catch (error) {
        if (!(error instanceof Error) || !("status" in error) || error.status !== 401) throw error;
        const fresh = await session.token({ fresh: true });
        if (fresh === null || begun !== generation) throw new Error("Session ended");
        source = await ports.download(path, fresh);
      }
      const remove = async (uri: string) => {
        await ports.remove(uri).catch(() => {});
      };
      if (
        begun !== generation ||
        !SUPPORTED.has(source.mime) ||
        source.bytes <= 0 ||
        source.bytes > 20 * 1024 * 1024
      ) {
        await remove(source.uri);
        throw new Error("Audio unavailable");
      }
      let uri = source.uri;
      try {
        if (source.mime === "audio/ogg" || source.mime === "audio/opus")
          uri = await ports.decode(source.uri);
        if (begun !== generation) throw new Error("Session ended");
        if (uri !== source.uri) await remove(source.uri);
        while (files.size >= MAX_CACHED_FILES) {
          const oldest = files.values().next().value;
          if (oldest === undefined) break;
          files.delete(oldest);
          await remove(oldest);
        }
        if (begun !== generation) throw new Error("Session ended");
        files.add(uri);
        return uri;
      } catch (error) {
        await remove(source.uri);
        if (uri !== source.uri) await remove(uri);
        throw error;
      }
    },
  };
}
