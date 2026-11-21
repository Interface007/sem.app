/*
 * Expo's default preset, plus one exception:
 *
 * maplibre-gl builds its web worker from its own source at runtime
 * (`'(' + modules.shared + ')(…)'` → Blob URL). Babel rewrites that prebuilt
 * file and imports @babel/runtime helpers at the top of the module; the
 * stringified worker functions then refer to names that only exist outside
 * the worker ("Uncaught ReferenceError: y is not defined" on the family map).
 * The dist file is already compiled ES2017+, so it is left untouched; Metro
 * still parses, wraps and minifies it.
 */
const MAPLIBRE_DIST = /[\\/]node_modules[\\/]maplibre-gl[\\/]dist[\\/]/;

module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['expo/internal/babel-preset'],
    // A function, because Babel also loads this config without a filename
    // (a RegExp entry fails there).
    ignore: [(filename) => typeof filename === 'string' && MAPLIBRE_DIST.test(filename)],
  };
};
