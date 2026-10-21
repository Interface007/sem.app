import { z } from 'zod';

/** Request headers of `GET /api/updates/manifest` (Expo Updates protocol v1). */
export const UpdateRequestHeaders = z.object({
  'expo-protocol-version': z.literal('1'),
  'expo-platform': z.literal('android'),
  'expo-runtime-version': z.string().min(1),
  'expo-expect-signature': z.string().min(1).optional(),
});

export type UpdateRequestHeaders = z.infer<typeof UpdateRequestHeaders>;

/** Base64URL(SHA-256) without padding. */
const AssetHash = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const UpdateAsset = z.strictObject({
  hash: AssetHash,
  key: z.string().min(1),
  contentType: z.string().min(1),
  fileExtension: z.string().startsWith('.').optional(),
  url: z.url(),
});

export type UpdateAsset = z.infer<typeof UpdateAsset>;

/** The `manifest` part of the `multipart/mixed` response. */
export const UpdateManifest = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  runtimeVersion: z.string().min(1),
  launchAsset: UpdateAsset,
  assets: z.array(UpdateAsset),
  metadata: z.record(z.string(), z.string()),
  extra: z.record(z.string(), z.unknown()),
});

export type UpdateManifest = z.infer<typeof UpdateManifest>;

/** Subset of `metadata.json` written by `expo export` that the server reads. */
export const ExportMetadata = z.object({
  fileMetadata: z.object({
    android: z.object({
      bundle: z.string().min(1),
      assets: z.array(z.object({ path: z.string().min(1), ext: z.string() })),
    }),
  }),
});

export type ExportMetadata = z.infer<typeof ExportMetadata>;

/** Subset of `expoConfig.json` written by `expo export` that the server reads. */
export const ExportExpoConfig = z.object({
  runtimeVersion: z.string().min(1),
});

export type ExportExpoConfig = z.infer<typeof ExportExpoConfig>;
