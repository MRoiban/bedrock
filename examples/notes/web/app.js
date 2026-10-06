import { createClient } from "bedrock/client";
const email = document.querySelector("#email");
const body = document.querySelector("#body");
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
      return item;
    }));
    status.textContent = notes.length ? "" : "No notes yet.";
  }, error => { status.textContent = error.message; });
}
document.querySelector("#form").addEventListener("submit", async event => {
  event.preventDefault();
  try { await client.mutate("add", { body: body.value }); body.value = ""; }
  catch (error) { status.textContent = error.message; }
});
email.addEventListener("change", refresh);
refresh();
