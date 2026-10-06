import { createClient } from "bedrock/client";
const email = document.querySelector("#email");
const body = document.querySelector("#body");
const attachment = document.querySelector("#attachment");
const status = document.querySelector("#status");
const list = document.querySelector("#notes");
let client;
function refresh() {
  client?.close();
  client = createClient({ devUser: { id: email.value, email: email.value } });
  client.subscribe("mine", undefined, notes => {
    list.replaceChildren(...notes.map(note => {
      const item = document.createElement("li");
      item.textContent = note.body;
      if (note.attachmentId) {
        const link = document.createElement("a");
        link.href = client.fileUrl("attachments", note.attachmentId);
        link.textContent = " Download attachment";
        link.addEventListener("click", async event => {
          event.preventDefault();
          try {
            const response = await fetch(link.href, { headers: { "x-bedrock-user": JSON.stringify({ id: email.value, email: email.value }) } });
            if (!response.ok) throw new Error("Attachment download failed.");
            const url = URL.createObjectURL(await response.blob());
            const download = document.createElement("a"); download.href = url; download.download = "attachment"; download.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (error) { status.textContent = error.message; }
        });
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
email.addEventListener("change", refresh);
refresh();
