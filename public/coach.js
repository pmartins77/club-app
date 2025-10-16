// public/coach.js

const els = {
  team: document.getElementById("teamSelect"),
  day: document.getElementById("daySelect"),
  session: document.getElementById("sessionSelect"),
  refresh: document.getElementById("refreshBtn"),
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
  if (!r.ok) {
    let msg = `${path}: ${r.status}`;
    try { const j = await r.json(); if (j?.error) msg += ` – ${j.error}`; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

/* ---------- Rendu membres ---------- */
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

    const paid = new Map(duesMap).get(m.id) ?? false;
    const duesCell = row.querySelector(".dues");
    const badge = document.createElement("span");
    badge.className = `badge ${paid ? "ok" : "ko"}`;
    badge.textContent = paid ? "À jour" : "À régulariser";
    duesCell.appendChild(badge);

    const present = new Map(attendanceMap).get(m.id) ?? false;
    const dot = row.querySelector(".status-dot");
    dot.className = `status-dot ${present ? "ok" : "ko"}`;

    row.querySelector(".btn-present").addEventListener("click", () => savePresence(m.id, true));
    row.querySelector(".btn-absent").addEventListener("click", () => savePresence(m.id, false));

    tbody.appendChild(row);
  }

  els.membersContainer.innerHTML = "";
  els.membersContainer.appendChild(table);
}

/* ---------- Chargements ---------- */
async function loadTeams() {
  const { ok, data } = await api("/api/teams");
  if (!ok) throw new Error("teams");
  els.team.innerHTML = data.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
}

async function loadSessions() {
  const team_id = els.team.value || "";
  const day = els.day.value; // yyyy-mm-dd
  const qTeam = team_id ? `&team_id=${encodeURIComponent(team_id)}` : "";
  const qDay = day ? `&date=${encodeURIComponent(day)}` : "";
  const { ok, data } = await api(`/api/sessions?days_ahead=0${qTeam}${qDay}`);
  if (!ok) throw new Error("sessions");
  els.session.innerHTML = data
    .map(s => `<option value="${s.id}">${new Date(s.starts_at).toLocaleString()} — ${s.title}</option>`)
    .join("");
  updateSessionInfo();
}

function updateSessionInfo() {
  const sOpt = els.session.selectedOptions[0];
  els.sessionInfo.textContent = sOpt ? `Séance: ${sOpt.textContent}` : "";
}

async function loadMembersAndAttendance() {
  const team_id = els.team.value || "";
  const session_id = els.session.value || "";

  // membres
  const mRes = await api(`/api/members${team_id ? `?team_id=${team_id}` : ""}`);
  const members = mRes.data ?? [];

  // cotisations
  const duesRes = await api(`/api/dues${team_id ? `?team_id=${team_id}` : ""}`);
  const duesMap = new Map(duesRes.data.map(d => [d.member_id, d.paid_this_season]));

  // présence pour la séance sélectionnée
  const attRes = session_id ? await api(`/api/attendance?session_id=${session_id}`) : { data: [] };
  const attendanceMap = new Map(attRes.data.map(a => [a.member_id, a.present]));

  renderMembers(members, duesMap, attendanceMap);
}

/* ---------- Actions ---------- */
async function savePresence(member_id, present) {
  const session_id = els.session.value;
  if (!session_id) return alert("Sélectionne d'abord une séance.");
  await api("/api/attendance", { method: "POST", body: { session_id, member_id, present } });
  await loadMembersAndAttendance();
}

/* ---------- Events ---------- */
els.team.addEventListener("change", async () => {
  await loadSessions();
  await loadMembersAndAttendance();
});
els.day.addEventListener("change", async () => {
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

/* ---------- Init ---------- */
(async function init() {
  try {
    // équipe + date du jour en valeur par défaut
    await loadTeams();
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    els.day.value = today.toISOString().slice(0,10); // yyyy-mm-dd

    await loadSessions();              // sessions du jour (et équipe si choisie)
    await loadMembersAndAttendance();  // liste + présence/cotis
  } catch (e) {
    console.error(e);
    alert("Erreur d'initialisation : " + e.message);
  }
})();
