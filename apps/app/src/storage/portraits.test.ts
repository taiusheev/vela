import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => {
  const directories = new Set<string>();
  const bytes = new Map<string, string>();
  const path = (...parts: (string | { uri: string })[]) =>
    parts
      .map((part) => (typeof part === "string" ? part : part.uri))
      .join("/")
      .replace(/\/+$/u, "");
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(...parts);
    }
    get name() {
      return this.uri.split("/").at(-1) ?? "";
    }
    get exists() {
      return bytes.has(this.uri);
    }
    copy(target: File) {
      const value = bytes.get(this.uri);
      if (value === undefined) throw new Error("missing source");
      bytes.set(target.uri, value);
    }
    delete() {
      bytes.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path(...parts);
    }
    get exists() {
      return directories.has(this.uri);
    }
    get parentDirectory(): Directory {
      return new Directory(this.uri.slice(0, this.uri.lastIndexOf("/")));
    }
    create() {
      const parts = this.uri.split("/");
      for (let i = 1; i <= parts.length; i += 1) directories.add(parts.slice(0, i).join("/"));
    }
    list() {
      return [...bytes.keys()]
        .filter((key) => key.startsWith(`${this.uri}/`))
        .map((key) => new File(key));
    }
    delete() {
      for (const key of bytes.keys()) if (key.startsWith(`${this.uri}/`)) bytes.delete(key);
      for (const key of directories)
        if (key === this.uri || key.startsWith(`${this.uri}/`)) directories.delete(key);
    }
    move(target: Directory) {
      for (const [key, value] of [...bytes])
        if (key.startsWith(`${this.uri}/`)) {
          bytes.set(`${target.uri}${key.slice(this.uri.length)}`, value);
          bytes.delete(key);
        }
      directories.delete(this.uri);
      directories.add(target.uri);
      this.uri = target.uri;
    }
  }
  return { directories, bytes, File, Directory };
});
vi.mock("expo-file-system", () => ({ ...disk, Paths: { cache: "cache", document: "documents" } }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { portraitKey, portraitPath } from "./portrait-store.ts";
import {
  activatePortraitSession,
  clearPortraitSession,
  closePortraitSession,
  portraits,
} from "./portraits.ts";

beforeEach(() => {
  disk.bytes.clear();
  disk.directories.clear();
  activatePortraitSession("session");
});
describe("native portrait storage", () => {
  it("keeps the photo through cache eviction and normal app teardown", () => {
    disk.bytes.set("cache/picked.jpg", "synthetic photo");
    const installed = portraits.save("session", "family", "parent", "cache/picked.jpg");
    expect(installed.startsWith("documents/")).toBe(true);
    closePortraitSession("session");
    new disk.Directory("cache").delete();
    activatePortraitSession("session");
    expect(portraits.read("session", "family", "parent")).toBe(installed);
    expect(disk.bytes.get(installed)).toBe("synthetic photo");
    clearPortraitSession("session");
    expect(disk.bytes.has(installed)).toBe(false);
  });
  it("moves an existing cached portrait to durable storage when read", () => {
    const legacy = new disk.Directory(
      "cache",
      "vela-portraits",
      portraitPath("session"),
      portraitPath(portraitKey("family", "parent")),
    );
    legacy.create();
    disk.bytes.set(`${legacy.uri}/portrait-123-abc.jpg`, "existing photo");
    const migrated = portraits.read("session", "family", "parent");
    expect(migrated?.startsWith("documents/")).toBe(true);
    expect(disk.bytes.get(migrated ?? "")).toBe("existing photo");
    expect(legacy.exists).toBe(false);
  });
});
