"""Publish Skills with numbered titles and compact, complete commit notes."""

import html
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def run(*args):
  return subprocess.check_output(args, cwd=ROOT, text=True, encoding="utf-8").strip()


def parse_version(value):
  if not VERSION.fullmatch(value):
    raise ValueError(f"Invalid Skills version: {value!r}")
  return tuple(map(int, value.split(".")))


def next_version(releases, baseline):
  floor = parse_version(baseline)
  versions = []
  for release in releases:
    name = release.get("name") or ""
    if release["tag_name"].startswith("skills-") and name.startswith("Skills v"):
      versions.append(parse_version(name.removeprefix("Skills v")))
  if versions:
    major, minor, patch = max(versions)
    floor = max(floor, (major, minor, patch + 1))
  return ".".join(map(str, floor))


def list_releases(repo):
  # --slurp preserves each page as a separate array, including empty results.
  pages = json.loads(run("gh", "api", "--paginate", "--slurp",
                         f"repos/{repo}/releases?per_page=100"))
  return [release for page in pages for release in page]


def previous_tag(releases, sha):
  candidates = sorted(
    (r for r in releases if r["tag_name"].startswith("skills-")
     and not r.get("draft") and not r.get("prerelease")),
    key=lambda r: r["created_at"], reverse=True)
  for release in candidates:
    tag = release["tag_name"]
    # A queued older workflow must not compare against a later commit.
    result = subprocess.run(
      ["git", "merge-base", "--is-ancestor", f"refs/tags/{tag}", sha], cwd=ROOT)
    if result.returncode == 0:
      return tag
    if result.returncode != 1:
      raise RuntimeError(f"Cannot resolve previous Skills tag: {tag}")
  return None


def commit_lines(sha, previous):
  revision = f"refs/tags/{previous}..{sha}" if previous else sha
  output = run("git", "log", "--date-order", "--format=%H%x09%s", revision, "--")
  return [line.split("\t", 1) for line in output.splitlines() if line]


def release_notes(commits, repo_url, tag, previous):
  lines = []
  for sha, subject in commits:
    # Commit text is data: escape HTML and Markdown so it cannot break details.
    subject = html.escape(subject, quote=False)
    subject = re.sub(r"([\\`*_{}\[\]()#+.!|>~-])", r"\\\1", subject)
    lines.append(f"- {subject} ([{sha[:12]}]({repo_url}/commit/{sha}))")
  body = "## What's Changed\n\n" + "\n".join(lines[:10])
  if len(lines) > 10:
    body += "\n\n<details>\n<summary>Older changes</summary>\n\n"
    body += "\n".join(lines[10:]) + "\n\n</details>"
  url = (f"{repo_url}/compare/{previous}...{tag}" if previous
         else f"{repo_url}/commits/{tag}")
  return body + f"\n\n**Full Changelog**: {url}\n"


def publish(repo, sha):
  tag = f"skills-{sha}"
  artifacts = sorted(str(path) for path in (ROOT / "dist/skills").glob("*.skill"))
  if not artifacts:
    raise RuntimeError("No .skill artifacts found")
  releases = list_releases(repo)
  if any(r["tag_name"] == tag for r in releases):
    # Keep the version and notes stable when retrying a partially uploaded release.
    run("gh", "release", "upload", tag, *artifacts, "--clobber", "--repo", repo)
    return
  baseline = (ROOT / ".github/scripts/skills-version.txt").read_text().strip()
  title = f"Skills v{next_version(releases, baseline)}"
  # Include tags published since checkout while packaging was running.
  run("git", "fetch", "origin", "--tags")
  previous = previous_tag(releases, sha)
  repo_url = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{repo}"
  notes = release_notes(commit_lines(sha, previous), repo_url, tag, previous)
  with tempfile.TemporaryDirectory() as directory:
    notes_file = Path(directory) / "notes.md"
    notes_file.write_text(notes, encoding="utf-8")
    run("gh", "release", "create", tag, *artifacts, "--repo", repo,
        "--target", sha, "--title", title, "--notes-file", str(notes_file))


if __name__ == "__main__":
  publish(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_SHA"])
