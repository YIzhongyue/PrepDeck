"""Exercise validator rejection paths with isolated, synthetic fixtures."""

import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

from validate_skills import ROOT, ValidationError, build_packages, validate_artifacts, validate_sources


class SkillValidationTest(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory()
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name)
    self.skills = self.root / "skills"
    shutil.copytree(ROOT / "skills", self.skills, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    self.output = self.root / "artifacts"

  def validate(self):
    return validate_sources(self.skills, ROOT)

  def test_all_packages_are_self_contained_and_deterministic(self):
    packages = self.validate()
    self.assertTrue({"pdf-to-quiz", "prepdeck", "prepdeck-admin"}.issubset(packages))
    build_packages(packages, self.output)
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.output.iterdir()}
    build_packages(packages, self.output)
    self.assertEqual(before, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.output.iterdir()})
    for path in self.output.iterdir():
      with zipfile.ZipFile(path) as archive:
        self.assertIn(f"{path.stem}/SKILL.md", archive.namelist())
        self.assertTrue(all(name.startswith(f"{path.stem}/") for name in archive.namelist()))

  def test_rejects_source_credentials_without_echoing_secret(self):
    for audience in ["user", "admin"]:
      secret = "pd_mcp_" + audience + "_" + "e" * 64
      path = self.skills / "prepdeck/references/accident.md"
      path.write_text(secret, encoding="utf-8")
      with self.assertRaises(ValidationError) as caught:
        self.validate()
      self.assertNotIn(secret, str(caught.exception))
      self.assertIn("credential", str(caught.exception))
      path.unlink()

  def test_generated_archive_cannot_bypass_source_scan(self):
    packages = self.validate()
    build_packages(packages, self.output)
    target = self.output / "prepdeck.skill"
    with zipfile.ZipFile(target) as archive:
      content = {name: archive.read(name) for name in archive.namelist()}
    content["prepdeck/SKILL.md"] += ("\npd_mcp_" + "user_" + "a" * 64).encode()
    with zipfile.ZipFile(target, "w") as archive:
      for name, data in content.items():
        archive.writestr(name, data)
    with self.assertRaisesRegex(ValidationError, "credential"):
      validate_artifacts(packages, self.output)

  def test_artifact_inventory_rejects_unexpected_files(self):
    packages = self.validate()
    build_packages(packages, self.output)
    with zipfile.ZipFile(self.output / "prepdeck.skill", "a") as archive:
      archive.writestr("prepdeck/generated.log", "unexpected")
    with self.assertRaisesRegex(ValidationError, "Unexpected artifact files"):
      validate_artifacts(packages, self.output)

  def test_broken_and_escaping_relative_links_fail(self):
    path = self.skills / "prepdeck/references/accident.md"
    for target in ["absent.md", "../../prepdeck-admin/SKILL.md"]:
      path.write_text(f"[reference]({target})", encoding="utf-8")
      with self.assertRaises(ValidationError):
        self.validate()

  def test_unknown_tools_and_cross_audience_tools_fail(self):
    path = self.skills / "prepdeck/references/accident.md"
    for tool in ["user_invented_capability", "admin_get_identity"]:
      path.write_text(f"Use `{tool}`.", encoding="utf-8")
      with self.assertRaisesRegex(ValidationError, "Unknown or wrong-audience tool"):
        self.validate()

  def test_swapped_endpoint_and_credential_fail(self):
    path = self.skills / "prepdeck/references/connection.json"
    original = json.loads(path.read_text(encoding="utf-8"))
    for key, value in [("endpointPath", "/admin-mcp"), ("tokenEnvVar", "PREPDECK_ADMIN_MCP_TOKEN")]:
      path.write_text(json.dumps({**original, key: value}), encoding="utf-8")
      with self.assertRaisesRegex(ValidationError, "audience/endpoint/credential mismatch"):
        self.validate()

  def test_malformed_front_matter_and_metadata_fail(self):
    for relative in ["SKILL.md", "agents/openai.yaml"]:
      path = self.skills / "prepdeck" / relative
      original = path.read_bytes()
      path.write_text("---\nname: [\n---\n" if relative == "SKILL.md" else "interface: [", encoding="utf-8")
      with self.assertRaises(ValidationError):
        self.validate()
      path.write_bytes(original)

  def test_maintained_examples_reject_swapped_audiences_and_insecure_inputs(self):
    paths = [self.skills / name / "references/credentials.md" for name in ["prepdeck", "prepdeck-admin"]]
    original = paths[0].read_text(encoding="utf-8")
    for old, new in [
      ('<PREPDECK_ORIGIN>/mcp', '<PREPDECK_ORIGIN>/admin-mcp'),
      ('bearer_token_env_var = "PREPDECK_USER_MCP_TOKEN"', 'bearer_token_env_var = "PREPDECK_ADMIN_MCP_TOKEN"'),
      ('Bearer ${PREPDECK_USER_MCP_TOKEN}', 'Bearer ${PREPDECK_ADMIN_MCP_TOKEN}'),
      ('Bearer ${input:prepdeck-user-token}', 'Bearer ${input:prepdeck-admin-token}'),
      ('"password": true', '"password": false'),
    ]:
      with self.subTest(replacement=new):
        # Both shared copies are corrupted identically: equality alone must
        # not bypass the endpoint/credential tuple check.
        for path in paths:
          path.write_text(original.replace(old, new), encoding="utf-8")
        with self.assertRaises(ValidationError):
          self.validate()
    for path in paths:
      path.write_text(original, encoding="utf-8")

  def test_safe_placeholders_remain_allowed_and_future_skills_package_generically(self):
    folder = self.skills / "future-skill"
    folder.mkdir()
    (folder / "SKILL.md").write_text("---\nname: future-skill\ndescription: A future self-contained Skill.\n---\nUse PREPDECK_USER_MCP_TOKEN or <PREPDECK_ADMIN_MCP_TOKEN> placeholders.\n", encoding="utf-8")
    packages = self.validate()
    build_packages(packages, self.output)
    self.assertTrue((self.output / "future-skill.skill").is_file())


if __name__ == "__main__":
  unittest.main()
