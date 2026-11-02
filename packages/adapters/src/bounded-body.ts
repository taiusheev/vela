/**
 * The one way the channels read a downloaded file, so a voice note or photo can never sit whole in
 * the isolate's 128 MB before its size is checked.
 */

/**
 * The response's body, read piece by piece and given up the moment it passes `maxBytes`: null
 * then, with the rest cancelled, as for a declared length over it, which is refused before
 * anything is read. A declared length is a promise the body may break, so the count decides. A
 * read that fails rejects with the stream's error, a fetch timeout's included.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await letGo(response.body);
    return null;
  }
  if (response.body === null) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  try {
    const pieces: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - size) {
        await letGo(reader);
        return null;
      }
      pieces.push(value);
      size += value.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const piece of pieces) {
      bytes.set(piece, offset);
      offset += piece.byteLength;
    }
    return bytes.buffer;
  } finally {
    reader.releaseLock();
  }
}

// What is left of a refused body is dropped so its connection is freed. The download has already
// failed, so a cancel that fails too changes nothing.
async function letGo(
  body: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array> | null,
): Promise<void> {
  await body?.cancel().catch(() => undefined);
}
