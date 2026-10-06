import { createHmac } from "node:crypto";
import { BedrockError } from "../error";

export interface R2Credentials { account: string; bucket: string; accessKeyId: string; secretAccessKey: string }
export interface ListPage { contents?: { key: string }[]; isTruncated?: boolean; nextContinuationToken?: string }
const digest = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const hmac = (key: string | Uint8Array, value: string) => createHmac("sha256", key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const decode = (value: string) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => {
  if (entity.startsWith("#")) return String.fromCodePoint(entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[entity]!;
});

// Bun 1.2 has S3 object operations but not ListObjectsV2; keep its runtime contract.
export async function listR2(config: R2Credentials, prefix: string, continuationToken?: string, fetcher = fetch, now = new Date()): Promise<ListPage> {
  const host = `${config.account}.r2.cloudflarestorage.com`;
  const path = `/${encode(config.bucket)}`;
  const params: Record<string, string> = { "list-type": "2", prefix };
  if (continuationToken) params["continuation-token"] = continuationToken;
  const query = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encode(key)}=${encode(value)}`).join("&");
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = timestamp.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const payload = digest("");
  const headers = `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${timestamp}\n`;
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const canonical = `GET\n${path}\n${query}\n${headers}\n${signed}\n${payload}`;
  const key = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), "auto"), "s3"), "aws4_request");
  const signature = hmac(key, `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${digest(canonical)}`).toString("hex");
  let response: Response;
  try {
    response = await fetcher(`https://${host}${path}?${query}`, { headers: { "x-amz-date": timestamp, "x-amz-content-sha256": payload, authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` }, redirect: "error", signal: AbortSignal.timeout(30000) });
  } catch { throw new BedrockError("BACKUP_OFFLINE", "R2 listing is unavailable.", "Check internet access and retry the backup."); }
  if (!response.ok) throw new BedrockError("BACKUP_R2_FAILED", `R2 listing returned HTTP ${response.status}.`, "Check the account, bucket, and Object Read & Write API credentials.");
  const xml = await response.text();
  if (!/<ListBucketResult[\s>]/.test(xml)) throw new BedrockError("BACKUP_R2_FAILED", "Invalid R2 listing response.", "Check the endpoint and retry.");
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return {
    contents: [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(match => ({ key: decode(match[1]!) })),
    isTruncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    ...(next ? { nextContinuationToken: decode(next) } : {}),
  };
}
