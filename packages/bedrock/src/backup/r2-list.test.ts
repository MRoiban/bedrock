import { expect, test } from "bun:test";
import { listR2 } from "./r2-list";
import { r2Target } from "./target";

const config = { account: "a".repeat(32), bucket: "bedrock-backups", accessKeyId: "test-id", secretAccessKey: "test-secret" };

test("Bun 1.2 R2 listing fallback signs the request, parses escaped keys and continuation tokens", async () => {
  let observed!: Request;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    observed = new Request(url, init);
    return new Response('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Contents><Key>files/a&amp;b&lt;c&gt;</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;token</NextContinuationToken></ListBucketResult>');
  }) as typeof fetch;
  const page = await listR2(config, "pebbles/notes/", "a+b", fetcher, new Date("2026-10-06T03:00:00Z"));
  expect(page.contents).toEqual([{ key: "files/a&b<c>" }]);
  expect(page.nextContinuationToken).toBe("next&token");
  expect(page.isTruncated).toBe(true);
  expect(observed.url).toBe(`https://${config.account}.r2.cloudflarestorage.com/bedrock-backups?continuation-token=a%2Bb&list-type=2&prefix=pebbles%2Fnotes%2F`);
  expect(observed.headers.get("x-amz-date")).toBe("20261006T030000Z");
  expect(observed.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-id\/20261006\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
  expect(observed.headers.get("authorization")).not.toContain(config.secretAccessKey);
});

test("R2 target follows native listing pagination and rejects nonadvancing truncated pages", async () => {
  const seen: Bun.S3ListObjectsOptions[] = [];
  const client = {
    write: async () => 0,
    file: (() => { throw new Error("unexpected file I/O"); }) as Bun.S3Client["file"],
    exists: async () => false,
    delete: async () => {},
    list: async (options: Bun.S3ListObjectsOptions) => {
      seen.push(options);
      return options.continuationToken ? { contents: [{ key: "prefix/b" }], isTruncated: false } : { contents: [{ key: "prefix/a" }], isTruncated: true, nextContinuationToken: "next" };
    },
  };
  expect(await r2Target(config, client).list("prefix/")).toEqual(["prefix/a", "prefix/b"]);
  expect(seen).toEqual([{ prefix: "prefix/" }, { prefix: "prefix/", continuationToken: "next" }]);
  await expect(r2Target(config, { ...client, list: async () => ({ isTruncated: true }) }).list("prefix/")).rejects.toMatchObject({ code: "BACKUP_R2_FAILED" });
});

test("R2 listing errors never reflect the credentials or response body", async () => {
  const fetcher = (async () => new Response(config.secretAccessKey, { status: 403 })) as unknown as typeof fetch;
  await expect(listR2(config, "", undefined, fetcher)).rejects.toMatchObject({ code: "BACKUP_R2_FAILED", message: "R2 listing returned HTTP 403." });
});
