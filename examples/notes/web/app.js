import { createClient } from "bedrock/client";
const account = document.querySelector("#account");
const body = document.querySelector("#body");
const attachment = document.querySelector("#attachment");
const status = document.querySelector("#status");
const list = document.querySelector("#notes");
const client = createClient();
function refresh() {
  client.subscribe("mine", undefined, notes => {
    list.replaceChildren(...notes.map(note => {
      const item = document.createElement("li");
      item.textContent = note.body;
      if (note.attachmentId) {
        const link = document.createElement("a");
        link.href = client.fileUrl("attachments", note.attachmentId);
        link.textContent = " Download attachment";
        item.append(link);
      }
      return item;
    }));
    status.textContent = notes.length ? "" : "No notes yet.";
  }, error => { status.textContent = error.message; });
}
document.querySelector("#form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const file = attachment.files[0];
    const uploaded = file ? await client.upload("attachments", file, { onProgress: progress => { status.textContent = `Uploading ${Math.round(progress * 100)}%`; } }) : undefined;
    try { await client.mutate("add", { body: body.value, attachmentId: uploaded?.id }); }
    catch (error) { if (uploaded) await client.deleteFile("attachments", uploaded.id); throw error; }
    body.value = ""; attachment.value = "";
  }
  catch (error) { status.textContent = error.message; }
});
client.user().then(user => { account.textContent = user?.email ?? ""; });
document.querySelector("#logout").addEventListener("click", async () => { await client.logout(); location.reload(); });
refresh();
