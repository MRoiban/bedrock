const email = document.querySelector("#email");
const body = document.querySelector("#body");
const status = document.querySelector("#status");
const list = document.querySelector("#notes");
async function call(kind, name, args) {
  const response = await fetch(`/_bedrock/${kind}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bedrock-user": JSON.stringify({ id: email.value, email: email.value }) },
    body: JSON.stringify(args),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error.message + " " + result.error.hint);
  return result.value;
}
async function refresh() {
  try {
    const notes = await call("q", "mine", null);
    list.replaceChildren(...notes.map(note => {
      const item = document.createElement("li");
      item.textContent = note.body;
      return item;
    }));
    status.textContent = notes.length ? "" : "No notes yet.";
  } catch (error) { status.textContent = error.message; }
}
document.querySelector("#form").addEventListener("submit", async event => {
  event.preventDefault();
  try { await call("m", "add", { body: body.value }); body.value = ""; await refresh(); }
  catch (error) { status.textContent = error.message; }
});
email.addEventListener("change", refresh);
refresh();
