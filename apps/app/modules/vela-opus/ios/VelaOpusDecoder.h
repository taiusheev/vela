#ifndef VELA_OPUS_DECODER_H
#define VELA_OPUS_DECODER_H
/** Local files only; 20 MiB source, five minutes of stereo PCM, no network or processor. */
int vela_decode_opus(const char *source, const char *destination);
#endif
