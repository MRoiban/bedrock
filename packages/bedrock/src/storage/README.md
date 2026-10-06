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
and `definePebble()` validate names, sizes, access policies, MIME patterns, and hook functions.
Unregistered bucket objects (even a different object with the same name) throw
`BedrockError("UNKNOWN_BUCKET", …, hint)`; register the exact object used by handlers.

Methods: `storage.put(bucket, blobOrStream, { name, mime?, meta? })` returns FileMetadata;
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
  x-bedrock-file-name supplies a percent-encoded filename; optional
  x-bedrock-file-meta supplies percent-encoded JSON (max 4 KiB encoded). Returns metadata (201).
  Single uploads are capped at 90 MiB while streaming.
- `POST /_bedrock/files/<bucket>/uploads`: JSON `{ name, mime?, size, sha256?, meta? }`.
  sha256 is an optional lowercase hex digest. Returns `{ uploadId, chunkSize }` (201).
- `PUT /_bedrock/files/<bucket>/uploads/<uploadId>/<n>`: raw chunk (204).
  Zero-based, 32 MiB chunks, except the final chunk. Exact lengths are required.
  Repeating a chunk replaces it atomically; a failed retry preserves the old chunk.
- `GET /_bedrock/files/<bucket>/uploads/<uploadId>`: upload status with complete chunk indexes.
- `POST /_bedrock/files/<bucket>/uploads/<uploadId>/complete`: no body or `{ sha256 }`.
  Assembles in order and verifies declared size and any digests before commit (201).
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


`client.upload(bucket, file, { onProgress?, signal?, meta?, uploadId?, onUploadId? })`
uses XHR byte-level progress in browsers and fetch transport-boundary progress in
Bun. Progress is a 0–1 fraction across the file. Chunks remain sequential with up
to three attempts; FORBIDDEN, UNAUTHENTICATED, INVALID_CHUNK, FILE_TOO_LARGE and
QUOTA_EXCEEDED are never retried. SHA-256 is incremental: the client reads one
chunk at a time and sends the digest at completion, without a whole-file memory
allocation or hashing pre-pass. Cookies and abort signals work on both transports.
Save `onUploadId(id)` to resume later with `uploadId` and the original local File.
Resume checks status, hashes received chunks locally without re-sending them,
and sends missing chunks. An expired handle starts a fresh upload. `useUpload`
passes all these options through and keeps its existing return shape.
`client.fileUrl(bucket, id)` and `client.deleteFile(bucket, id)` use names inferred from the pebble storage array. Client APIs accept names only,
so browser code need not import server bucket configurations.
`useUpload<typeof pebble>(bucket)` exposes upload, progress, isUploading, error.

Blob creation and database commit are not crash-atomic: a process crash between
rename and commit can leave an orphan blob. Failed post-commit deletion is logged;
metadata stays committed. Crash-orphan reconciliation is not implemented.

Bucket hooks receive `FunctionContext`. `admit(ctx, candidate)` runs before bytes
are accepted, with `{ bucket, name, mime, size, ownerId, meta }`; `size` is the
declared size or `null`. It runs again with the final size inside the commit write
transaction, before inserting `_bedrock_files`. **The commit-time check is
authoritative and serialized in the single-writer queue**, so a `SUM(size)` query
can enforce quotas without races. Keep hooks short; never perform network I/O in
an executor slot. `onStored(ctx, file, meta)` runs immediately after the file
metadata insert in that same transaction. Throwing rolls back app rows, metadata,
and the new blob. `BedrockError` is exported from `bedrock`; its code, message,
and hint pass through to clients.

For example, with an app-defined `used(db, ownerId)` performing `SUM(size)`,
`QUOTA`, and a registered `assetRows` table:

```ts
import { bucket, BedrockError } from "bedrock";
export const assets = bucket("assets", {
  maxSize: "2gb", access: "owner",
  admit: ({ db, user }, file) => {
    if (file.size !== null && used(db, user!.id) + file.size > QUOTA)
      throw new BedrockError("QUOTA_EXCEEDED", "Your safe is full.", "Delete files or ask for more space.");
  },
  onStored: ({ db }, file, meta) => {
    db.insert(assetRows).values({ fileId: file.id, ownerId: file.ownerId, size: file.size }).run();
  },
});
```

Upload `meta` is untrusted JSON: apps must validate it in `admit`/`onStored`
before using it. It is passed to hooks and persisted in chunk manifests, never
stored in `_bedrock_files`. Single uploads send percent-encoded JSON in
`x-bedrock-file-meta`; chunk start sends a `meta` JSON field. Both are limited to
4 KiB after percent encoding. Server puts accept `{ name, mime?, meta? }` and run
both hooks too. Their Blob/stream work stays inside the caller's transaction;
server code is trusted to avoid slow network streams there.

HTTP upload bodies stream into `data/uploads/staging/<uuid>` outside executor
slots. Single uploads use a short read slot for authorization/admission, stream
with a cap of min(bucket maxSize, 90 MiB), then use a short write slot to re-check
access/admission, rename the staged file into place, insert metadata, and run
`onStored`. Chunk assembly and hashing also happen outside slots. Each upload id
has its own serialization lock; different uploads can stream concurrently.
Staging is deleted on controlled failures/disconnects and stale staging (>24 h)
is cleaned at startup and hourly. Sync invalidation fires only after commit.

Chunk protocol: `POST .../uploads` with `{ name, mime?, size, sha256?, meta? }`
returns `{ uploadId, chunkSize }`. `PUT .../uploads/<uid>/<n>` sends sequential
32 MiB chunks (last may be shorter); replacement is atomic. `GET .../uploads/<uid>`
returns `{ uploadId, size, chunkSize, received: number[] }`, listing only complete
chunks, with the same user/bucket authorization. `POST .../uploads/<uid>/complete`
accepts no body or `{ sha256 }`. Digests are lowercase hex SHA-256; if declared at
start or completion, each must match the assembled bytes or completion throws
`UPLOAD_CHECKSUM_MISMATCH`. Size is always verified. Upload state expires after
24 hours and survives restarts.
