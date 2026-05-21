#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import smtplib
import subprocess
from dataclasses import dataclass
from email.message import EmailMessage


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
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    commits = list_commits(args.previous_tag, args.current_tag)
    body = format_changelog(args.previous_tag, args.current_tag, commits, args.compare_url)
    subject = f"[SmartGarden Release] {args.current_tag}"

    if args.dry_run:
        print(subject)
        print()
        print(body)
        return

    send_mail(subject, body)


if __name__ == "__main__":
    main()
