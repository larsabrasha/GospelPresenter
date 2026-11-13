import { AwsClient } from 'aws4fetch';
import type { ObjectStore } from './media.ts';

// 1.x's object storage, Garage, through its S3 API: path-style addresses, region `garage` (docker-compose.yml).

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export function s3Store(c: S3Config): ObjectStore {
  const client = new AwsClient({ accessKeyId: c.accessKey, secretAccessKey: c.secretKey, region: c.region, service: 's3' });
  const base = `${c.endpoint.replace(/\/$/, '')}/${encodeURIComponent(c.bucket)}`;
  return {
    async get(key) {
      const res = await client.fetch(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${key}: ${res.status} ${await res.text()}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
