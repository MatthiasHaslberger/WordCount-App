"""FastAPI backend for the Academic Paper Word Counter."""

from __future__ import annotations

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from pdf_processor import extract_text_blocks
from section_classifier import classify_sections
from word_counter import compute_word_counts

app = FastAPI(title="Academic Paper Word Counter")

# ── API routes ──────────────────────────────────────────────────────

@app.post("/api/analyze")
async def analyze_pdf(
    file: UploadFile = File(...),
    api_key: str = Form(...),
):
    """Upload a PDF, classify its sections, and return word counts."""

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    pdf_bytes = await file.read()
    if len(pdf_bytes) == 0:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    # 1. Extract text blocks from the PDF.
    extraction = extract_text_blocks(pdf_bytes)

    if not extraction.blocks:
        raise HTTPException(
            status_code=422,
            detail="No text could be extracted from this PDF. It may be scanned/image-based.",
        )

    # 2. Classify sections via Claude.
    try:
        classification = classify_sections(extraction.blocks, api_key)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"LLM classification failed: {exc}",
        )

    # 3. Compute word counts.
    counts = compute_word_counts(extraction.blocks, classification)

    return {
        "total_pages": extraction.total_pages,
        "total_words": counts.total_words,
        "header_footer_words": counts.header_footer_words,
        "sections": {
            key: {
                "label": sec.label,
                "word_count": sec.word_count,
            }
            for key, sec in counts.sections.items()
        },
    }


# ── Serve the frontend ─────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def index():
    return FileResponse("static/index.html")
