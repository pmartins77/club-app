// public/coach.js
// Version "teams dérivées des membres": on construit le select Equipe depuis /api/members

const els = {
  team: document.getElementById("teamSelect"),
  day: document.getElementById("daySelect"),
  session: document.getElementById("sessionSelect"),
  refresh: document.getElementById("refreshBtn"),
  membersContainer: document.getElementById("membersContainer"),
  tpl: document.getElementById("memberRowTpl"),
  sessionInfo: document.getElementById("sessionInfo"),
};

let _allMembers = []; // cache des membres pour filtrage client

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

    const paid = duesMap.get(m.id) ?? false;
    const duesCell = row.querySelector(".dues");
    const badge = document.createElement("span");
    badge.className = `badge ${paid ? "ok" : "ko"}`;
    badge.textContent = paid ? "À jour" : "À régulariser";
    duesCell.appendChild(badge);

    const present = attendanceMap.get(m.id) ?? false;
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

// Charge TOUS les membres (sans filtre) puis construit la liste d’équipes depuis team_name
async function loadMembersAllAndBuildTeams() {
  const mRes = await api(`/api/members`); // pas de team_id
  _allMembers = mRes.data ?? [];

  // Construit l’ensemble des équipes depuis team_name
  const set = new Set();
  for (const m of _allMembers) {
    if (m.team_name && m.team_name.trim()) set.add(m.team_name.trim());
  }
  const teams = Array.from(set).sort((a,b)=>a.localeCompare(b, "fr"));

  // Options: "Toutes équipes" + équipe(s)
  els.team.innerHTML = [`<option value="">Toutes équipes</option>`, ...teams.map(n => `<option value="${n}">${n}</option>`)].join("");
}

// Recharge la liste des séances à partir de la date choisie et (optionnel) team_name
async function loadSessions() {
  const team_name = els.team.value || "";     // maintenant c’est le nom (pas l’id)
  const day = els.day.value;                  // yyyy-mm-dd
  const qTeam = team_name ? `&team_name=${encodeURIComponent(team_name)}` : "";
  const qDay = day ? `&date=${encodeURIComponent(day)}` : "";
  // days_ahead=0 : on ne matérialise rien, on lit ce qui est déjà en base
  const { ok, data } = await api(`/api/sessions?days_ahead=0${qTeam}${qDay}`);
  if (!ok) throw new Error("sessions");
  els.session.innerHTML = data
    .map(s => `<option value="${s.id}">${new Date(s.starts_at).toLocaleString()} — ${s.title}</option>`)
    .join("");
  updateSessionInfo();
}

// Filtre les membres en mémoire selon l’équipe sélectionnée (client-side)
function getFilteredMembers() {
  const team_name = els.team.value || "";
  if (!team_name) return _allMembers;
  return _allMembers.filter(m => (m.team_name || "").trim() === team_name);
}

function updateSessionInfo() {
  const sOpt = els.session.selectedOptions[0];
  els.sessionInfo.textContent = sOpt ? `Séance: ${sOpt.textContent}` : "";
}

async function loadMembersAndAttendance() {
  const teamMembers = getFilteredMembers();
  const session_id = els.session.value || "";

  // cotisations pour tous (ou filtrés par équipe côté client)
  const duesRes = await api(`/api/dues`); // on récupère tout puis on mappe
  const allDuesMap = new Map(duesRes.data.map(d => [d.member_id, d.paid_this_season]));

  // présence pour la séance sélectionnée
  const attRes = session_id ? await api(`/api/attendance?session_id=${session_id}`) : { data: [] };
  const attendanceMap = new Map(attRes.data.map(a => [a.member_id, a.present]));

  renderMembers(teamMembers, allDuesMap, attendanceMap);
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
    // Date du jour par défaut
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    els.day.value = today.toISOString().slice(0,10);

    // 1) Tous les membres => construit teams
    await loadMembersAllAndBuildTeams();
    // 2) Séances du jour (filtrées potentiellement par team_name)
    await loadSessions();
    // 3) Tableau membres + cotis + présence
    await loadMembersAndAttendance();
  } catch (e) {
    console.error(e);
    alert("Erreur d'initialisation : " + e.message);
  }
})();
