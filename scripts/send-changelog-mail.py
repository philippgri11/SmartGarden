#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import os
import re
import smtplib
import subprocess
from dataclasses import dataclass
from email.message import EmailMessage
from pathlib import Path


@dataclass(frozen=True)
class Commit:
    sha: str
    subject: str


def run_git(args: list[str]) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def list_commits(previous_tag: str, current_tag: str) -> list[Commit]:
    output = run_git(["log", f"{previous_tag}..{current_tag}", "--pretty=format:%h%x09%s"])
    commits: list[Commit] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        sha, subject = line.split("\t", 1)
        commits.append(Commit(sha=sha, subject=subject))
    return commits


def category_for(subject: str) -> str:
    normalized = subject.lower()
    if "breaking change" in normalized or normalized.startswith(("breaking:", "!:")):
        return "Wichtige Umstellungen"
    prefix_match = re.match(r"^(?P<prefix>[a-z]+)(?:\([^)]+\))?!?:", normalized)
    prefix = prefix_match.group("prefix") if prefix_match else ""
    if prefix in {"security", "sec"}:
        return "Sicherheit"
    if prefix in {"feat", "feature"}:
        return "Neue Funktionen"
    if prefix in {"fix", "bugfix"}:
        return "Fehlerbehebungen"
    if prefix in {"perf", "performance"}:
        return "Performance"
    if prefix in {"docs", "doc"}:
        return "Dokumentation"
    if prefix in {"test", "tests"}:
        return "Tests"
    if prefix in {"chore", "ci", "build", "refactor"}:
        return "Wartung"
    return "Weitere Änderungen"


def format_changelog(previous_tag: str, current_tag: str, commits: list[Commit], compare_url: str | None) -> str:
    lines = [
        f"SmartGarden Changelog {current_tag}",
        "",
        f"Zeitraum: {previous_tag} .. {current_tag}",
    ]
    if compare_url:
        lines.extend(["", f"Vergleich: {compare_url}"])
    if not commits:
        lines.extend(["", "Keine Commits im Vergleichsbereich gefunden."])
        return "\n".join(lines)

    categorized: dict[str, list[Commit]] = {}
    for commit in commits:
        categorized.setdefault(category_for(commit.subject), []).append(commit)

    order = [
        "Wichtige Umstellungen",
        "Sicherheit",
        "Neue Funktionen",
        "Fehlerbehebungen",
        "Performance",
        "Dokumentation",
        "Tests",
        "Wartung",
        "Weitere Änderungen",
    ]
    for category in order:
        entries = categorized.get(category, [])
        if not entries:
            continue
        lines.extend(["", category])
        lines.append("-" * len(category))
        for commit in entries:
            lines.append(f"- {commit.subject} ({commit.sha})")
    return "\n".join(lines)


def load_release_notes(path: str | None) -> str | None:
    if not path:
        return None
    release_notes = Path(path)
    if not release_notes.exists():
        raise FileNotFoundError(f"Release notes file not found: {path}")
    content = release_notes.read_text(encoding="utf-8").strip()
    return content or None


def format_mail_body(
    *,
    previous_tag: str,
    current_tag: str,
    commits: list[Commit],
    compare_url: str | None,
    release_notes_path: str | None,
) -> str:
    release_notes = load_release_notes(release_notes_path)
    if release_notes:
        lines = [
            release_notes,
            "",
            "---",
            "",
            f"Technische Einordnung: {previous_tag} .. {current_tag}",
        ]
        if compare_url:
            lines.append(f"GitHub-Vergleich: {compare_url}")
        lines.extend([
            "",
            "Diese Mail wurde automatisch verschickt, nachdem die Version als Git-Tag markiert wurde.",
        ])
        return "\n".join(lines)
    return format_changelog(previous_tag, current_tag, commits, compare_url)


def inline_markdown_to_html(text: str) -> str:
    escaped = html.escape(text)
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<a href="\2">\1</a>', escaped)
    return escaped


def markdown_to_html(markdown: str) -> str:
    body: list[str] = []
    in_list = False

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            body.append("</ul>")
            in_list = False

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            close_list()
            continue
        if line == "---":
            close_list()
            body.append("<hr>")
            continue
        if line.startswith("# "):
            close_list()
            body.append(f"<h1>{inline_markdown_to_html(line[2:].strip())}</h1>")
            continue
        if line.startswith("## "):
            close_list()
            body.append(f"<h2>{inline_markdown_to_html(line[3:].strip())}</h2>")
            continue
        if line.startswith("### "):
            close_list()
            body.append(f"<h3>{inline_markdown_to_html(line[4:].strip())}</h3>")
            continue
        if line.startswith("- "):
            if not in_list:
                body.append("<ul>")
                in_list = True
            body.append(f"<li>{inline_markdown_to_html(line[2:].strip())}</li>")
            continue
        close_list()
        body.append(f"<p>{inline_markdown_to_html(line)}</p>")
    close_list()

    content = "\n".join(body)
    return f"""<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <style>
      body {{
        margin: 0;
        padding: 24px;
        background: #f6faf3;
        color: #1d2b20;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.55;
      }}
      .mail {{
        max-width: 680px;
        margin: 0 auto;
        padding: 28px;
        border: 1px solid #dce8d6;
        border-radius: 12px;
        background: #ffffff;
      }}
      h1 {{
        margin: 0 0 14px;
        color: #164f34;
        font-size: 26px;
        line-height: 1.2;
      }}
      h2 {{
        margin: 26px 0 10px;
        color: #1f7a4d;
        font-size: 18px;
      }}
      h3 {{
        margin: 22px 0 8px;
        font-size: 16px;
      }}
      p {{
        margin: 0 0 14px;
      }}
      ul {{
        margin: 0 0 16px;
        padding-left: 22px;
      }}
      li {{
        margin: 7px 0;
      }}
      code {{
        padding: 2px 5px;
        border-radius: 5px;
        background: #eef5ea;
      }}
      a {{
        color: #1f7a4d;
      }}
      hr {{
        margin: 28px 0;
        border: 0;
        border-top: 1px solid #dce8d6;
      }}
    </style>
  </head>
  <body>
    <div class="mail">
      {content}
    </div>
  </body>
</html>"""


def recipients_from_env() -> list[str]:
    raw = os.environ.get("CHANGELOG_RECIPIENTS") or os.environ.get("WATCHDOG_ALERT_RECIPIENTS") or ""
    return [item.strip() for item in raw.split(",") if item.strip()]


def send_mail(subject: str, body: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    username = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")
    sender = os.environ["SMTP_FROM"]
    recipients = recipients_from_env()
    if not recipients:
        raise RuntimeError("CHANGELOG_RECIPIENTS or WATCHDOG_ALERT_RECIPIENTS must contain at least one recipient")

    email = EmailMessage()
    email["From"] = sender
    email["To"] = ", ".join(recipients)
    email["Subject"] = subject
    email.set_content(body)
    email.add_alternative(markdown_to_html(body), subtype="html")

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.starttls()
        if username:
            smtp.login(username, password or "")
        smtp.send_message(email)


def main() -> None:
    parser = argparse.ArgumentParser(description="Send SmartGarden release changelog mail for a Git tag.")
    parser.add_argument("--previous-tag", required=True)
    parser.add_argument("--current-tag", required=True)
    parser.add_argument("--compare-url")
    parser.add_argument("--release-notes", default="VERSION.md")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    commits = list_commits(args.previous_tag, args.current_tag)
    body = format_mail_body(
        previous_tag=args.previous_tag,
        current_tag=args.current_tag,
        commits=commits,
        compare_url=args.compare_url,
        release_notes_path=args.release_notes,
    )
    subject = f"[SmartGarden] Neue Version {args.current_tag}"

    if args.dry_run:
        print(subject)
        print()
        print(body)
        return

    send_mail(subject, body)


if __name__ == "__main__":
    main()
