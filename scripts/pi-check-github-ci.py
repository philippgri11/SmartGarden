#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request


SUCCESS_CONCLUSIONS = {"success", "skipped", "neutral"}


def get_json(url: str) -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "smartgarden-pi-deployer",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def check_ci(repo: str, sha: str) -> tuple[bool, str]:
    runs_url = f"https://api.github.com/repos/{repo}/commits/{sha}/check-runs?per_page=100"
    status_url = f"https://api.github.com/repos/{repo}/commits/{sha}/status"
    runs = get_json(runs_url).get("check_runs", [])
    statuses = get_json(status_url)

    failures: list[str] = []
    pending: list[str] = []
    successes: list[str] = []

    for run in runs:
        name = run.get("name", "unnamed check")
        status = run.get("status")
        conclusion = run.get("conclusion")
        if status != "completed":
            pending.append(f"{name}: {status}")
        elif conclusion in SUCCESS_CONCLUSIONS:
            successes.append(f"{name}: {conclusion}")
        else:
            failures.append(f"{name}: {conclusion}")

    for status in statuses.get("statuses", []):
        context = status.get("context", "status")
        state = status.get("state")
        if state == "success":
            successes.append(f"{context}: success")
        elif state in {"pending", "expected"}:
            pending.append(f"{context}: {state}")
        else:
            failures.append(f"{context}: {state}")

    if failures:
        return False, "CI failed: " + "; ".join(failures)
    if pending:
        return False, "CI pending: " + "; ".join(pending)
    if not successes:
        return False, "No CI checks found for commit."
    return True, "CI green: " + "; ".join(successes)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check GitHub CI state for a commit before deploying on the Pi.")
    parser.add_argument("--repo", required=True, help="GitHub repo in owner/name form.")
    parser.add_argument("--sha", required=True, help="Commit SHA to check.")
    parser.add_argument("--wait", action="store_true", help="Wait until CI is green or failed.")
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    parser.add_argument("--poll-seconds", type=int, default=20)
    args = parser.parse_args()

    deadline = time.monotonic() + args.timeout_seconds
    last_message = ""
    while True:
        try:
            ok, message = check_ci(args.repo, args.sha)
        except urllib.error.HTTPError as exc:
            print(f"GitHub API error: {exc}", file=sys.stderr)
            return 2
        if message != last_message:
            print(message, flush=True)
            last_message = message
        if ok:
            return 0
        if not args.wait or message.startswith("CI failed"):
            return 1
        if time.monotonic() >= deadline:
            print("Timed out waiting for CI.", file=sys.stderr)
            return 1
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
