import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pins = JSON.parse(readFileSync(join(root, "codec-pins.json"), "utf8"));
mkdirSync(join(root, ".archives"), { recursive: true });
mkdirSync(join(root, "generated"), { recursive: true });

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? filesBelow(join(path, item.name)) : [join(path, item.name)],
  );
}
function variables(path) {
  const text = readFileSync(path, "utf8").replace(/\\\r?\n/g, " ");
  return new Map(
    [...text.matchAll(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/gm)].map((match) => [match[1], match[2]]),
  );
}
function expanded(map, name, depth = 0) {
  if (depth > 20) throw new Error("Recursive upstream source list");
  return (map.get(name) ?? "").replace(/\$\(([A-Za-z0-9_]+)\)/g, (_, key) =>
    expanded(map, key, depth + 1),
  );
}
const sources = [];
for (const [name, pin] of Object.entries(pins)) {
  const archive = join(root, ".archives", `${name}-${pin.version}.tar.gz`);
  if (!existsSync(archive)) {
    const response = await fetch(pin.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Cannot fetch pinned ${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
      throw new Error(`Checksum mismatch: ${name}`);
    writeFileSync(archive, bytes);
  }
  if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== pin.sha256)
    throw new Error(`Checksum mismatch: ${name}`);
  const directory = join(root, "vendor", name);
  if (!existsSync(join(directory, "Makefile"))) {
    mkdirSync(directory, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "--strip-components", "1", "-C", directory]);
    const flags = ["--disable-shared", "--enable-static"];
    if (name === "opus")
      flags.push(
        "--disable-extra-programs",
        "--disable-doc",
        "--disable-intrinsics",
        "--disable-rtcd",
        "--disable-dred",
        "--disable-osce",
        "--disable-deep-plc",
      );
    if (name === "opusfile")
      flags.push("--disable-http", "--disable-examples", "--disable-doc", "--disable-largefile");
    execFileSync("./configure", flags, {
      cwd: directory,
      stdio: "pipe",
      env: {
        ...process.env,
        CFLAGS: "-O2",
        DEPS_CFLAGS: `-I${join(root, "vendor/opus/include")} -I${join(root, "vendor/ogg/include")}`,
        DEPS_LIBS: "-lopus -logg",
      },
    });
  }
  // Each library has its own config. Rename only this include to avoid header-path collisions
  // in CocoaPods' single target. Archive bytes remain pinned; the transform is deterministic.
  const configPath = join(directory, "config.h");
  if (existsSync(configPath))
    writeFileSync(join(root, "generated", `vela_${name}_config.h`), readFileSync(configPath));
  for (const path of filesBelow(directory).filter((path) => /\.[ch]$/.test(path))) {
    const original = readFileSync(path, "utf8");
    const transformed = original.replace(
      /#\s*include\s*["<]config\.h[">]/g,
      `#include "vela_${name}_config.h"`,
    );
    if (transformed !== original) writeFileSync(path, transformed);
  }
  const makefile = name === "ogg" ? join(directory, "src/Makefile") : join(directory, "Makefile");
  const map = variables(makefile);
  const variable =
    name === "ogg"
      ? "libogg_la_SOURCES"
      : name === "opus"
        ? "libopus_la_SOURCES"
        : "libopusfile_la_SOURCES";
  const prefix = name === "ogg" ? "src/" : "";
  const files = expanded(map, variable)
    .split(/\s+/)
    .filter((path) => path.endsWith(".c"));
  if (files.length === 0) throw new Error(`No sources resolved for ${name}`);
  sources.push(...files.map((path) => `vendor/${name}/${prefix}${path}`));
  const license = ["COPYING", "LICENSE", "COPYING.txt"].find((path) =>
    existsSync(join(directory, path)),
  );
  if (license === undefined) throw new Error(`Missing license: ${name}`);
  mkdirSync(join(root, "licenses"), { recursive: true });
  writeFileSync(join(root, "licenses", `${name}.txt`), readFileSync(join(directory, license)));
  process.stdout.write(`Verified ${name} ${pin.version}: ${files.length} C sources\n`);
}
writeFileSync(join(root, "generated", "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
