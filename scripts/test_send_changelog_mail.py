from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("send-changelog-mail.py")
spec = importlib.util.spec_from_file_location("send_changelog_mail", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def test_category_for_conventional_commit_subjects() -> None:
    assert module.category_for("feat: add release mails") == "Neue Funktionen"
    assert module.category_for("feat(api): add release mails") == "Neue Funktionen"
    assert module.category_for("fix: repair scheduler overlap") == "Fehlerbehebungen"
    assert module.category_for("fix(scheduler): repair overlap") == "Fehlerbehebungen"
    assert module.category_for("security: rotate tunnel token") == "Sicherheit"
    assert module.category_for("BREAKING CHANGE: rename env var") == "Wichtige Umstellungen"
    assert module.category_for("docs: update Pi guide") == "Dokumentation"
    assert module.category_for("chore: update dependencies") == "Wartung"
    assert module.category_for("improve garden map labels") == "Weitere Änderungen"


def test_format_changelog_groups_changes_in_release_order() -> None:
    commits = [
        module.Commit(sha="aaa111", subject="fix: stop duplicate watering"),
        module.Commit(sha="bbb222", subject="feat: send changelog mails"),
        module.Commit(sha="ccc333", subject="security: tighten remote gate"),
    ]

    changelog = module.format_changelog(
        previous_tag="v1.0.0",
        current_tag="v1.1.0",
        commits=commits,
        compare_url="https://example.test/compare/v1.0.0...v1.1.0",
    )

    assert "SmartGarden Changelog v1.1.0" in changelog
    assert "Vergleich: https://example.test/compare/v1.0.0...v1.1.0" in changelog
    assert changelog.index("Sicherheit") < changelog.index("Neue Funktionen")
    assert changelog.index("Neue Funktionen") < changelog.index("Fehlerbehebungen")
    assert "- security: tighten remote gate (ccc333)" in changelog
    assert "- feat: send changelog mails (bbb222)" in changelog
    assert "- fix: stop duplicate watering (aaa111)" in changelog


def test_format_mail_body_prefers_human_release_notes(tmp_path: Path) -> None:
    release_notes = tmp_path / "VERSION.md"
    release_notes.write_text(
        "# SmartGarden Version v1.1.0\n\n"
        "Kurz gesagt: Die Bewaesserung ist leichter zu ueberwachen.\n\n"
        "## Muss ich etwas tun?\n\n"
        "- Nein.\n",
        encoding="utf-8",
    )

    body = module.format_mail_body(
        previous_tag="v1.0.0",
        current_tag="v1.1.0",
        commits=[module.Commit(sha="aaa111", subject="feat: hidden technical detail")],
        compare_url="https://example.test/compare/v1.0.0...v1.1.0",
        release_notes_path=str(release_notes),
    )

    assert "Kurz gesagt: Die Bewaesserung ist leichter zu ueberwachen." in body
    assert "GitHub-Vergleich: https://example.test/compare/v1.0.0...v1.1.0" in body
    assert "feat: hidden technical detail" not in body
