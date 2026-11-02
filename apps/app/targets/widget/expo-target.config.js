/** Mom's window on the home and lock screen (next native build, item 3). */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "VelaWidget",
  bundleIdentifier: ".widget",
  deploymentTarget: "17.0",
  colors: {
    $accent: "#E9A23B",
    $widgetBackground: { light: "#FBF7F0", dark: "#1B1714" },
  },
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
