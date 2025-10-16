const els = {
  team: document.getElementById("teamSelect"),
  session: document.getElementById("sessionSelect"),
  refresh: document.getElementById("refreshBtn"),
  createForm: document.getElementById("createSessionForm"),
  title: document.getElementById("sessionTitle"),
  date: document.getElementById("sessionDate"),
  membersContainer: document.getElementById("membersContainer"),
  tpl: document.getElementById("memberRowTpl"),
  sessionInfo: document.getElementById("sessionInfo"),
};

async function api(path, opts) {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function renderMembers(members, duesMap, attendanceMap) {
  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Nom</th>
        <th>Équipe</th>
        <th>Cotisation</th>
        <th>Présence</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  for (const m of members) {
    const row = els.tpl.content.cloneNode(true);
    row.querySelector(".name").textContent = `${m.last_name} ${m.first_name}`;
    row.querySelector(".team").textContent = m.team_name || "—";

    const paid = duesMap.get(m.id) ?? false;
    const duesCell = row.querySelector(".dues");
    const badge = document.createElement("span");
    badge.className = `badge ${paid ? "ok" : "ko"}`;
    badge.textContent = paid ? "À jour" : "À régulariser";
    duesCell.appendChild(badge);

    const present = attendanceMap.get(m.id) ?? false;
    const dot = row.querySelector(".status-dot");
    dot.className = `status-dot ${present ? "ok" : "ko"}`;

    const btnP = row.querySelector(".btn-present");
    const btnA = row.querySelector(".btn-absent");
    btnP.addEventListener("click", () => savePresence(m.id, true));
    btnA.addEventListener("click", () => savePresence(m.id, false));

    tbody.appendChild(row);
  }

  els.membersContainer.innerHTML = "";
  els.membersContainer.appendChild(table);
}

async function loadTeams() {
  const { ok, data } = await api("/api/teams");
  if (!ok) throw new Error("teams");
  els.team.innerHTML = data.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
}

async function loadSessions() {
  const team_id = els.team.value || "";
  const { ok, data } = await api(`/api/sessions${team_id ? `?team_id=${team_id}` : ""}`);
  if (!ok) throw new Error("sessions");
  els.session.innerHTML = data.map(s => `<option value="${s.id}">${new Date(s.starts_at).toLocaleString()} — ${s.title}</option>`).join("");
  updateSessionInfo();
}

function updateSessionInfo() {
  const sOpt = els.session.selectedOptions[0];
  els.sessionInfo.textContent = sOpt ? `Séance: ${sOpt.textContent}` : "";
}

async function loadMembersAndAttendance() {
  const team_id = els.team.value || "";
  const session_id = els.session.value || "";
  // members
  const mRes = await api(`/api/members${team_id ? `?team_id=${team_id}` : ""}`);
  const members = mRes.data ?? [];

  // dues
  const duesRes = await api(`/api/dues${team_id ? `?team_id=${team_id}` : ""}`);
  const duesMap = new Map(duesRes.data.map(d => [d.member_id, d.paid_this_season]));

  // attendance of session
  const attRes = session_id ? await api(`/api/attendance?session_id=${session_id}`) : { data: [] };
  const attendanceMap = new Map(attRes.data.map(a => [a.member_id, a.present]));

  renderMembers(members, duesMap, attendanceMap);
}

async function savePresence(member_id, present) {
  const session_id = els.session.value;
  if (!session_id) {
    alert("Sélectionne d'abord une séance.");
    return;
  }
  await api("/api/attendance", {
    method: "POST",
    body: { session_id, member_id, present }
  });
  await loadMembersAndAttendance();
}

async function createSession(e) {
  e.preventDefault();
  const team_id = els.team.value || null;
  const title = els.title.value?.trim() || "Entraînement";
  const starts_at = els.date.value ? new Date(els.date.value).toISOString() : null;
  if (!starts_at) return alert("Choisis une date/heure.");

  await api("/api/sessions", { method: "POST", body: { title, starts_at, team_id } });
  els.title.value = "Entraînement";
  els.date.value = "";
  await loadSessions();
  await loadMembersAndAttendance();
}

els.team.addEventListener("change", async () => {
  await loadSessions();
  await loadMembersAndAttendance();
});
els.session.addEventListener("change", async () => {
  updateSessionInfo();
  await loadMembersAndAttendance();
});
els.refresh.addEventListener("click", async () => {
  await loadSessions();
  await loadMembersAndAttendance();
});
els.createForm.addEventListener("submit", createSession);

// Init
(async function init() {
  try {
    // Valeur par défaut du champ datetime-local : maintenant
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById("sessionDate").value = now.toISOString().slice(0,16);

    await loadTeams();
    await loadSessions();
    await loadMembersAndAttendance();
  } catch (e) {
    console.error(e);
    alert("Erreur d'initialisation : " + e.message);
  }
})();
