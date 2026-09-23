"""Release regressions; GitHub writes are always mocked."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import release_skills as release


def item(name, tag="skills-old", **extra):
  return {"name": name, "tag_name": tag, "created_at": "2026-01-01T00:00:00Z",
          "draft": False, "prerelease": False, **extra}


class VersionTests(unittest.TestCase):
  def test_first_and_legacy_releases(self):
    self.assertEqual(release.next_version([], "0.0.1"), "0.0.1")
    self.assertEqual(release.next_version([item("Skills abc123")], "0.0.1"), "0.0.1")

  def test_numeric_max_and_only_skills_versions(self):
    history = [item("Skills v0.0.9"), item("Skills v0.0.123"),
               item("Skills v9.0.0", "app-v9.0.0")]
    self.assertEqual(release.next_version(history, "0.0.1"), "0.0.124")

  def test_manual_bumps_reset_lower_components(self):
    history = [item("Skills v0.0.123")]
    self.assertEqual(release.next_version(history, "0.1.0"), "0.1.0")
    self.assertEqual(release.next_version(history, "1.0.0"), "1.0.0")
    self.assertEqual(release.next_version([item("Skills v1.0.0")], "1.0.0"), "1.0.1")
    self.assertEqual(release.next_version([item("Skills v1.2.999")], "0.0.1"), "1.2.1000")

  def test_invalid_versions_fail_closed(self):
    for value in ["v0.1.0", "01.0.0", "0.1", "-1.0.0", "0.1.0-beta"]:
      with self.subTest(value=value), self.assertRaises(ValueError):
        release.next_version([], value)

  def test_all_release_pages(self):
    pages = [[item("Skills v0.0.9")], [item("Skills v0.0.123")]]
    with patch.object(release, "run", return_value=json.dumps(pages)) as run:
      self.assertEqual(release.next_version(release.list_releases("a/b"), "0.0.1"), "0.0.124")
    self.assertIn("--paginate", run.call_args.args)
    self.assertIn("--slurp", run.call_args.args)


class NotesTests(unittest.TestCase):
  def test_collapsing_boundaries_and_comparison(self):
    for count in [0, 1, 10, 11, 150]:
      with self.subTest(count=count):
        commits = [(f"{n:040x}", f"Commit {n}") for n in range(count)]
        notes = release.release_notes(commits, "https://github.com/a/b", "skills-new", "skills-old")
        visible = notes.split("<details>")[0]
        self.assertEqual(sum(line.startswith("- ") for line in visible.splitlines()), min(10, count))
        self.assertEqual(sum(line.startswith("- ") for line in notes.splitlines()), count)
        self.assertEqual("<summary>Older changes</summary>" in notes, count > 10)
        self.assertIn("/compare/skills-old...skills-new", notes)
        positions = [notes.index(f"- Commit {n} (") for n in range(count)]
        self.assertEqual(positions, sorted(positions))

  def test_first_release_and_untrusted_subject(self):
    notes = release.release_notes([("a" * 40, "</details> [link](url) **bold**")],
                                  "https://github.com/a/b", "skills-new", None)
    self.assertNotIn("</details>", notes)
    self.assertIn("&lt;/details&gt;", notes)
    self.assertIn(r"\[link\]\(url\)", notes)
    self.assertIn("/commits/skills-new", notes)


class PublishTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory()
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name)
    (self.root / "dist/skills").mkdir(parents=True)
    (self.root / "dist/skills/prepdeck.skill").write_bytes(b"fixture")
    (self.root / ".github/scripts").mkdir(parents=True)
    (self.root / ".github/scripts/skills-version.txt").write_text("0.0.1")
    root_patch = patch.object(release, "ROOT", self.root)
    root_patch.start()
    self.addCleanup(root_patch.stop)

  def test_retry_uploads_without_new_version_or_notes(self):
    for name in ["Skills v0.0.42", "Skills abc"]:
      with self.subTest(name=name), patch.object(release, "list_releases", return_value=[item(name, "skills-abc")]), patch.object(release, "run") as run:
        release.publish("a/b", "abc")
        run.assert_called_once_with("gh", "release", "upload", "skills-abc",
                                    str(self.root / "dist/skills/prepdeck.skill"), "--clobber", "--repo", "a/b")

  def test_new_release_uses_file_notes_and_preserves_artifacts(self):
    calls = []

    def capture(*args):
      calls.append(args)
      if args[:3] == ("gh", "release", "create"):
        notes = Path(args[args.index("--notes-file") + 1]).read_text(encoding="utf-8")
        self.assertIn("- Change", notes)
        self.assertIn("/compare/skills-old...skills-abc", notes)
      return ""

    with patch.object(release, "list_releases", return_value=[item("Skills v0.0.99")]), patch.object(release, "previous_tag", return_value="skills-old"), patch.object(release, "commit_lines", return_value=[("a" * 40, "Change")]), patch.object(release, "run", side_effect=capture):
      release.publish("a/b", "abc")
    create = calls[-1]
    self.assertEqual(create[:4], ("gh", "release", "create", "skills-abc"))
    self.assertIn("Skills v0.0.100", create)
    self.assertIn(str(self.root / "dist/skills/prepdeck.skill"), create)
    self.assertNotIn("--generate-notes", create)

  def test_api_failure_does_not_publish(self):
    with patch.object(release, "list_releases", side_effect=RuntimeError("API unavailable")), patch.object(release, "run") as run:
      with self.assertRaises(RuntimeError):
        release.publish("a/b", "abc")
      run.assert_not_called()

  def test_real_git_range_and_previous_release_selection(self):
    def git(*args):
      return subprocess.check_output(["git", *args], cwd=self.root, text=True).strip()

    git("init", "--quiet")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.com")
    for subject in ["Old", "Middle", "Newest"]:
      git("commit", "--quiet", "--allow-empty", "-m", subject)
      git("tag", f"skills-{subject.lower()}")
    history = [item("Skills legacy", "skills-old"),
               item("Skills v0.0.1", "skills-newest", created_at="2026-02-01T00:00:00Z"),
               item("App", "app-new", created_at="2026-03-01T00:00:00Z")]
    self.assertEqual(release.previous_tag(history, "skills-middle"), "skills-old")
    self.assertEqual([s for _, s in release.commit_lines("HEAD", "skills-old")], ["Newest", "Middle"])
    self.assertEqual([s for _, s in release.commit_lines("HEAD", None)], ["Newest", "Middle", "Old"])
    self.assertIsNone(release.previous_tag([item("Draft", draft=True)], "HEAD"))


if __name__ == "__main__":
  unittest.main()
