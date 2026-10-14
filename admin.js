const loginPanel = document.getElementById("login-panel");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");

function msg(el, text, type) { el.textContent = text; el.className = "message " + (type || ""); }

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "अनुरोध विफल रहा।");
  return data;
}

function drawBars(container, results) {
  container.replaceChildren();
  const max = Math.max(1, ...results.map(x => x.votes || 0));
  results.forEach(item => {
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "bar-label";
    const name = document.createElement("span"); name.textContent = item.name;
    const count = document.createElement("span"); count.textContent = `${item.votes} votes`;
    label.append(name, count);
    const track = document.createElement("div"); track.className = "track";
    const fill = document.createElement("div"); fill.className = "fill actual";
    fill.style.width = `${(item.votes / max) * 100}%`;
    track.append(fill); wrap.append(label, track); container.append(wrap);
  });
}

let scenarioCandidates = [];
let editingScenarioId = null;

function renderScenarioInputs(values = {}) {
  const container = document.getElementById("scenario-percentages");
  container.replaceChildren();
  scenarioCandidates.forEach((candidate) => {
    const row = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = candidate.name;
    label.setAttribute("for", "scenario-percent-" + candidate.id);
    const input = document.createElement("input");
    input.id = "scenario-percent-" + candidate.id;
    input.type = "number";
    input.step = "0.01";
    input.min = "0";
    input.max = "100";
    input.value = (values[candidate.id] ?? 0).toFixed(2);
    input.dataset.candidateId = candidate.id;
    input.addEventListener("input", updateScenarioTotal);
    row.append(label, input);
    container.append(row);
  });
  updateScenarioTotal();
}

function updateScenarioTotal() {
  let total = 0;
  document.querySelectorAll("#scenario-percentages input").forEach((input) => {
    total += Number(input.value || 0);
  });
  const el = document.getElementById("scenario-total");
  el.textContent = "Total: " + total.toFixed(2) + "%";
  el.style.color = Math.abs(total - 100) < 0.001 ? "" : "#a33a35";
}

function collectScenarioPercentages() {
  return scenarioCandidates.map((candidate) => ({
    candidateId: candidate.id,
    percent: Number(document.getElementById("scenario-percent-" + candidate.id).value || 0)
  }));
}

function showEditor(values) {
  document.getElementById("simulation-editor").hidden = false;
  if (values) renderScenarioInputs(values);
  else renderScenarioInputs({});
}

function hideEditor() {
  document.getElementById("simulation-editor").hidden = true;
  editingScenarioId = null;
  document.getElementById("scenario-name").value = "";
  msg(document.getElementById("scenario-message"), "", "");
}

async function loadScenarios() {
  const scenarios = await api("/api/admin/simulations");
  const list = document.getElementById("simulation-list");
  list.replaceChildren();
  if (!scenarios.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent = "No simulation scenarios.";
    list.append(empty);
    return;
  }
  scenarios.forEach((scenario) => {
    const card = document.createElement("div");
    card.className = "locked-preview";
    const title = document.createElement("strong");
    title.textContent = scenario.name + (scenario.isActive ? " (Active)" : "");
    const meta = document.createElement("p");
    meta.textContent = "Updated: " + scenario.updatedAt;
    const actions = document.createElement("div");
    actions.className = "step-actions";
    const previewBtn = document.createElement("button");
    previewBtn.className = "secondary"; previewBtn.type = "button";
    previewBtn.textContent = "Preview";
    previewBtn.addEventListener("click", () => previewScenario(scenario));
    const editBtn = document.createElement("button");
    editBtn.className = "secondary"; editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      const values = {};
      scenario.results.forEach((r) => { values[r.candidateId] = r.percent; });
      editingScenarioId = scenario.id;
      document.getElementById("scenario-name").value = scenario.name;
      showEditor(values);
    });
    actions.append(previewBtn, editBtn);
    if (scenario.isActive) {
      const deactivateBtn = document.createElement("button");
      deactivateBtn.className = "secondary"; deactivateBtn.type = "button";
      deactivateBtn.textContent = "Deactivate";
      deactivateBtn.addEventListener("click", async () => {
        await api("/api/admin/simulations/" + scenario.id + "/deactivate", { method: "POST", body: "{}" });
        await loadScenarios();
      });
      actions.append(deactivateBtn);
    } else {
      const activateBtn = document.createElement("button");
      activateBtn.className = "primary"; activateBtn.type = "button";
      activateBtn.textContent = "Activate";
      activateBtn.addEventListener("click", async () => {
        if (!confirm("Activate this demo scenario? It will show demo results publicly.")) return;
        await api("/api/admin/simulations/" + scenario.id + "/activate", {
          method: "POST",
          body: JSON.stringify({ confirmActivation: true })
        });
        await loadScenarios();
      });
      actions.append(activateBtn);
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "secondary"; deleteBtn.type = "button";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Delete this scenario?")) return;
        await fetch("/api/admin/simulations/" + scenario.id, { method: "DELETE" });
        await loadScenarios();
      });
      actions.append(deleteBtn);
    }
    card.append(title, meta, actions);
    list.append(card);
  });
}

function previewScenario(scenario) {
  const container = document.getElementById("simulation-preview");
  container.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Scenario Preview: " + scenario.name;
  const banner = document.createElement("div");
  banner.className = "warning";
  banner.textContent = "डेमो परिणाम — वास्तविक मतदान के परिणाम नहीं";
  container.append(heading, banner);
  scenario.results.forEach((r) => {
    const row = document.createElement("div");
    row.className = "bar-label";
    const name = document.createElement("span");
    name.textContent = r.candidateName || r.candidateId;
    const value = document.createElement("span");
    value.textContent = r.percent.toFixed(2) + "% (" + r.count + "/" + scenario.total + ")";
    row.append(name, value);
    container.append(row);
  });
}

async function saveScenario() {
  const name = document.getElementById("scenario-name").value.trim();
  const percentages = collectScenarioPercentages();
  const body = { name, percentages };
  try {
    if (editingScenarioId) {
      await api("/api/admin/simulations/" + editingScenarioId, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/api/admin/simulations", { method: "POST", body: JSON.stringify(body) });
    }
    msg(document.getElementById("scenario-message"), "Scenario saved.", "success");
    await loadScenarios();
    hideEditor();
  } catch (err) {
    msg(document.getElementById("scenario-message"), err.message, "error");
  }
}

async function loadDashboard() {
  const data = await api("/api/admin/results");
  document.getElementById("total-votes").textContent = data.totalVotes;
  drawBars(document.getElementById("actual-results"), data.results, true);
  const tbody = document.getElementById("voter-rows");
  tbody.replaceChildren();
  data.voters.forEach(v => {
    const tr = document.createElement("tr");
    [v.voterName, v.votedFor, v.createdAt + " UTC"].forEach(value => {
      const td = document.createElement("td"); td.textContent = value; tr.append(td);
    });
    tbody.append(tr);
  });
  document.getElementById("candidate-names").value = data.results.map(r => r.name).join("\n");
  scenarioCandidates = data.results.map((r) => ({ id: r.candidateId, name: r.name }));
}

async function showSession() {
  const data = await api("/api/admin/me");
  loginPanel.hidden = data.isAdmin;
  dashboard.hidden = !data.isAdmin;
  if (data.isAdmin) {
    await loadDashboard();
    renderScenarioInputs({});
    await loadScenarios();
  }
}
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: document.getElementById("password").value })
    });
    document.getElementById("password").value = "";
    msg(loginMessage, "", "");
    await showSession();
  } catch (err) { msg(loginMessage, err.message, "error"); }
});
document.getElementById("logout").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST", body: "{}" });
  await showSession();
});
document.getElementById("save-candidates").addEventListener("click", async () => {
  const names = document.getElementById("candidate-names").value.split("\n").map(x => x.trim()).filter(Boolean);
  try {
    await api("/api/admin/candidates", { method: "PUT", body: JSON.stringify({ names }) });
    msg(document.getElementById("candidate-message"), "Candidate names saved.", "success");
    await loadDashboard();
  } catch (err) { msg(document.getElementById("candidate-message"), err.message, "error"); }
});
document.getElementById("new-simulation").addEventListener("click", () => {
  editingScenarioId = null;
  document.getElementById("scenario-name").value = "";
  showEditor({});
});
document.getElementById("save-scenario").addEventListener("click", saveScenario);
document.getElementById("cancel-scenario").addEventListener("click", hideEditor);

showSession().catch(() => {
  loginPanel.hidden = false;
  dashboard.hidden = true;
});