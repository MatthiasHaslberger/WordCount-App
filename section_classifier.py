"""Classify extracted text blocks into academic-paper sections via Claude."""

from __future__ import annotations

import json
import re
from typing import Literal

import anthropic

from pdf_processor import TextBlock

SectionLabel = Literal[
    "title_page",
    "abstract",
    "body",
    "table_figure",
    "table_figure_notes",
    "references",
    "appendix",
]

VALID_LABELS: set[str] = set(SectionLabel.__args__)  # type: ignore[attr-defined]

_SYSTEM_PROMPT = """\
You are an expert at analysing the structure of academic research papers.
You will receive numbered text blocks extracted from a PDF of an academic paper.
Blocks flagged [HEADER/FOOTER] are page numbers or running titles — ignore those.

Classify EVERY remaining block into exactly one of these categories:

• title_page — title, author names, affiliations, correspondence info, keywords,
  acknowledgements header, or any other front-matter that typically appears on the
  first page(s) before the abstract.
• abstract — the abstract section (including the heading "Abstract").
• body — main text: introduction, methods, results, discussion, conclusion, etc.
• table_figure — content that belongs to a table or figure (the data itself,
  column headers, cell values, axis labels, legend entries).
• table_figure_notes — captions, titles, and notes that accompany tables or
  figures. Includes lines like "Table 1. …", "Figure 2: …", "Note. …".
• references — the reference list / bibliography section (including heading).
• appendix — appendix content (including heading).

Return ONLY a JSON object mapping each block index (integer) to its category
string. Do NOT include blocks flagged as [HEADER/FOOTER]. Example:
{"0": "title_page", "1": "abstract", "2": "body"}
"""


def _build_user_message(blocks: list[TextBlock]) -> str:
    """Format blocks into a numbered list for the LLM."""
    lines: list[str] = []
    for b in blocks:
        tag = " [HEADER/FOOTER]" if b.is_header_footer else ""
        lines.append(f"[{b.index}]{tag} {b.text}")
    return "\n\n".join(lines)


def classify_sections(
    blocks: list[TextBlock],
    api_key: str,
) -> dict[int, SectionLabel]:
    """Send blocks to Claude and return {block_index: section_label}."""

    content_blocks = [b for b in blocks if not b.is_header_footer]
    if not content_blocks:
        return {}

    user_msg = _build_user_message(blocks)

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )

    raw = response.content[0].text.strip()

    # Extract JSON from possible markdown fences.
    json_match = re.search(r"\{[\s\S]*\}", raw)
    if not json_match:
        raise ValueError("LLM response did not contain valid JSON.")

    parsed: dict[str, str] = json.loads(json_match.group())

    result: dict[int, SectionLabel] = {}
    for key, value in parsed.items():
        idx = int(key)
        label = value if value in VALID_LABELS else "body"
        result[idx] = label  # type: ignore[assignment]

    return result
