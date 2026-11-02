/**
 * Test helpers both channels share: a download body as a chunked answer sends it, with no declared
 * length, so a test can see how much of it a client read before it gave up.
 */

export interface ChunkedBody {
  readonly stream: ReadableStream<Uint8Array>;
  /** The bytes the stream would hold if read to its end. */
  readonly bytes: Uint8Array;
  /** How many pieces have been read, and whether the reader cancelled the rest. */
  readonly progress: { read: number; cancelled: boolean };
}

/**
 * `pieces` pieces of `pieceBytes` each, the nth filled with the byte n. A piece is made only when
 * a read asks for it (a high-water mark of 0), so `progress.read` counts what the client read and
 * nothing the stream queued ahead.
 */
export function chunkedBody(pieceBytes: number, pieces: number): ChunkedBody {
  const progress = { read: 0, cancelled: false };
  const piece = (index: number) => new Uint8Array(pieceBytes).fill((index + 1) % 256);
  const bytes = new Uint8Array(pieceBytes * pieces);
  for (let index = 0; index < pieces; index += 1) {
    bytes.set(piece(index), index * pieceBytes);
  }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (progress.read === pieces) {
          controller.close();
          return;
        }
        controller.enqueue(piece(progress.read));
        progress.read += 1;
      },
      cancel() {
        progress.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, bytes, progress };
}
