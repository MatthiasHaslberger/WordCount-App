/* ── State ─────────────────────────────────────────────────────── */

let selectedFile = null;
let analysisResult = null;

// Sections the user can toggle (body is always included).
const TOGGLEABLE = [
  "title_page",
  "abstract",
  "table_figure",
  "table_figure_notes",
  "references",
  "appendix",
];

// Default: body + abstract included, others excluded.
const included = {
  title_page: true,
  abstract: true,
  body: true, // always on
  table_figure: false,
  table_figure_notes: false,
  references: false,
  appendix: false,
};

/* ── DOM refs ─────────────────────────────────────────────────── */

const apiKeyInput = document.getElementById("api-key");
const toggleKeyBtn = document.getElementById("toggle-key");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const browseBtn = document.getElementById("browse-btn");
const uploadContent = document.getElementById("upload-content");
const fileInfoEl = document.getElementById("file-info");
const fileNameEl = document.getElementById("file-name");
const clearFileBtn = document.getElementById("clear-file");
const analyzeBtn = document.getElementById("analyze-btn");
const progressEl = document.getElementById("progress");
const errorBanner = document.getElementById("error-banner");
const errorMsg = document.getElementById("error-msg");
const dismissError = document.getElementById("dismiss-error");
const resultsEl = document.getElementById("results");
const effectiveCountEl = document.getElementById("effective-count");
const totalCountEl = document.getElementById("total-count");
const excludedCountEl = document.getElementById("excluded-count");
const pageCountEl = document.getElementById("page-count");
const breakdownEl = document.getElementById("breakdown");
const toggleListEl = document.getElementById("toggle-list");

/* ── API key visibility toggle ────────────────────────────────── */

toggleKeyBtn.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
});

/* ── File handling ────────────────────────────────────────────── */

function setFile(file) {
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
    showError("Please select a PDF file.");
    return;
  }
  selectedFile = file;
  fileNameEl.textContent = file.name;
  uploadContent.classList.add("hidden");
  fileInfoEl.classList.remove("hidden");
  updateAnalyzeBtn();
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  uploadContent.classList.remove("hidden");
  fileInfoEl.classList.add("hidden");
  resultsEl.classList.add("hidden");
  analysisResult = null;
  updateAnalyzeBtn();
}

browseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener("click", () => {
  if (!selectedFile) fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) setFile(fileInput.files[0]);
});

clearFileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  clearFile();
});

// Drag & drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});

/* ── Analyze button state ─────────────────────────────────────── */

function updateAnalyzeBtn() {
  analyzeBtn.disabled = !selectedFile || !apiKeyInput.value.trim();
}

apiKeyInput.addEventListener("input", updateAnalyzeBtn);

/* ── Error handling ───────────────────────────────────────────── */

function showError(msg) {
  errorMsg.textContent = msg;
  errorBanner.classList.remove("hidden");
}

dismissError.addEventListener("click", () => {
  errorBanner.classList.add("hidden");
});

/* ── Analyze ──────────────────────────────────────────────────── */

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile || !apiKeyInput.value.trim()) return;

  errorBanner.classList.add("hidden");
  resultsEl.classList.add("hidden");
  progressEl.classList.remove("hidden");
  analyzeBtn.disabled = true;

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("api_key", apiKeyInput.value.trim());

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Server error (${res.status})`);
    }

    analysisResult = await res.json();
    renderResults();
    resultsEl.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    progressEl.classList.add("hidden");
    updateAnalyzeBtn();
  }
});

/* ── Render results ───────────────────────────────────────────── */

function renderResults() {
  if (!analysisResult) return;

  const sections = analysisResult.sections;

  // Compute effective count based on current toggles.
  let effective = 0;
  let excluded = 0;

  for (const [key, sec] of Object.entries(sections)) {
    if (included[key]) {
      effective += sec.word_count;
    } else {
      excluded += sec.word_count;
    }
  }
  // Header/footer words are always excluded.
  excluded += analysisResult.header_footer_words;

  effectiveCountEl.textContent = effective.toLocaleString();
  totalCountEl.textContent = analysisResult.total_words.toLocaleString();
  excludedCountEl.textContent = excluded.toLocaleString();
  pageCountEl.textContent = analysisResult.total_pages;

  // Find max word count for bar scaling.
  const maxWords = Math.max(1, ...Object.values(sections).map((s) => s.word_count));

  // Build breakdown rows.
  breakdownEl.innerHTML = "";
  for (const [key, sec] of Object.entries(sections)) {
    if (sec.word_count === 0 && key !== "body") continue;

    const row = document.createElement("div");
    row.className = `breakdown-row${included[key] ? "" : " excluded"}`;
    row.dataset.section = key;

    const pct = ((sec.word_count / maxWords) * 100).toFixed(1);

    row.innerHTML = `
      <span class="breakdown-label">${sec.label}</span>
      <div class="bar-track">
        <div class="bar-fill bar-${key}" style="width: ${pct}%"></div>
      </div>
      <span class="breakdown-count">${sec.word_count.toLocaleString()}</span>
    `;
    breakdownEl.appendChild(row);
  }

  // Build toggles.
  renderToggles();
}

function renderToggles() {
  toggleListEl.innerHTML = "";

  for (const key of TOGGLEABLE) {
    const sec = analysisResult?.sections[key];
    const wc = sec ? sec.word_count : 0;
    const label = sec ? sec.label : key;

    const item = document.createElement("div");
    item.className = "toggle-item";

    item.innerHTML = `
      <div class="toggle-left">
        <label class="switch">
          <input type="checkbox" data-section="${key}" ${included[key] ? "checked" : ""} />
          <span class="slider"></span>
        </label>
        <span class="toggle-label">${label}</span>
      </div>
      <span class="toggle-words">${wc.toLocaleString()} words</span>
    `;

    item.querySelector("input").addEventListener("change", (e) => {
      included[key] = e.target.checked;
      renderResults();
    });

    toggleListEl.appendChild(item);
  }
}

/* ── Init toggles (empty state) ───────────────────────────────── */
(function initToggles() {
  const labels = {
    title_page: "Title Page",
    abstract: "Abstract",
    table_figure: "Tables & Figures",
    table_figure_notes: "Table/Figure Notes",
    references: "References",
    appendix: "Appendix",
  };

  for (const key of TOGGLEABLE) {
    const item = document.createElement("div");
    item.className = "toggle-item";
    item.innerHTML = `
      <div class="toggle-left">
        <label class="switch">
          <input type="checkbox" data-section="${key}" ${included[key] ? "checked" : ""} />
          <span class="slider"></span>
        </label>
        <span class="toggle-label">${labels[key]}</span>
      </div>
      <span class="toggle-words">— words</span>
    `;
    item.querySelector("input").addEventListener("change", (e) => {
      included[key] = e.target.checked;
      if (analysisResult) renderResults();
    });
    toggleListEl.appendChild(item);
  }
})();
