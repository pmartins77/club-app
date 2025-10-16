const out = document.getElementById("out");
document.getElementById("btn-hello").addEventListener("click", async () => {
  out.textContent = "Chargement...";
  const r = await fetch("/api/hello");
  out.textContent = JSON.stringify(await r.json(), null, 2);
});
document.getElementById("btn-members").addEventListener("click", async () => {
  out.textContent = "Chargement...";
  const r = await fetch("/api/members");
  out.textContent = JSON.stringify(await r.json(), null, 2);
});
