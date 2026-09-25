// The Lingui macros (t, msg, plural, <Trans>) compile to i18n._ calls as the app is bundled, so the
// English in the code is the message id and nothing is looked up by a hand-made key (build plan 3.1).
module.exports = function config(api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"], plugins: ["@lingui/babel-plugin-lingui-macro"] };
};
