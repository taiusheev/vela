// Metro has to see the workspace root as well as the app, because the app imports @vela packages
// and the dependencies are hoisted to the root (pnpm-workspace.yaml, nodeLinker).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

// Catalogs are imported as .po and compiled by Lingui as Metro bundles them (build plan 3.1). The
// transformer searches for lingui.config.ts from the directory Metro was started in unless
// LINGUI_CONFIG names it, so it is named here. A change to this file, babel.config.js,
// lingui.config.ts or en.po alone needs `expo start -c`: the cache key covers only each file's text.
process.env.LINGUI_CONFIG ??= path.join(projectRoot, "lingui.config.ts");
config.transformer.babelTransformerPath = require.resolve("@lingui/metro-transformer/expo");
config.resolver.sourceExts = [...config.resolver.sourceExts, "po"];

module.exports = config;
