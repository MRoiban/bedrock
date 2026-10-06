# Storage

Declare standalone buckets like Drizzle tables and register them in an array.
All handlers receive the same `ctx.storage` API; pass the bucket object first.
Functions keep exactly `query(fn) | query(schema, fn)` and
`mutation(fn) | mutation(schema, fn)`; no storage binding is needed.

```ts
export const attachments = bucket('attachments', { maxSize: '50mb', access: 'owner' });
export default definePebble({
  name: 'notes', storage: [attachments],
  queries: { files: query(({ storage }) => storage.list(attachments)) },
  mutations: {
    add: mutation(async ({ storage }) =>
      storage.put(attachments, new Blob(['hello']), { name: 'hello.txt', mime: 'text/plain' })),
  },
});
```

Names use `[a-z0-9_-]{1,32}` and must be unique within a pebble. `bucket()`
and `definePebble()` validate names, sizes, access policies, and MIME patterns.
Unregistered bucket objects (even a different object with the same name) throw
`BedrockError("UNKNOWN_BUCKET", …, hint)`; register the exact object used by handlers.

Methods: `storage.put(bucket, blobOrStream, { name, mime? })` returns FileMetadata;
`storage.get(bucket, id)` returns a Blob; `storage.delete(bucket, id)` removes
metadata transactionally and then the blob; `storage.list(bucket, { ownerId?,
limit?, cursor? })` returns visible metadata. With `access: 'owner'`, calling
`await storage.get(attachments, attachmentId)` before linking an attachment
verifies it belongs to the current user (as shown in examples/notes).
The cursor is the last returned id; ordering is ascending id. Limit defaults to
100 and is capped at 1,000. Sizes use binary units (1 MB = 1,048,576 bytes).
Streams default to application/octet-stream; Blobs use their type if supplied.
Storage writes require a mutation. Failed transactions remove their new blobs.

HTTP protocol (raw file bodies, no multipart envelope):

- `POST /_bedrock/files/<bucket>`: Content-Type supplies MIME;
  x-bedrock-file-name supplies a percent-encoded filename. Returns metadata (201).
  Single uploads are capped at 90 MiB while streaming.
- `POST /_bedrock/files/<bucket>/uploads`: JSON `{ name, mime?, size, sha256 }`.
  sha256 is the lowercase hex digest. Returns `{ uploadId, chunkSize }` (201).
- `PUT /_bedrock/files/<bucket>/uploads/<uploadId>/<n>`: raw chunk (204).
  Zero-based, 32 MiB chunks, except the final chunk. Exact lengths are required.
  Repeating a chunk replaces it atomically; a failed retry preserves the old chunk.
- `POST /_bedrock/files/<bucket>/uploads/<uploadId>/complete`: no body.
  Assembles in order and verifies declared size and digest before commit (201).
- `GET` / `HEAD /_bedrock/files/<bucket>/<id>`: access-checked downloads;
  one byte range, suffix ranges, ETag, If-None-Match, and If-Range are supported.
- `DELETE /_bedrock/files/<bucket>/<id>`: owner or custom access function (204).

Chunk manifests and chunks survive restarts. They expire 24 hours after creation;
cleanup runs at startup, hourly, and before chunk requests. Chunk state is bound
to bucket and user id. Anonymous public uploads use the unguessable upload id as
a bearer capability. Completing an already completed upload returns 404.

All access checks run inside the function executor with resolveUser identity and
pebble-level authorization. Public uploads may be anonymous; protected uploads
require identity. Custom policies receive the candidate metadata during upload.
Public cache headers are emitted only for the literal public policy. Uploaded
HTML/SVG always download as attachments. All downloads receive nosniff and CSP
sandbox; only a small explicit MIME allowlist is eligible for inline serving.

`client.upload(bucket, file, { onProgress?, signal? })` selects single or chunked
transport. Progress is a fraction from 0 to 1, reported at transport boundaries
(single upload: start/end; chunked upload: completed chunks). Chunks are sent
sequentially and retried up to three attempts. Aborting leaves chunk state to
expire. Web Crypto computes the client digest from a full ArrayBuffer, so large
browser uploads need memory proportional to file size. The server always streams.
`client.fileUrl(bucket, id)` and `client.deleteFile(bucket, id)` use names inferred from the pebble storage array. Client APIs accept names only,
so browser code need not import server bucket configurations.
`useUpload<typeof pebble>(bucket)` exposes upload, progress, isUploading, error.

Blob creation and database commit are not crash-atomic: a process crash between
rename and commit can leave an orphan blob. Failed post-commit deletion is logged;
metadata stays committed. No crash-orphan reconciliation or cross-call resumable
SDK upload handle is implemented. HTTP callers can resume via their saved uploadId.
