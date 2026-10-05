const { withDangerousMod } = require("@expo/config-plugins");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = (config) =>
  withDangerousMod(config, [
    "ios",
    async (config) => {
      execFileSync(process.execPath, [path.join(__dirname, "scripts/prepare-codecs.mjs")], {
        stdio: "inherit",
      });
      return config;
    },
  ]);
