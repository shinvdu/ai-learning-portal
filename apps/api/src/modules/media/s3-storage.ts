/**
 * S3/MinIO media driver (F094/F097).
 *
 * Credentials stay server-side: the API signs PUT/GET URLs and either returns
 * `S3_PUBLIC_URL` (when configured) or another presigned GET as the public URL.
 * The browser never receives the access key.
 *
 * Library operations use `ListObjectsV2` (paginated), `HeadObject`, `DeleteObject`
 * and streamed `PutObject` (with an explicit `ContentLength`).
 */
import { createReadStream, promises as fs } from 'node:fs';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '@portal/config';
import { notFound } from '../../lib/errors.js';
import { isValidMediaKey } from './keys.js';
import { guessContentType } from './content-types.js';
import type { MediaObject, MediaStat, PutResult, S3MediaStorage } from './types.js';

/** Structural client so tests can inject a stub instead of a real S3Client. */
export type S3ClientLike = { send(command: unknown): Promise<unknown> };

/** Structural signer so tests can record commands without real signing. */
export type S3Presigner = (
  client: S3ClientLike,
  command: object,
  options: { expiresIn: number },
) => Promise<string>;

type S3StorageOptions = {
  env: Pick<
    Env,
    | 'S3_BUCKET'
    | 'S3_REGION'
    | 'S3_ENDPOINT'
    | 'S3_ACCESS_KEY'
    | 'S3_SECRET_KEY'
    | 'S3_FORCE_PATH_STYLE'
    | 'S3_PUBLIC_URL'
  >;
  client?: S3ClientLike;
  presign?: S3Presigner;
};

type HeadOutput = {
  ContentLength?: number;
  ContentType?: string;
  LastModified?: Date;
  $metadata?: { httpStatusCode?: number };
};

type ListOutput = {
  Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};

const defaultPresigner: S3Presigner = (client, command, options) =>
  getSignedUrl(
    client as unknown as S3Client,
    command as unknown as Parameters<typeof getSignedUrl>[1],
    options,
  );

function assertKey(key: string): void {
  if (!isValidMediaKey(key)) throw new Error(`Invalid media key: ${key}`);
}

function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key}`;
}

/** S3 surfaces a missing object either as a named error or HTTP 404. */
function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  const status =
    (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode ??
    (error as { statusCode?: unknown }).statusCode;
  return (
    name === 'NotFound' ||
    name === 'NoSuchKey' ||
    name === 'NoSuchBucket' ||
    status === 404
  );
}

export function createS3Storage(options: S3StorageOptions): S3MediaStorage {
  const { env } = options;
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error('STORAGE_DRIVER=s3 时必须设置 S3_BUCKET');

  const clientConfig: S3ClientConfig = {
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  };
  if (env.S3_ENDPOINT) clientConfig.endpoint = env.S3_ENDPOINT;
  if (env.S3_ACCESS_KEY && env.S3_SECRET_KEY) {
    clientConfig.credentials = {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    };
  }

  const client = options.client ?? new S3Client(clientConfig);
  const presign = options.presign ?? defaultPresigner;

  const presignPut = async (
    key: string,
    contentType: string,
    expiresIn: number,
  ): Promise<string> => {
    assertKey(key);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    return presign(client, command, { expiresIn });
  };

  const presignGet = async (key: string, expiresIn: number): Promise<string> => {
    assertKey(key);
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return presign(client, command, { expiresIn });
  };

  const stat = async (key: string): Promise<MediaStat> => {
    assertKey(key);
    try {
      const output = (await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      )) as HeadOutput;
      return {
        size: Number(output.ContentLength ?? 0),
        contentType: output.ContentType ?? guessContentType(key),
      };
    } catch (error) {
      if (isMissing(error)) throw notFound('媒体文件不存在');
      throw error;
    }
  };

  return {
    driver: 's3',
    presignPut,
    presignGet,
    stat,

    async putFile(key: string, filePath: string, contentType: string): Promise<PutResult> {
      assertKey(key);
      const info = await fs.stat(filePath);
      if (!info.isFile()) throw new Error(`Not a regular file: ${filePath}`);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: info.size,
          ContentType: contentType || guessContentType(key),
        }),
      );
      return { key, size: info.size };
    },

    async list(): Promise<MediaObject[]> {
      const objects: MediaObject[] = [];
      let token: string | undefined;
      do {
        const output = (await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: token,
          }),
        )) as ListOutput;
        for (const item of output.Contents ?? []) {
          if (!item.Key || !isValidMediaKey(item.Key)) continue;
          objects.push({
            key: item.Key,
            size: Number(item.Size ?? 0),
            lastModified: item.LastModified ?? new Date(0),
            contentType: guessContentType(item.Key),
          });
        }
        token = output.IsTruncated ? output.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },

    async remove(key: string): Promise<void> {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async publicUrl(key: string, expiresIn: number): Promise<string> {
      // S3_PUBLIC_URL is expected to be the bucket's public/CDN base, e.g.
      // https://media.example.com or http://127.0.0.1:9000/portal-media.
      const base = env.S3_PUBLIC_URL;
      if (base) return joinUrl(base, key);
      return presignGet(key, expiresIn);
    },
  };
}