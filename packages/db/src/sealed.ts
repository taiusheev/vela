/**
 * Synchronous content sealing for Drizzle's synchronous column codecs (ADR-38).
 *
 * This module is the cryptographic primitive only. Callers still have to wire it into every
 * content column and supply the environment's key before those columns are read or written.
 */
import { gcm } from "@noble/ciphers/aes";
import { customType } from "drizzle-orm/pg-core";

const encoder = new TextEncoder();
// Keep a leading U+FEFF as content so UTF-8 decoding is an exact round-trip.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const nonceLength = 12;
const prefix = "v1";
let contentKey: Uint8Array | null = null;

export type JsonPathPart = string | number;
export type JsonPath = readonly JsonPathPart[];

/** Restricts JSON encryption to selected paths; each selected path includes its descendants. */
export interface JsonSealingPolicy {
  readonly include?: readonly JsonPath[];
  readonly exclude?: readonly JsonPath[];
}

/** Seal her free text and the chip or vote label she tapped; indexes and media ids stay clear. */
export const ANSWER_PAYLOAD_SEALING = {
  include: [["text"], ["choice"]],
} as const satisfies JsonSealingPolicy;

/** Seal user/generated words while preserving ids and media grouping metadata for SQL. */
export const EXCHANGE_OPTIONS_SEALING = {
  include: [["vote_options"], ["caption"], ["word"], ["word_to_teach"]],
} as const satisfies JsonSealingPolicy;

/** Preserve gateway control fields used by SQL while sealing the actual message and reply. */
export const OUTBOUND_PAYLOAD_SEALING = {
  include: [["message"], ["reply"]],
  exclude: [["message", "replyToMessageId"]],
} as const satisfies JsonSealingPolicy;

export class SealedValueError extends Error {
  readonly code = "SEALED_VALUE_INVALID";

  constructor() {
    super("Sealed value could not be opened");
    this.name = "SealedValueError";
  }
}

/** Configure this Worker or process with its environment-specific key before database I/O. */
export function configureContentKey(encoded: string): void {
  contentKey = decodeContentKey(encoded);
}

/** Drizzle column for a nullable or required UTF-8 value. */
export function sealedText(column: string) {
  assertColumn(column);
  return customType<{ data: string; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) =>
      value.length === 0 ? value : sealContent(value, column, requireContentKey()),
    fromDriver: (value) =>
      value.length === 0 ? value : openContent(value, column, requireContentKey()),
  })(columnName(column));
}

/** Drizzle column for a JSON value stored as sealed text in Postgres. */
export function sealedJson<T>(column: string) {
  assertColumn(column);
  return customType<{ data: T; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new Error(`Cannot seal a non-JSON value for ${column}`);
      }
      return sealContent(serialized, column, requireContentKey());
    },
    fromDriver: (value) => {
      const serialized = openContent(value, column, requireContentKey());
      return JSON.parse(serialized) as unknown as T;
    },
  })(columnName(column));
}

/** A JSONB column whose selected string values are sealed without changing its SQL structure. */
export function sealedJsonb<T>(column: string, policy?: JsonSealingPolicy) {
  assertColumn(column);
  return customType<{ data: T; driverData: string }>({
    dataType: () => "jsonb",
    toDriver: (value) => encodeSealedJsonb(value, column, policy, requireContentKey()),
    fromDriver: (value) => decodeSealedJsonb(value, column, policy, requireContentKey()) as T,
  })(columnName(column));
}

/** Seal each non-null text array element while retaining PostgreSQL's array type and operators. */
export function sealedTextArray(column: string) {
  return sealedText(column).array();
}

/** Encode a structured value for a SQL expression that bypasses Drizzle's column codec. */
export function encodeSealedJsonb<T>(
  value: T,
  column: string,
  policy: JsonSealingPolicy | undefined,
  key: Uint8Array,
): string {
  assertColumn(column);
  const encoded = transformJson(value, column, policy, key, "seal", []);
  const serialized = JSON.stringify(encoded);
  if (serialized === undefined) {
    throw new Error(`Cannot seal a non-JSON value for ${column}`);
  }
  return serialized;
}

/** Re-seal a legacy JSONB value once, leaving already-openable v1 values untouched. */
export function resealJsonb<T>(
  value: T,
  column: string,
  policy: JsonSealingPolicy | undefined,
  key: Uint8Array,
): string {
  assertColumn(column);
  const encoded = transformJson(value, column, policy, key, "reseal", []);
  const serialized = JSON.stringify(encoded);
  if (serialized === undefined) {
    throw new Error(`Cannot seal a non-JSON value for ${column}`);
  }
  return serialized;
}

/** Open a JSONB value returned by a driver that parses jsonb or leaves it as text. */
export function decodeSealedJsonb<T>(
  value: string | T,
  column: string,
  policy: JsonSealingPolicy | undefined,
  key: Uint8Array,
): T {
  assertColumn(column);
  let parsed: unknown = value;
  if (typeof value === "string" && !isV1ContentEnvelope(value)) {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new SealedValueError();
    }
  }
  return transformJson(parsed, column, policy, key, "open", []) as T;
}

/** Decode a base64url key as exactly 32 bytes (AES-256). */
export function decodeContentKey(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new Error("CONTENT_KEY_V1 must be a base64url encoded 32-byte key");
  }
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/") + "=";
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("CONTENT_KEY_V1 must be a base64url encoded 32-byte key");
  }
  const key = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (key.byteLength !== 32) {
    throw new Error("CONTENT_KEY_V1 must be a base64url encoded 32-byte key");
  }
  return key;
}

/** Seal a UTF-8 value using a fresh 96-bit nonce and table.column associated data. */
export function sealContent(
  value: string,
  column: string,
  key: Uint8Array,
  path: JsonPath = [],
): string {
  assertKey(key);
  assertColumn(column);
  const nonce = crypto.getRandomValues(new Uint8Array(nonceLength));
  const ciphertext = gcm(key, nonce, associatedData(column, path)).encrypt(encoder.encode(value));
  return `${prefix}.${toBase64Url(nonce)}.${toBase64Url(ciphertext)}`;
}

/** Open a v1 value only in the same table.column context in which it was sealed. */
export function openContent(
  value: string,
  column: string,
  key: Uint8Array,
  path: JsonPath = [],
): string {
  assertKey(key);
  assertColumn(column);
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== prefix) {
    throw new SealedValueError();
  }

  try {
    const nonce = fromBase64Url(parts[1] ?? "");
    const ciphertext = fromBase64Url(parts[2] ?? "");
    if (nonce.byteLength !== nonceLength || ciphertext.byteLength < 16) {
      throw new SealedValueError();
    }
    return decoder.decode(gcm(key, nonce, associatedData(column, path)).decrypt(ciphertext));
  } catch {
    throw new SealedValueError();
  }
}

/** Whether a string has the complete v1 envelope shape; authentication still requires openContent. */
export function isV1ContentEnvelope(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== prefix) return false;
  try {
    return (
      fromBase64Url(parts[1] ?? "").byteLength === nonceLength &&
      fromBase64Url(parts[2] ?? "").byteLength >= 16
    );
  } catch {
    return false;
  }
}

function transformJson(
  value: unknown,
  column: string,
  policy: JsonSealingPolicy | undefined,
  key: Uint8Array,
  operation: "seal" | "open" | "reseal",
  path: JsonPath,
): unknown {
  if (typeof value === "string" && shouldSealPath(path, policy)) {
    if (operation === "seal") {
      return sealContent(value, column, key, path);
    }
    if (operation === "open") {
      return openContent(value, column, key, path);
    }
    // Reserve the version prefix so damaged ciphertext cannot fall through as legacy plaintext.
    if (value.startsWith(`${prefix}.`)) {
      if (!isV1ContentEnvelope(value)) throw new SealedValueError();
      openContent(value, column, key, path);
      return value;
    }
    return sealContent(value, column, key, path);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      transformJson(entry, column, policy, key, operation, [...path, index]),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([field, entry]) => [
        field,
        transformJson(entry, column, policy, key, operation, [...path, field]),
      ]),
    );
  }
  return value;
}

function shouldSealPath(path: JsonPath, policy: JsonSealingPolicy | undefined): boolean {
  if (policy === undefined || policy.include === undefined) {
    return !(policy?.exclude?.some((excluded) => isPathPrefix(excluded, path)) ?? false);
  }
  if (!policy.include.some((included) => isPathPrefix(included, path))) {
    return false;
  }
  return !(policy.exclude?.some((excluded) => isPathPrefix(excluded, path)) ?? false);
}

function isPathPrefix(prefixPath: JsonPath, path: JsonPath): boolean {
  return (
    prefixPath.length <= path.length && prefixPath.every((part, index) => part === path[index])
  );
}

function associatedData(column: string, path: JsonPath): Uint8Array {
  // JSON array ordinals are intentionally omitted. Retention rebuilds `quiet_events.ask_to_check`
  // with jsonb_agg, whose order is not guaranteed; binding an array index would make a valid
  // ciphertext unreadable if Postgres emits the same entries in a different order. Object keys
  // still bind the value to its semantic JSON path.
  const objectPath = path.filter((part): part is string => typeof part === "string");
  return encoder.encode(
    objectPath.length === 0 ? column : `${column}#${JSON.stringify(objectPath)}`,
  );
}

function assertKey(key: Uint8Array): void {
  if (key.byteLength !== 32) {
    throw new Error("Content key must be exactly 32 bytes");
  }
}

function requireContentKey(): Uint8Array {
  if (contentKey === null) {
    throw new Error("Content key is not configured");
  }
  return contentKey;
}

function assertColumn(column: string): void {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(column)) {
    throw new Error("Associated data must be a table.column name");
  }
}

function columnName(column: string): string {
  return column.slice(column.indexOf(".") + 1);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SealedValueError();
  }
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
