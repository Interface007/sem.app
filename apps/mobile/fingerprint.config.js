/*
 * Settings for the runtime version (policy `fingerprint`, docs/updates.md).
 *
 * The APK (.github/workflows/android.yml) and the update in the server image
 * (apps/server/Dockerfile) must compute the same fingerprint. By default the
 * whole app config enters it, including values that change with every build
 * but do not touch native code:
 *   ExpoConfigVersions      version / android.versionCode (APP_VERSION,
 *                           ANDROID_VERSION_CODE: new with every release)
 *   ExpoConfigExtraSection  extra.gitCommit (new with every commit)
 * Without these skips no image would ever match an installed APK.
 * The default skip of @expo/fingerprint is kept (a list replaces it).
 *
 * @type {import('expo/fingerprint').Config}
 */
module.exports = {
  sourceSkips: [
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    'ExpoConfigVersions',
    'ExpoConfigExtraSection',
  ],
};
