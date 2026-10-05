#include "VelaOpusDecoder.h"
#include <ogg/ogg.h>
#include <opus.h>
#include <assert.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static void pages(FILE *file, ogg_stream_state *stream) {
  ogg_page page;
  while (ogg_stream_flush(stream, &page)) {
    assert(fwrite(page.header, 1, (size_t)page.header_len, file) == (size_t)page.header_len);
    assert(fwrite(page.body, 1, (size_t)page.body_len, file) == (size_t)page.body_len);
  }
}
static void write_link(FILE *file, int serial, int channels, int long_stream) {
  ogg_stream_state stream;
  assert(ogg_stream_init(&stream, serial) == 0);
  unsigned char head[19] = "OpusHead";
  head[8] = 1; head[9] = (unsigned char)channels; head[10] = 56; head[11] = 1;
  head[12] = 128; head[13] = 187;
  ogg_packet packet = { .packet = head, .bytes = 19, .b_o_s = 1, .packetno = 0 };
  assert(ogg_stream_packetin(&stream, &packet) == 0); pages(file, &stream);
  unsigned char tags[16] = "OpusTags";
  packet = (ogg_packet){ .packet = tags, .bytes = 16, .packetno = 1 };
  assert(ogg_stream_packetin(&stream, &packet) == 0); pages(file, &stream);
  int error;
  OpusEncoder *encoder = opus_encoder_create(48000, channels, OPUS_APPLICATION_AUDIO, &error);
  assert(error == OPUS_OK);
  opus_int16 pcm[960 * 2]; unsigned char compressed[4000];
  for (int n = 0; n < 10; n++) {
    for (int i = 0; i < 960 * channels; i++) pcm[i] = (opus_int16)(6000 * sin((n * 960 + i / channels) * 0.06));
    int count = opus_encode(encoder, pcm, 960, compressed, sizeof(compressed));
    assert(count > 0);
    packet = (ogg_packet){ .packet = compressed, .bytes = count, .e_o_s = n == 9, .granulepos = long_stream && n == 9 ? 48000LL * 301 : (n + 1) * 960, .packetno = n + 2 };
    assert(ogg_stream_packetin(&stream, &packet) == 0); pages(file, &stream);
  }
  opus_encoder_destroy(encoder); ogg_stream_clear(&stream);
}
static void fixture(const char *path, int chained, int long_stream) {
  FILE *file = fopen(path, "wb"); assert(file != NULL);
  write_link(file, 1, 1, long_stream); if (chained) write_link(file, 2, 2, 0);
  assert(fclose(file) == 0);
}
static uint32_t read32(const unsigned char *p) { return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24; }
int main(void) {
  fixture("mono.ogg", 0, 0);
  assert(vela_decode_opus("mono.ogg", "mono.wav") == 0);
  FILE *file = fopen("mono.wav", "rb"); unsigned char header[44];
  assert(fread(header, 1, 44, file) == 44); fclose(file);
  assert(memcmp(header, "RIFF", 4) == 0 && memcmp(header + 8, "WAVE", 4) == 0);
  assert(read32(header + 24) == 48000 && read32(header + 40) == (9600 - 312) * 4);
  fixture("chained.ogg", 1, 0); assert(vela_decode_opus("chained.ogg", "chained.wav") == 0);
  file = fopen("malformed.ogg", "wb"); fputs("not an Ogg recording", file); fclose(file);
  assert(vela_decode_opus("malformed.ogg", "bad.wav") != 0); assert(access("bad.wav", F_OK) != 0);
  assert(vela_decode_opus("absent.ogg", "bad.wav") != 0);
  file = fopen("oversized.ogg", "wb"); assert(ftruncate(fileno(file), 20 * 1024 * 1024 + 1) == 0); fclose(file);
  assert(vela_decode_opus("oversized.ogg", "bad.wav") != 0);
  fixture("long.ogg", 0, 1); assert(vela_decode_opus("long.ogg", "bad.wav") != 0);
  assert(vela_decode_opus("mono.ogg", "missing/output.wav") != 0);
  puts("Decoder checks passed: mono, chained mono/stereo, WAV format, malformed, missing, oversized, duration bound, unwritable destination");
  return 0;
}
