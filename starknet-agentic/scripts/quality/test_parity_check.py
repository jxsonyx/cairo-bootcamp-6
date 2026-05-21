#!/usr/bin/env python3
"""Regression tests for parity_check.py."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("parity_check.py")
SPEC = importlib.util.spec_from_file_location("parity_check", MODULE_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - import bootstrap failure
    raise RuntimeError(f"Unable to load parity module from {MODULE_PATH}")
PARITY_CHECK = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PARITY_CHECK
SPEC.loader.exec_module(PARITY_CHECK)


class ParityCheckTests(unittest.TestCase):
    def test_docs_category_page_slugs_returns_empty_set_for_missing_file(self) -> None:
        slugs = PARITY_CHECK.docs_category_page_slugs(Path("/repo/website/app/data/docs.ts"), "Skills")
        assert slugs == set()

    def test_website_skill_registry_errors_reports_missing_registry_without_redundant_skill_errors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "skills" / "cairo-testing").mkdir(parents=True)
            (root / "skills" / "cairo-testing" / "SKILL.md").write_text(
                "---\nname: cairo-testing\ndescription: tests\n---\n",
                encoding="utf-8",
            )

            errors = PARITY_CHECK.website_skill_registry_errors(root)

            assert errors == [f"missing docs registry: {root / 'website/app/data/docs.ts'}"]

    def test_docs_category_page_slugs_stops_when_target_category_has_no_pages_block(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            docs_ts = Path(tmp) / "docs.ts"
            docs_ts.write_text(
                textwrap.dedent(
                    """
                    export const DOC_CATEGORIES = [
                      {
                        title: "Skills",
                        slug: "skills",
                      },
                      {
                        title: "Guides",
                        slug: "guides",
                        pages: [{ slug: "quick-start", title: "Quick Start" }],
                      },
                    ];
                    """
                ),
                encoding="utf-8",
            )

            slugs = PARITY_CHECK.docs_category_page_slugs(docs_ts, "Skills")

            assert slugs == set()

    def test_docs_category_page_slugs_captures_inline_page_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            docs_ts = Path(tmp) / "docs.ts"
            docs_ts.write_text(
                textwrap.dedent(
                    """
                    export const DOC_CATEGORIES = [
                      {
                        title: "Skills",
                        slug: "skills",
                        pages: [{ slug: "overview", title: "Overview" }],
                      },
                    ];
                    """
                ),
                encoding="utf-8",
            )

            slugs = PARITY_CHECK.docs_category_page_slugs(docs_ts, "Skills")

            assert slugs == {"overview"}

    def test_user_facing_cairo_doc_rules_require_full_workflow_catalog(self) -> None:
        rules = PARITY_CHECK.user_facing_cairo_doc_rules(Path("/repo"))

        assert rules[Path("/repo/website/content/docs/skills/overview.mdx")]["required"] == [
            "cairo-contract-authoring",
            "cairo-testing",
            "cairo-auditor",
            "cairo-optimization",
            "cairo-deploy",
        ]
        assert rules[Path("/repo/website/content/docs/getting-started/installation.mdx")]["required"] == [
            "cairo-contract-authoring/",
            "cairo-testing/",
            "cairo-auditor/",
            "cairo-optimization/",
            "cairo-deploy/",
        ]

    def test_user_facing_cairo_doc_rules_cover_starknet_js_cross_link(self) -> None:
        rules = PARITY_CHECK.user_facing_cairo_doc_rules(Path("/repo"))

        assert Path("/repo/website/content/docs/skills/starknet-js.mdx") in rules
        assert rules[Path("/repo/website/content/docs/skills/starknet-js.mdx")]["required"] == [
            "/docs/skills/cairo-coding"
        ]
        assert rules[Path("/repo/website/content/docs/skills/starknet-js.mdx")]["forbidden"] == [
            "cairo-contracts",
            "cairo-security",
        ]

    def test_website_cairo_taxonomy_errors_reports_stale_id_in_starknet_js(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for path, rules in PARITY_CHECK.user_facing_cairo_doc_rules(root).items():
                path.parent.mkdir(parents=True, exist_ok=True)
                content = "\n".join(rules["required"])
                if path.name == "starknet-js.mdx":
                    content = f"{content}\ncairo-security\n"
                path.write_text(content, encoding="utf-8")

            errors = PARITY_CHECK.website_cairo_taxonomy_errors(root)

            assert (
                f"{root / 'website/content/docs/skills/starknet-js.mdx'}: contains stale ids cairo-security"
                in errors
            )

    def test_website_cairo_taxonomy_unable_to_read_taxonomy_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "website/content/docs/skills/cairo-coding.mdx"
            for path, rules in PARITY_CHECK.user_facing_cairo_doc_rules(root).items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("\n".join(rules["required"]), encoding="utf-8")

            original_read_text = Path.read_text

            def flaky_read_text(path_obj: Path, *args: object, **kwargs: object) -> str:
                if path_obj == target:
                    raise OSError("boom")
                return original_read_text(path_obj, *args, **kwargs)

            with patch("pathlib.Path.read_text", autospec=True, side_effect=flaky_read_text):
                errors = PARITY_CHECK.website_cairo_taxonomy_errors(root)

            assert any(str(target) in error and "unable to read file (boom)" in error for error in errors), errors

    def test_docs_category_page_slugs_extracts_only_target_category(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            docs_ts = Path(tmp) / "docs.ts"
            docs_ts.write_text(
                textwrap.dedent(
                    """
                    export const DOC_CATEGORIES = [
                      {
                        title: "Guides",
                        slug: "guides",
                        pages: [{ slug: "quick-start", title: "Quick Start" }],
                      },
                      {
                        title: "Skills",
                        slug: "skills",
                        pages: [
                          { slug: "overview", title: "Overview" },
                          { slug: "cairo-contract-authoring", title: "Cairo Contract Authoring" },
                          { slug: "cairo-testing", title: "Cairo Testing" },
                        ],
                      },
                    ];
                    """
                ),
                encoding="utf-8",
            )

            slugs = PARITY_CHECK.docs_category_page_slugs(docs_ts, "Skills")

            assert slugs == {"overview", "cairo-contract-authoring", "cairo-testing"}

    def test_website_skill_registry_errors_reports_missing_skill_page_and_registry_entry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "skills" / "cairo-testing").mkdir(parents=True)
            (root / "skills" / "cairo-testing" / "SKILL.md").write_text(
                "---\nname: cairo-testing\ndescription: tests\n---\n",
                encoding="utf-8",
            )
            (root / "skills" / "cairo-auditor").mkdir(parents=True)
            (root / "skills" / "cairo-auditor" / "SKILL.md").write_text(
                "---\nname: cairo-auditor\ndescription: audit\n---\n",
                encoding="utf-8",
            )
            docs_dir = root / "website" / "content" / "docs" / "skills"
            docs_dir.mkdir(parents=True)
            (docs_dir / "cairo-testing.mdx").write_text("---\ntitle: Cairo Testing\n---\n", encoding="utf-8")
            (docs_dir / "overview.mdx").write_text("---\ntitle: Overview\n---\n", encoding="utf-8")
            (docs_dir / "cairo-coding.mdx").write_text("---\ntitle: Cairo\n---\n", encoding="utf-8")
            (docs_dir / "writing-skills.mdx").write_text("---\ntitle: Writing\n---\n", encoding="utf-8")
            (docs_dir / "publishing.mdx").write_text("---\ntitle: Publishing\n---\n", encoding="utf-8")
            docs_ts = root / "website" / "app" / "data"
            docs_ts.mkdir(parents=True)
            (docs_ts / "docs.ts").write_text(
                textwrap.dedent(
                    """
                    export const DOC_CATEGORIES = [
                      {
                        title: "Skills",
                        slug: "skills",
                        pages: [
                          { slug: "overview", title: "Overview" },
                          { slug: "cairo-testing", title: "Cairo Testing" },
                        ],
                      },
                    ];
                    """
                ),
                encoding="utf-8",
            )

            errors = PARITY_CHECK.website_skill_registry_errors(root)

            assert any("missing skill docs pages: cairo-auditor" in error for error in errors), errors
            assert any("missing skills in docs registry: cairo-auditor" in error for error in errors), errors


if __name__ == "__main__":
    unittest.main()
