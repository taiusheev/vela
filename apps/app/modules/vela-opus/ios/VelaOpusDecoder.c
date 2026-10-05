#include "VelaOpusDecoder.h"
#include <opusfile.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static void little32(unsigned char *p, uint32_t value) {
  for (int i = 0; i < 4; i++) p[i] = (unsigned char)(value >> (i * 8));
}
int vela_decode_opus(const char *source, const char *destination) {
  struct stat st;
  if (stat(source, &st) != 0 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 20 * 1024 * 1024) return -1;
  int error = 0;
  OggOpusFile *input = op_open_file(source, &error);
  if (input == NULL) return -2;
  const ogg_int64_t limit = 48000 * 300;
  const ogg_int64_t total = op_pcm_total(input, -1);
  if (total < 0 || total > limit) { op_free(input); return -3; }
  FILE *output = fopen(destination, "wb");
  if (output == NULL) { op_free(input); return -4; }
  unsigned char header[44] = {0};
  memcpy(header, "RIFF", 4); memcpy(header + 8, "WAVEfmt ", 8);
  little32(header + 16, 16); header[20] = 1; header[22] = 2;
  little32(header + 24, 48000); little32(header + 28, 48000 * 4);
  header[32] = 4; header[34] = 16; memcpy(header + 36, "data", 4);
  int failed = fwrite(header, 1, sizeof(header), output) != sizeof(header);
  opus_int16 pcm[5760 * 2];
  unsigned char bytes[sizeof(pcm)];
  ogg_int64_t written = 0;
  while (!failed) {
    const int frames = op_read_stereo(input, pcm, 5760 * 2);
    if (frames == 0) break;
    // Corrupt/truncated streams fail closed. No unbounded retry on OP_HOLE.
    if (frames < 0 || written + frames > limit) { failed = 1; break; }
    for (int i = 0; i < frames * 2; i++) {
      const uint16_t sample = (uint16_t)pcm[i];
      bytes[i * 2] = (unsigned char)sample;
      bytes[i * 2 + 1] = (unsigned char)(sample >> 8);
    }
    const size_t count = (size_t)frames * 4;
    if (fwrite(bytes, 1, count, output) != count) { failed = 1; break; }
    written += frames;
  }
  if (written == 0 || written != total) failed = 1;
  if (!failed) {
    little32(header + 4, (uint32_t)written * 4 + 36);
    little32(header + 40, (uint32_t)written * 4);
    if (fseek(output, 0, SEEK_SET) != 0 || fwrite(header, 1, sizeof(header), output) != sizeof(header)) failed = 1;
  }
  if (fclose(output) != 0) failed = 1;
  op_free(input);
  if (failed) { unlink(destination); return -5; }
  return 0;
}
