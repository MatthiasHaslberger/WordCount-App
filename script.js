/* ==========================================================================
   Academic Paper Word Counter – fully client-side
   Uses pdf.js for extraction and rule-based heuristics for classification.
   ========================================================================== */

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs";

/* ── State ─────────────────────────────────────────────────────── */

let selectedFile = null;
let analysisResult = null;

const TOGGLEABLE = [
  "title_page",
  "abstract",
  "table_figure",
  "table_figure_notes",
  "references",
  "appendix",
];

const included = {
  title_page: true,
  abstract: true,
  body: true,
  table_figure: false,
  table_figure_notes: false,
  references: false,
  appendix: false,
};

const DISPLAY_NAMES = {
  title_page: "Title Page",
  abstract: "Abstract",
  body: "Body Text",
  table_figure: "Tables & Figures",
  table_figure_notes: "Table/Figure Notes",
  references: "References",
  appendix: "Appendix",
};

/* ── Heading patterns ─────────────────────────────────────────── */

const RE_ABSTRACT = /^abstract\s*$/i;

const RE_BODY_START = new RegExp(
  "^(" +
    [
      "introduction",
      "background",
      "literature\\s+review",
      "theoretical\\s+(framework|background)",
      "related\\s+work",
      "overview",
      "theory",
      "hypothes[ei]s",
      "methods?",
      "methodology",
      "materials?\\s+and\\s+methods?",
      "experimental\\s+(design|setup|methods?|procedure)",
      "procedure",
      "design",
      "participants",
      "sample",
      "measures?",
      "instruments?",
      "data\\s+(analysis|collection|sources?)",
      "analytic\\s+strategy",
      "statistical\\s+(analysis|methods?)",
      "results?",
      "findings",
      "analysis",
      "discussion",
      "general\\s+discussion",
      "conclusions?",
      "summary",
      "implications",
      "limitations",
      "future\\s+(research|directions?|work)",
      "study\\s+\\d",
      "experiment\\s+\\d",
    ].join("|") +
    ")\\s*$",
  "i"
);

const RE_REFERENCES =
  /^(references|bibliography|works?\s+cited|literature\s+cited|reference\s+list)\s*$/i;

const RE_APPENDIX =
  /^(appendix|appendices|supplementary\s+materials?|supplemental\s+materials?|supporting\s+information)/i;

const RE_TABLE_FIG_CAPTION = /^(table|figure|fig\.?)\s*(\d|[A-Z]\d)/i;
const RE_TABLE_FIG_NOTE = /^(notes?|source)\s*[.:]/i;

/* ── PDF extraction (pdf.js) ──────────────────────────────────── */

async function extractPdf(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ normalizeWhitespace: true });

    const lines = buildLines(content.items, viewport.height);
    pages.push({ lines, height: viewport.height, pageNum: i });
  }

  return { pages, totalPages: pdf.numPages };
}

/** Group pdf.js text items into lines based on y-position. */
function buildLines(items, pageHeight) {
  if (!items.length) return [];

  const Y_TOLERANCE = 3;

  const mapped = items.map((it) => {
    const tx = it.transform[4];
    const ty = it.transform[5];
    const fontSize = Math.abs(it.transform[3]) || it.height || 10;
    return { text: it.str, x: tx, y: pageHeight - ty, fontSize, hasEOL: it.hasEOL };
  });

  mapped.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  let cur = { items: [mapped[0]], y: mapped[0].y, fontSize: mapped[0].fontSize };

  for (let i = 1; i < mapped.length; i++) {
    const item = mapped[i];
    if (Math.abs(item.y - cur.y) <= Y_TOLERANCE) {
      cur.items.push(item);
    } else {
      lines.push(finishLine(cur));
      cur = { items: [item], y: item.y, fontSize: item.fontSize };
    }
  }
  lines.push(finishLine(cur));
  return lines;
}

function finishLine(lineObj) {
  lineObj.items.sort((a, b) => a.x - b.x);
  const text = lineObj.items.map((it) => it.text).join(" ").replace(/\s+/g, " ").trim();
  return { text, y: lineObj.y, fontSize: lineObj.fontSize };
}

/* ── Header / footer detection ────────────────────────────────── */

const MARGIN_FRAC = 0.07;
const PAGE_NUM_RE = /^\s*\d{1,4}\s*$/;
const RUNNING_TITLE_REPEATS = 2;

function detectHeadersFooters(pages) {
  const marginTextCounts = {};

  for (const pg of pages) {
    const topY = pg.height * MARGIN_FRAC;
    const bottomY = pg.height * (1 - MARGIN_FRAC);
    const seenOnPage = new Set();

    for (const ln of pg.lines) {
      if (ln.y < topY || ln.y > bottomY) {
        const key = ln.text.toLowerCase().trim();
        if (!seenOnPage.has(key)) {
          seenOnPage.add(key);
          marginTextCounts[key] = (marginTextCounts[key] || 0) + 1;
        }
      }
    }
  }

  const runningTitles = new Set(
    Object.entries(marginTextCounts)
      .filter(([, c]) => c >= RUNNING_TITLE_REPEATS)
      .map(([t]) => t)
  );

  for (const pg of pages) {
    const topY = pg.height * MARGIN_FRAC;
    const bottomY = pg.height * (1 - MARGIN_FRAC);

    for (const ln of pg.lines) {
      ln.isHeaderFooter = false;
      if (ln.y < topY || ln.y > bottomY) {
        const key = ln.text.toLowerCase().trim();
        if (PAGE_NUM_RE.test(ln.text) || runningTitles.has(key)) {
          ln.isHeaderFooter = true;
        }
      }
    }
  }
}

/* ── Build paragraphs from lines ──────────────────────────────── */

function buildParagraphs(pages) {
  const paragraphs = [];
  let idx = 0;

  for (const pg of pages) {
    const contentLines = pg.lines.filter((l) => !l.isHeaderFooter && l.text.length > 0);
    if (!contentLines.length) continue;

    let totalGap = 0;
    let gapCount = 0;
    for (let i = 1; i < contentLines.length; i++) {
      const gap = contentLines[i].y - contentLines[i - 1].y;
      if (gap > 0 && gap < 100) {
        totalGap += gap;
        gapCount++;
      }
    }
    const avgSpacing = gapCount > 0 ? totalGap / gapCount : 14;
    const paraBreakThreshold = avgSpacing * 1.8;

    let currentLines = [contentLines[0]];

    for (let i = 1; i < contentLines.length; i++) {
      const gap = contentLines[i].y - contentLines[i - 1].y;
      if (gap > paraBreakThreshold) {
        paragraphs.push(makeParagraph(currentLines, pg.pageNum, idx++));
        currentLines = [contentLines[i]];
      } else {
        currentLines.push(contentLines[i]);
      }
    }
    if (currentLines.length) {
      paragraphs.push(makeParagraph(currentLines, pg.pageNum, idx++));
    }
  }

  return paragraphs;
}

function makeParagraph(lines, page, index) {
  const text = lines.map((l) => l.text).join(" ");
  const avgFontSize = lines.reduce((sum, l) => sum + l.fontSize, 0) / lines.length;
  return { text, page, index, avgFontSize, lineCount: lines.length };
}

/* ── Section classifier (rule-based) ──────────────────────────── */

function isHeadingLike(para) {
  return para.text.split(/\s+/).length <= 12;
}

function classifyParagraphs(paragraphs) {
  const result = {};
  let state = "title_page";
  let seenAbstract = false;
  let seenBodyStart = false;

  for (const para of paragraphs) {
    const trimmed = para.text.trim();
    if (!trimmed) continue;

    // Check for section headings.
    if (isHeadingLike(para)) {
      if (RE_ABSTRACT.test(trimmed)) {
        state = "abstract";
        seenAbstract = true;
        result[para.index] = "abstract";
        continue;
      }
      if (RE_REFERENCES.test(trimmed)) {
        state = "references";
        result[para.index] = "references";
        continue;
      }
      if (RE_APPENDIX.test(trimmed)) {
        state = "appendix";
        result[para.index] = "appendix";
        continue;
      }
      if (RE_BODY_START.test(trimmed)) {
        state = "body";
        seenBodyStart = true;
        result[para.index] = "body";
        continue;
      }
    }

    // Table / figure captions and notes.
    if (RE_TABLE_FIG_CAPTION.test(trimmed)) {
      result[para.index] = "table_figure_notes";
      continue;
    }
    if (RE_TABLE_FIG_NOTE.test(trimmed)) {
      result[para.index] = "table_figure_notes";
      continue;
    }

    // If still on title page and past page 2 without any heading,
    // assume body starts.
    if (state === "title_page" && !seenAbstract && !seenBodyStart && para.page > 2) {
      state = "body";
    }

    result[para.index] = state;
  }

  return result;
}

/* ── Word counting ────────────────────────────────────────────── */

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function computeResults(paragraphs, classification, totalPages) {
  const sections = {};
  for (const key of Object.keys(DISPLAY_NAMES)) {
    sections[key] = { label: DISPLAY_NAMES[key], word_count: 0 };
  }

  let totalWords = 0;
  let headerFooterWords = 0;

  for (const para of paragraphs) {
    const wc = countWords(para.text);
    totalWords += wc;
    const label = classification[para.index] || "body";
    if (sections[label]) {
      sections[label].word_count += wc;
    } else {
      sections.body.word_count += wc;
    }
  }

  return { sections, totalWords, headerFooterWords, totalPages };
}

/* ── Main analysis pipeline ───────────────────────────────────── */

async function analyzePdf(arrayBuffer) {
  const { pages, totalPages } = await extractPdf(arrayBuffer);
  detectHeadersFooters(pages);
  const paragraphs = buildParagraphs(pages);

  if (!paragraphs.length) {
    throw new Error(
      "No text could be extracted from this PDF. It may be scanned / image-based."
    );
  }

  const classification = classifyParagraphs(paragraphs);
  return computeResults(paragraphs, classification, totalPages);
}

/* ══════════════════════════════════════════════════════════════════
   UI
   ══════════════════════════════════════════════════════════════════ */

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
  analyzeBtn.disabled = false;
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  uploadContent.classList.remove("hidden");
  fileInfoEl.classList.add("hidden");
  resultsEl.classList.add("hidden");
  analysisResult = null;
  analyzeBtn.disabled = true;
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
  if (!selectedFile) return;

  errorBanner.classList.add("hidden");
  resultsEl.classList.add("hidden");
  progressEl.classList.remove("hidden");
  analyzeBtn.disabled = true;

  try {
    const arrayBuffer = await selectedFile.arrayBuffer();
    analysisResult = await analyzePdf(arrayBuffer);
    renderResults();
    resultsEl.classList.remove("hidden");
  } catch (err) {
    showError(err.message || "Failed to analyze PDF.");
  } finally {
    progressEl.classList.add("hidden");
    analyzeBtn.disabled = false;
  }
});

/* ── Render results ───────────────────────────────────────────── */

function renderResults() {
  if (!analysisResult) return;

  const sections = analysisResult.sections;

  let effective = 0;
  let excluded = 0;

  for (const [key, sec] of Object.entries(sections)) {
    if (included[key]) {
      effective += sec.word_count;
    } else {
      excluded += sec.word_count;
    }
  }
  excluded += analysisResult.headerFooterWords;

  effectiveCountEl.textContent = effective.toLocaleString();
  totalCountEl.textContent = analysisResult.totalWords.toLocaleString();
  excludedCountEl.textContent = excluded.toLocaleString();
  pageCountEl.textContent = analysisResult.totalPages;

  const maxWords = Math.max(
    1,
    ...Object.values(sections).map((s) => s.word_count)
  );

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

  renderToggles();
}

function renderToggles() {
  toggleListEl.innerHTML = "";

  for (const key of TOGGLEABLE) {
    const sec = analysisResult?.sections[key];
    const wc = sec ? sec.word_count : 0;
    const label = DISPLAY_NAMES[key];

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

/* ── Init toggles (empty state before analysis) ───────────────── */

(function initToggles() {
  for (const key of TOGGLEABLE) {
    const item = document.createElement("div");
    item.className = "toggle-item";
    item.innerHTML = `
      <div class="toggle-left">
        <label class="switch">
          <input type="checkbox" data-section="${key}" ${included[key] ? "checked" : ""} />
          <span class="slider"></span>
        </label>
        <span class="toggle-label">${DISPLAY_NAMES[key]}</span>
      </div>
      <span class="toggle-words">\u2014 words</span>
    `;
    item.querySelector("input").addEventListener("change", (e) => {
      included[key] = e.target.checked;
      if (analysisResult) renderResults();
    });
    toggleListEl.appendChild(item);
  }
})();
