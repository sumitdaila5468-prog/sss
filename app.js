const candidatesEl = document.getElementById("candidates");
const form = document.getElementById("vote-form");
const message = document.getElementById("vote-message");
const selectedLabel = document.getElementById("selected-candidate-label");

const steps = {
  welcome: document.getElementById("step-welcome"),
  selection: document.getElementById("step-selection"),
  vote: document.getElementById("step-vote"),
  complete: document.getElementById("step-complete")
};

let isSubmitting = false;
let isLoadingResults = false;
let candidateData = [];
const viewResultsBtn = document.getElementById("view-results-btn");
const resultsSection = document.getElementById("results-section");
const resultsEl = document.getElementById("saved-results");

const progressLabels = {
  welcome: "चरण 1 / 4: स्वागत",
  selection: "चरण 2 / 4: चयन",
  vote: "चरण 3 / 4: मत दर्ज",
  complete: "चरण 4 / 4: पूर्ण"
};

function showStep(name) {
  Object.keys(steps).forEach((key) => {
    steps[key].hidden = key !== name;
  });
  const progress = document.getElementById("progress-text");
  if (progress) progress.textContent = progressLabels[name];
  const heading = steps[name].querySelector("h2");
  if (heading) heading.focus?.();
}

function setMessage(el, text, type) {
  el.textContent = text;
  el.className = "message " + (type || "");
}

function getSelectedCandidateId() {
  const checked = form.querySelector ? null : null;
  const radio = document.querySelector('input[name="candidateId"]:checked');
  return radio ? Number(radio.value) : null;
}

async function loadCandidates() {
  const res = await fetch("/api/candidates");
  if (!res.ok) throw new Error("Could not load candidates.");
  candidateData = await res.json();
  candidatesEl.replaceChildren();
  candidateData.forEach((candidate) => {
    const label = document.createElement("label");
    label.className = "candidate";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "candidateId";
    radio.value = candidate.id;
    radio.required = true;
    const name = document.createElement("span");
    name.textContent = candidate.name;
    label.append(radio, name);
    candidatesEl.append(label);
  });
  document.getElementById("selection-next").disabled = true;
}

function updateSelectionState() {
  const selected = document.querySelector('input[name="candidateId"]:checked');
  document.getElementById("selection-next").disabled = !selected;
  if (selected) {
    const candidate = candidateData.find((c) => c.id === Number(selected.value));
    selectedLabel.textContent = candidate ? candidate.name : "Selected";
  }
}

function renderResultBars(items) {
  resultsEl.replaceChildren();
  items.forEach((item) => {
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "bar-label";
    const name = document.createElement("span");
    name.textContent = item.name;
    const value = document.createElement("span");
    value.textContent = item.value;
    label.append(name, value);
    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.width = item.width + "%";
    track.append(fill);
    wrap.append(label, track);
    resultsEl.append(wrap);
  });
  if (resultsSection && resultsSection.scrollIntoView) {
    try { resultsSection.scrollIntoView(); } catch (err) { /* ignore scroll errors */ }
  }
}

function resetResultsSection() {
  resultsEl.textContent = "अभी कोई परिणाम नहीं दिखाया गया है।";
  if (resultsSection) resultsSection.hidden = true;
  if (viewResultsBtn) {
    viewResultsBtn.disabled = false;
    viewResultsBtn.textContent = "परिणाम देखें";
  }
}

async function loadSavedResults() {
  try {
    const res = await fetch("/api/simulation-results");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "परिणाम लोड नहीं हो सके।");
    if (!data.active) {
      resultsEl.textContent = "परिणाम अभी उपलब्ध नहीं है।";
      return;
    }
    renderResultBars(data.results.map((item) => ({
      name: item.name,
      value: item.percent + "%",
      width: item.percent
    })));
  } catch (err) {
    resultsEl.textContent = "परिणाम लोड नहीं हो सके।";
  }
}

if (viewResultsBtn) {
  viewResultsBtn.addEventListener("click", async () => {
    if (isLoadingResults) return;
    isLoadingResults = true;
    viewResultsBtn.disabled = true;
    viewResultsBtn.textContent = "परिणाम लोड हो रहा है...";
    if (resultsSection) resultsSection.hidden = false;
    try {
      await loadSavedResults();
    } finally {
      isLoadingResults = false;
      viewResultsBtn.disabled = false;
      viewResultsBtn.textContent = "परिणाम देखें";
    }
  });
}

document.getElementById("continue-btn").addEventListener("click", () => {
  showStep("selection");
});

document.getElementById("selection-back").addEventListener("click", () => {
  showStep("welcome");
});

candidatesEl.addEventListener("change", updateSelectionState);

document.getElementById("selection-next").addEventListener("click", () => {
  if (!document.querySelector('input[name="candidateId"]:checked')) {
    setMessage(document.getElementById("selection-message"), "कृपया एक विकल्प चुनें।", "error");
    return;
  }
  const radio = document.querySelector('input[name="candidateId"]:checked');
  const candidate = candidateData.find((c) => c.id === Number(radio.value));
  selectedLabel.textContent = candidate ? candidate.name : "Selected";
  showStep("vote");
});

document.getElementById("vote-back").addEventListener("click", () => {
  showStep("selection");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSubmitting) return;
  const radio = document.querySelector('input[name="candidateId"]:checked');
  if (!radio) {
    setMessage(message, "कृपया एक विकल्प चुनें।", "error");
    return;
  }
  const submit = document.getElementById("submit-vote");
  isSubmitting = true;
  submit.disabled = true;
  submit.textContent = "Submitting...";
  try {
    const res = await fetch("/api/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voterName: document.getElementById("voterName").value,
        candidateId: radio.value
      })
    });
    const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "मत दर्ज नहीं हो सका।");
  showStep("complete");
  setMessage(document.getElementById("completion-message"), data.message || "आपका मत सफलतापूर्वक दर्ज किया गया है।", "success");
  resetResultsSection();
  } catch (err) {
    setMessage(message, err.message, "error");
  } finally {
    isSubmitting = false;
    submit.disabled = false;
    submit.textContent = "Submit Vote";
  }
});

document.getElementById("start-again").addEventListener("click", () => {
  form.reset();
  candidatesEl.querySelectorAll('input[name="candidateId"]').forEach((r) => { r.checked = false; });
  updateSelectionState();
  setMessage(message, "", "");
  resetResultsSection();
  showStep("welcome");
});

loadCandidates()
  .then(() => showStep("welcome"))
  .catch(() => {     candidatesEl.textContent = "विकल्प लोड नहीं हो सके। पृष्ठ ताज़ा करें।"; });
