import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ExportExpoConfig,
  ExportMetadata,
  UpdateRequestHeaders,
  type UpdateAsset,
  type UpdateManifest,
} from '@sem/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface UpdateOptions {
  /** Output folder of `expo export`. */
  dir: string | undefined;
  /** PEM file with the signing key. */
  privateKeyPath: string | undefined;
  /** Public base URL for asset URLs; derived from the request if unset. */
  baseUrl: string | undefined;
}

const MANIFEST_PATH = '/api/updates/manifest';
const ASSETS_PREFIX = '/api/updates/assets/';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  json: 'application/json',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

const base64Url = (buffer: Buffer): string => buffer.toString('base64url');

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function toUrl(base: string, relativePath: string): string {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return `${base.replace(/\/+$/, '')}${ASSETS_PREFIX}${encoded}`;
}

/** Resolves `relative` inside `root`; undefined if it escapes (also via symlinks). */
async function resolveInside(root: string, relative: string): Promise<string | undefined> {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relative);
  if (!candidate.startsWith(absoluteRoot + path.sep)) return undefined;
  try {
    const real = await realpath(candidate);
    const realRoot = await realpath(absoluteRoot);
    return real.startsWith(realRoot + path.sep) ? real : undefined;
  } catch {
    return undefined;
  }
}

async function describeAsset(
  dir: string,
  relativePath: string,
  base: string,
  contentType: string,
  extension: string | undefined,
): Promise<UpdateAsset | undefined> {
  const file = await resolveInside(dir, relativePath);
  if (!file) return undefined;
  const content = await readFile(file);
  const hash = createHash('sha256').update(content).digest();
  return {
    hash: base64Url(hash),
    key: hash.toString('hex'),
    contentType,
    ...(extension ? { fileExtension: `.${extension}` } : {}),
    url: toUrl(base, relativePath),
  };
}

/** Deterministic UUID (version 5 layout) from the asset hashes: same export, same id. */
function updateId(assets: (UpdateAsset | undefined)[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(assets.map((a) => a?.hash)))
    .digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString('hex', 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Builds the manifest of the export in `dir`; undefined if there is none. */
async function buildManifest(dir: string, base: string): Promise<UpdateManifest | undefined> {
  const metadata = ExportMetadata.safeParse(await readJson(path.join(dir, 'metadata.json')));
  const expoConfig = ExportExpoConfig.safeParse(await readJson(path.join(dir, 'expoConfig.json')));
  if (!metadata.success || !expoConfig.success) return undefined;

  const { bundle, assets } = metadata.data.fileMetadata.android;
  const launchAsset = await describeAsset(dir, bundle, base, 'application/javascript', undefined);
  if (!launchAsset) return undefined;
  const described = await Promise.all(
    assets.map((a) =>
      describeAsset(
        dir,
        a.path,
        base,
        CONTENT_TYPES[a.ext.toLowerCase()] ?? 'application/octet-stream',
        a.ext || undefined,
      ),
    ),
  );
  if (described.some((a) => a === undefined)) return undefined;

  return {
    id: updateId([launchAsset, ...described]),
    createdAt: (await stat(path.join(dir, 'metadata.json'))).mtime.toISOString(),
    runtimeVersion: expoConfig.data.runtimeVersion,
    launchAsset,
    assets: described.filter((a): a is UpdateAsset => a !== undefined),
    metadata: {},
    extra: {},
  };
}

function baseUrlOf(request: FastifyRequest, configured: string | undefined): string {
  return configured ?? `${request.protocol}://${request.headers.host ?? request.hostname}`;
}

export function registerUpdateRoutes(app: FastifyInstance, options: UpdateOptions): void {
  app.get(MANIFEST_PATH, async (request, reply) => {
    const headers = UpdateRequestHeaders.safeParse(request.headers);
    if (!headers.success) {
      return reply.code(400).send({ error: 'Invalid update request headers' });
    }
    // Never answer without a key: an unsigned manifest must not reach the app.
    if (!options.dir || !options.privateKeyPath) return reply.code(204).send();

    let key;
    try {
      key = createPrivateKey(await readFile(options.privateKeyPath));
    } catch {
      request.log.warn('update signing key missing or unreadable; serving no update');
      return reply.code(204).send();
    }

    const manifest = await buildManifest(options.dir, baseUrlOf(request, options.baseUrl));
    if (!manifest || manifest.runtimeVersion !== headers.data['expo-runtime-version']) {
      return reply.code(204).send();
    }

    const manifestJson = JSON.stringify(manifest);
    const signature = sign('sha256', Buffer.from(manifestJson), key).toString('base64');
    const boundary = `sem-${randomUUID()}`;
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="manifest"\r\n' +
      'Content-Type: application/json; charset=utf-8\r\n' +
      `expo-signature: sig="${signature}", keyid="main", alg="rsa-v1_5-sha256"\r\n` +
      `\r\n${manifestJson}\r\n--${boundary}--\r\n`;

    return reply
      .code(200)
      .header('content-type', `multipart/mixed; boundary=${boundary}`)
      .header('expo-protocol-version', '1')
      .header('expo-sfv-version', '0')
      .header('cache-control', 'private, max-age=0')
      .send(body);
  });

  app.get<{ Params: { '*': string } }>(`${ASSETS_PREFIX}*`, async (request, reply) => {
    const relative = request.params['*'];
    const file =
      options.dir && relative && !relative.includes('\0')
        ? await resolveInside(options.dir, relative)
        : undefined;
    if (!file || !(await stat(file)).isFile()) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    return reply
      .code(200)
      .header('content-type', 'application/octet-stream')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(createReadStream(file));
  });
}
