import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateName } from "../config";
import { BedrockError } from "../error";

export async function init(name: string, cwd = process.cwd(), template = "default", inPlace = false, checkout?: string) {
  if (!["default", "minimal", "react"].includes(template)) throw new BedrockError("INVALID_TEMPLATE", `Unknown template: ${template}`, "Use --template react, or omit --template for the default.");
  validateName(name);
  const dir = inPlace ? resolve(cwd) : resolve(cwd, name);
  const files: Record<string, string> = {
    "pebble.ts": `import { definePebble, query } from "bedrock";

export default definePebble({
  name: "${name}",
  access: "public",
  queries: { hello: query(() => ({ message: "Hello from ${name}!" })) },
  web: "./web/index.html",
});
`,
    "web/index.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head>
<body><h1>${name}</h1><p id="message"></p><script type="module">
const response = await fetch("/_bedrock/q/hello", { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
const result = await response.json();
document.querySelector("#message").textContent = result.ok ? result.value.message : result.error.message;
</script></body></html>
`,
    "package.json": JSON.stringify({ name, private: true, type: "module", scripts: { dev: "bedrock dev", typecheck: "tsc --noEmit" }, dependencies: { bedrock: "^0.1.0" }, devDependencies: { "@types/bun": "^1.3.10", typescript: "^5.9.3" } }, null, 2) + "\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, types: ["bun"] } }, null, 2) + "\n",
    "AGENTS.md": `# ${name}

pebble.ts is the source of truth. Use bedrock query/mutation and Standard Schema for arguments.
Functions receive { db, user, pebble, storage, request, invalidate }. Queries are read-only.
For a registered items table with epoch-millisecond expiresAt, use ctx.db.delete(items).where(lt(items.expiresAt, Date.now())).run() (import lt from bedrock).
Writes through ctx.db in mutations, jobs, and routes are tracked automatically for sync after commit.
invalidate is only needed for raw SQL via $client or writes outside bedrock; notify from a mutation, job, or route.
Prefer ctx.invalidate([items]) with registered Drizzle tables; SQL names like ctx.invalidate(["items"]) also work.
Export Drizzle tables from pebble.ts. Run bedrock db generate after schema changes.
Run bedrock db plan to inspect pending SQL; bedrock db migrate applies it.
Run bun install, then bun run dev. Data lives in .bedrock/; never commit it.
Read node_modules/bedrock/AGENTS.md and node_modules/bedrock/llms.txt for the complete API, jobs, plugins, auth, storage, sync, client/react, and @bedrock/ui.
All CLI commands support --json. Never open real ~/.bedrock in tests.
`,
    ".gitignore": "node_modules/\n.bedrock/\n",
  };
  if (template === "react") Object.assign(files, reactTemplate(name));
  if (checkout) {
    const pkg = JSON.parse(files["package.json"]!);
    pkg.dependencies.bedrock = `file:${join(checkout, "packages/bedrock").replaceAll("\\", "/")}`;
    if (pkg.dependencies["@bedrock/ui"]) pkg.dependencies["@bedrock/ui"] = `file:${join(checkout, "packages/ui").replaceAll("\\", "/")}`;
    files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  }
  let entries: string[];
  try { entries = await readdir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    entries = [];
  }
  if (entries.length) {
    if (await Bun.file(join(dir, "pebble.ts")).text().catch(() => "") === files["pebble.ts"] &&
        await Bun.file(join(dir, "package.json")).text().catch(() => "") === files["package.json"]) {
      return { name, dir, created: false };
    }
    throw new BedrockError("DIRECTORY_EXISTS", `Directory already contains files: ${dir}`, "Choose a new name or use the existing pebble; init never overwrites files.");
  }
  await mkdir(join(dir, "web"), { recursive: true });
  for (const [path, contents] of Object.entries(files)) await Bun.write(join(dir, path), contents);
  return { name, dir, created: true };
}

function reactTemplate(name: string): Record<string, string> {
  return {
    "pebble.ts": `import { definePebble, query, mutation, bucket, sqliteTable, text, eq, desc, integer } from "bedrock";
import * as v from "valibot";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull(),
  body: text("body").notNull(),
  attachmentId: text("attachment_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const attachments = bucket("attachments", { maxSize: "50mb", access: "owner" });
export default definePebble({
  name: "${name}", access: "users", sync: true, schema: { notes }, storage: [attachments],
  queries: { mine: query(({ db, user }) => db.select().from(notes).where(eq(notes.ownerId, user!.id)).orderBy(desc(notes.createdAt))) },
  mutations: { add: mutation(v.object({ body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(10000)), attachmentId: v.optional(v.string()) }), async ({ db, user, storage }, { body, attachmentId }) => {
    if (attachmentId) await storage.get(attachments, attachmentId);
    return db.insert(notes).values({ ownerId: user!.id, body, attachmentId: attachmentId ?? null }).returning();
  }) },
  web: "./web/index.html",
});
`,
    "web/index.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head>
<body><div id="root"></div><script type="module" src="./app.tsx"></script></body></html>
`,
    "web/app.tsx": `import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "bedrock/client";
import { BedrockProvider, useQuery, useMutation } from "bedrock/react";
import { AppShell, UserMenu, SignInGate, UploadButton, Button, Textarea, Panel, PanelBody } from "@bedrock/ui";
import "@bedrock/ui/styles.css";
import type pebble from "../pebble";

const client = createClient<typeof pebble>();
function Notes() {
  const { data, isLoading, error } = useQuery<typeof pebble>("mine", undefined);
  const { mutate, isPending } = useMutation<typeof pebble>("add");
  const [body, setBody] = useState("");
  const [attachmentId, setAttachmentId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string>();
  return <>
    <h1 style={{ fontSize: 28, marginBottom: 24 }}>Your notes</h1>
    <Panel><PanelBody><form style={{ display: "grid", gap: 16 }} onSubmit={async event => {
      event.preventDefault(); setFailure(undefined);
      try { await mutate({ body, ...(attachmentId ? { attachmentId } : {}) }); setBody(""); setAttachmentId(undefined); }
      catch (cause) { setFailure(cause instanceof Error ? cause.message : "Could not save note."); }
    }}>
      <label htmlFor="body">New note</label>
      <Textarea id="body" value={body} required maxLength={10000} disabled={isPending} onChange={event => setBody(event.target.value)} placeholder="What's on your mind?" />
      <UploadButton<typeof pebble> bucket="attachments" disabled={isPending || !!attachmentId} onUploadingChange={setUploading} onUpload={file => setAttachmentId(file.id)} />
      {attachmentId && <p>Attachment ready.</p>}
      <Button disabled={isPending || uploading || !body.trim()}>{isPending ? "Saving…" : "Save note"}</Button>
      {failure && <p role="alert">{failure}</p>}
    </form></PanelBody></Panel>
    {isLoading && <p role="status">Loading notes…</p>}
    {error && <p role="alert">{error.message}</p>}
    {!isLoading && !error && !data?.length && <p style={{ marginTop: 24 }}>No notes yet. Save your first thought above.</p>}
    <ul style={{ display: "grid", gap: 16, marginTop: 24, listStyle: "none" }}>{data?.map(note => <li key={note.id}><Panel><PanelBody><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note.body}</p>{note.attachmentId && <a href={client.fileUrl("attachments", note.attachmentId)}>Download attachment</a>}</PanelBody></Panel></li>)}</ul>
  </>;
}
createRoot(document.getElementById("root")!).render(<BedrockProvider client={client}><AppShell name="${name}" userMenu={<UserMenu client={client} />}><SignInGate client={client}><Notes /></SignInGate></AppShell></BedrockProvider>);
`,
    "package.json": JSON.stringify({ name, private: true, type: "module", scripts: { dev: "bedrock dev", typecheck: "tsc --noEmit" }, dependencies: { bedrock: "^0.1.0", "@bedrock/ui": "^0.1.0", react: "^19.0.0", "react-dom": "^19.0.0", valibot: "^1.5.0" }, devDependencies: { "drizzle-kit": "^0.31.9", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@types/bun": "^1.3.10", typescript: "^5.9.3" } }, null, 2) + "\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "Bundler", jsx: "react-jsx", strict: true, noEmit: true, skipLibCheck: true, types: ["bun"] } }, null, 2) + "\n",
    "AGENTS.md": `# ${name}

pebble.ts owns the schema, auth, queries, mutations, and attachment bucket.
Use Drizzle for writes: ctx.db.delete(notes).where(lt(notes.createdAt, new Date(Date.now() - 30 * 86400000))).run() (import lt from bedrock).
Writes through ctx.db in mutations, jobs, and routes are tracked automatically for sync after commit.
invalidate is only needed for raw SQL via $client or writes outside bedrock; notify from a mutation, job, or route.
Prefer ctx.invalidate([notes]) with registered Drizzle tables; SQL names like ctx.invalidate(["notes"]) also work.
web/app.tsx is a Bun HTML-bundled React app. Import @bedrock/ui/styles.css once.
Run bun install, bunx bedrock db generate, then bun run dev. Dev login needs no Google credentials.
Hooks run inside BedrockProvider. useQuery subscribes live; writes use useMutation.
UploadButton uploads immediately; keep the attachment id for the next mutation.
Use document.documentElement.dataset.theme = "light" or "dark" to change Onyx tokens.
Read node_modules/bedrock/AGENTS.md and node_modules/bedrock/llms.txt for the full author API and common mistakes.
Run bun run typecheck and bedrock db plan before deploying. Never commit .bedrock/.
`,
  };
}
