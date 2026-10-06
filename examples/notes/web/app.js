import { createClient } from "bedrock/client";
const account = document.querySelector("#account");
const body = document.querySelector("#body");
const status = document.querySelector("#status");
const list = document.querySelector("#notes");
const client = createClient();
function refresh() {
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
client.user().then(user => { account.textContent = user?.email ?? ""; });
document.querySelector("#logout").addEventListener("click", async () => { await client.logout(); location.reload(); });
refresh();
