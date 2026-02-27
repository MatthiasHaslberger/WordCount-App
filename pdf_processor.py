"""Extract text blocks from a PDF with positional metadata.

Uses PyMuPDF to pull out every text block on every page, then strips
headers / footers (page numbers, running titles) based on vertical
position on the page.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import fitz  # PyMuPDF


@dataclass
class TextBlock:
    """A single text block extracted from the PDF."""

    index: int
    page: int
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    is_header_footer: bool = False


@dataclass
class ExtractionResult:
    """Full extraction output for a PDF."""

    blocks: list[TextBlock] = field(default_factory=list)
    total_pages: int = 0


# Fraction of page height to treat as header/footer margin.
_MARGIN_FRAC = 0.06

# Patterns that strongly suggest a header/footer line.
_PAGE_NUM_RE = re.compile(r"^\s*\d{1,4}\s*$")
_RUNNING_TITLE_MIN_REPEATS = 2  # same text on ≥N pages → running title


def extract_text_blocks(pdf_bytes: bytes) -> ExtractionResult:
    """Return classified text blocks from *pdf_bytes*."""

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    result = ExtractionResult(total_pages=len(doc))

    # First pass: collect raw blocks and detect repeated header/footer text.
    raw_blocks: list[TextBlock] = []
    page_heights: dict[int, float] = {}  # page_num (1-based) → height
    header_footer_texts: dict[str, int] = {}  # text → count of pages it appears on
    idx = 0

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_height = page.rect.height
        page_heights[page_num + 1] = page_height
        top_margin = page_height * _MARGIN_FRAC
        bottom_margin = page_height * (1 - _MARGIN_FRAC)

        blocks = page.get_text("blocks")  # (x0, y0, x1, y1, text, blk_no, type)
        for b in blocks:
            if b[6] != 0:  # skip image blocks
                continue
            text = b[4].strip()
            if not text:
                continue

            in_margin = b[1] < top_margin or b[3] > bottom_margin
            tb = TextBlock(
                index=idx,
                page=page_num + 1,
                text=text,
                x0=b[0],
                y0=b[1],
                x1=b[2],
                y1=b[3],
                is_header_footer=False,
            )
            raw_blocks.append(tb)
            idx += 1

            # Track text appearing in margins across pages for running-title detection.
            if in_margin:
                normalised = text.lower().strip()
                header_footer_texts[normalised] = header_footer_texts.get(normalised, 0) + 1

    # Second pass: flag header/footer blocks.
    running_titles = {
        t for t, c in header_footer_texts.items() if c >= _RUNNING_TITLE_MIN_REPEATS
    }

    for tb in raw_blocks:
        ph = page_heights.get(tb.page, 842)
        in_margin = tb.y0 < (ph * _MARGIN_FRAC) or tb.y1 > (ph * (1 - _MARGIN_FRAC))
        normalised = tb.text.lower().strip()
        if in_margin and (
            _PAGE_NUM_RE.match(tb.text)
            or normalised in running_titles
        ):
            tb.is_header_footer = True

    result.blocks = raw_blocks
    doc.close()
    return result
