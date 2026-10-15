import { type ConfigPlugin, withAppBuildGradle } from 'expo/config-plugins';

/*
 * Signs release builds with the fixed release key when the environment
 * provides it (CI: secrets ANDROID_KEYSTORE_*), otherwise with the debug key
 * as Expo's template does. Without a fixed key no update could be installed
 * over an existing version.
 */

const MARKER = '// sem: release signing';

const RELEASE_SIGNING_CONFIG = `
        ${MARKER}
        release {
            if (System.getenv('ANDROID_KEYSTORE_PATH')) {
                storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`;

const RELEASE_SIGNING_SELECTION =
  "signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug";

/** Adds the release signing config to the contents of android/app/build.gradle. */
export function addReleaseSigning(gradle: string): string {
  if (gradle.includes(MARKER)) return gradle;

  const signingConfigs = /signingConfigs\s*\{/;
  if (!signingConfigs.test(gradle)) {
    throw new Error('release-signing: no signingConfigs block in app/build.gradle');
  }
  let result = gradle.replace(signingConfigs, (match) => match + RELEASE_SIGNING_CONFIG);

  const releaseDebugSigning = /(release\s*\{[^{}]*?)signingConfig signingConfigs\.debug/;
  if (!releaseDebugSigning.test(result)) {
    throw new Error('release-signing: release build type does not use the debug signing config');
  }
  result = result.replace(releaseDebugSigning, `$1${RELEASE_SIGNING_SELECTION}`);
  return result;
}

export const withReleaseSigning: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('release-signing: only the Groovy build.gradle is supported');
    }
    mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
    return mod;
  });
