import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "bedrock/client";
import { BedrockProvider, useQuery, useMutation } from "bedrock/react";
import { AppShell, UserMenu, SignInGate, UploadButton, Button, Textarea, Icon, Panel, PanelBody, EmptyState, EmptyStateIcon, EmptyStateTitle, EmptyStateDescription } from "@bedrock/ui";
import "@bedrock/ui/styles.css";
import "./styles.css";
import type pebble from "../pebble";
import type { FileMetadata } from "bedrock";

const client = createClient<typeof pebble>();
function Notes() {
  const { data: notes, isLoading, error } = useQuery<typeof pebble>("mine", undefined);
  const { mutate, isPending } = useMutation<typeof pebble>("add");
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState<FileMetadata>();
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [theme, setTheme] = useState("dark");
  async function removeAttachment() {
    if (!attachment) return;
    try { await client.deleteFile("attachments", attachment.id); setAttachment(undefined); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : "Could not remove attachment."); }
  }
  async function add() {
    setFailure(undefined);
    try {
      await mutate({ body, ...(attachment ? { attachmentId: attachment.id } : {}) });
      setBody(""); setAttachment(undefined);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "Could not save note."); }
  }
  return <>
    <div className="notes-intro"><div><p className="notes-eyebrow">YOUR PERSONAL NOTEBOOK</p><h1>A place for little thoughts.</h1><p className="bedrock-muted">Ideas, reminders, and things worth keeping. Always in sync.</p></div>
      <Button variant="ghost" size="icon" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; setTheme(next); }}><Icon name={theme === "dark" ? "lightbulb" : "color-mode"} /></Button>
    </div>
    <Panel><PanelBody><form id="form" className="notes-form" onSubmit={event => { event.preventDefault(); void add(); }}>
      <label htmlFor="body" className="notes-label">New note</label>
      <Textarea id="body" placeholder="What's on your mind?" value={body} maxLength={10000} required disabled={isPending} onChange={event => setBody(event.target.value)} />
      <div className="notes-actions"><UploadButton<typeof pebble> bucket="attachments" disabled={isPending || !!attachment} onUploadingChange={setUploading} onUpload={setAttachment} />
        <Button type="submit" disabled={isPending || uploading || !body.trim()}><Icon name="add" />{isPending ? "Saving…" : "Save note"}</Button>
      </div>
      {attachment && <div className="notes-attachment"><Icon name="file" /><span>{attachment.name}</span><Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => void removeAttachment()}>Remove</Button></div>}
      {failure && <p role="alert" className="bedrock-error">{failure}</p>}
    </form></PanelBody></Panel>
    <section className="notes-saved" aria-labelledby="saved-title"><div className="notes-section-heading"><h2 id="saved-title">Your notes</h2><span className="notes-live"><span />Live{notes ? ` · ${notes.length}` : ""}</span></div>
      {isLoading && <p role="status" className="bedrock-muted">Loading notes…</p>}
      {error && <p role="alert" className="bedrock-error">{error.message}</p>}
      {!isLoading && !error && !notes?.length && <EmptyState><EmptyStateIcon><Icon name="notebook" size="xl" /></EmptyStateIcon><EmptyStateTitle>A fresh page</EmptyStateTitle><EmptyStateDescription>Save your first thought above. It will be here when you need it.</EmptyStateDescription></EmptyState>}
      <ul id="notes" className="notes-list">{notes?.map(note => <li key={note.id}><Panel><PanelBody><p className="notes-body">{note.body}</p><div className="notes-meta"><time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>{note.attachmentId && <a href={client.fileUrl("attachments", note.attachmentId)}><Icon name="attach" />Download attachment</a>}</div></PanelBody></Panel></li>)}</ul>
    </section>
  </>;
}
createRoot(document.getElementById("root")!).render(<BedrockProvider client={client}><AppShell name="notes" userMenu={<UserMenu client={client} />}><SignInGate client={client} name="Notes"><Notes /></SignInGate></AppShell></BedrockProvider>);
