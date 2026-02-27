"""Precise word counting by section."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from pdf_processor import TextBlock
from section_classifier import SectionLabel


def count_words(text: str) -> int:
    """Count words in *text* using whitespace tokenisation.

    Matches the behaviour of most word processors: any whitespace-
    delimited token counts as one word.
    """
    return len(text.split())


@dataclass
class SectionCount:
    label: str
    word_count: int = 0
    block_indices: list[int] = field(default_factory=list)


@dataclass
class WordCountResult:
    """Structured word-count breakdown."""

    sections: dict[str, SectionCount] = field(default_factory=dict)
    header_footer_words: int = 0
    total_words: int = 0

    def to_dict(self) -> dict:
        return {
            "sections": {
                k: {"label": v.label, "word_count": v.word_count}
                for k, v in self.sections.items()
            },
            "header_footer_words": self.header_footer_words,
            "total_words": self.total_words,
        }


# Human-readable labels shown in the UI.
SECTION_DISPLAY_NAMES: dict[str, str] = {
    "title_page": "Title Page",
    "abstract": "Abstract",
    "body": "Body Text",
    "table_figure": "Tables & Figures",
    "table_figure_notes": "Table/Figure Notes",
    "references": "References",
    "appendix": "Appendix",
}


def compute_word_counts(
    blocks: list[TextBlock],
    classification: dict[int, SectionLabel],
) -> WordCountResult:
    """Aggregate word counts per section from classified blocks."""

    result = WordCountResult()

    # Initialise all sections so the UI always sees every category.
    for key, display in SECTION_DISPLAY_NAMES.items():
        result.sections[key] = SectionCount(label=display)

    for block in blocks:
        wc = count_words(block.text)
        result.total_words += wc

        if block.is_header_footer:
            result.header_footer_words += wc
            continue

        label = classification.get(block.index, "body")
        section = result.sections.get(label)
        if section is None:
            section = SectionCount(label=label)
            result.sections[label] = section
        section.word_count += wc
        section.block_indices.append(block.index)

    return result
