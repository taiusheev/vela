import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [join(root, "scripts/prepare-codecs.mjs")], { stdio: "inherit" });
const build = join(root, ".host-build");
mkdirSync(build, { recursive: true });
const sources = JSON.parse(readFileSync(join(root, "generated/sources.json"), "utf8"));
const includes = [
  "generated",
  "ios",
  "vendor/opus",
  "vendor/opus/include",
  "vendor/opus/celt",
  "vendor/opus/silk",
  "vendor/opus/silk/float",
  "vendor/opus/dnn",
  "vendor/ogg/include",
  "vendor/opusfile/include",
  "vendor/opusfile/src",
].flatMap((path) => ["-I", join(root, path)]);
const objects = [...sources, "ios/VelaOpusDecoder.c"].map((source, index) => {
  const output = join(build, `${index}.o`);
  execFileSync(
    "clang",
    ["-O2", "-DHAVE_CONFIG_H", "-DOPUS_BUILD", ...includes, "-c", join(root, source), "-o", output],
    { stdio: "pipe" },
  );
  return output;
});
const binary = join(build, "decoder-test");
execFileSync(
  "clang",
  [...includes, join(root, "tests/decoder-test.c"), ...objects, "-lm", "-o", binary],
  { stdio: "inherit" },
);
execFileSync(binary, [], { cwd: build, stdio: "inherit" });
process.stdout.write(
  "Host C decoder compiled on macOS; this is not an iOS simulator/device build.\n",
);
