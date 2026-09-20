#!/usr/bin/env python3
"""Validate self-contained Skills and build/inspect deterministic .skill ZIPs."""

import argparse
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tomllib
import zipfile

import yaml


ROOT = Path(__file__).resolve().parents[2]
SECRET = re.compile(rb"pd_mcp_(?:user|admin)_[a-z0-9_-]{32,}", re.I)
TOOL = re.compile(r"\b(?:user|admin)_(?:[a-z0-9]+_)+[a-z0-9]+\b")
REGISTERED = re.compile(r'defineMcpTool\(\s*["\']((?:user|admin)_[a-z0-9_]+)["\']')
ALLOWED_DIRS = {"agents", "references", "scripts", "assets"}
ALLOWED_EXTENSIONS = {".md", ".yaml", ".yml", ".json", ".py", ".mjs", ".js", ".ts", ".sh", ".txt", ".toml"}
CONNECTIONS = {
  "user": {"audience": "user", "connectionName": "prepdeck", "serverName": "prepdeck-user-mcp", "endpointPath": "/mcp", "tokenEnvVar": "PREPDECK_USER_MCP_TOKEN", "identityTool": "user_get_identity"},
  "admin": {"audience": "admin", "connectionName": "prepdeck-admin", "serverName": "prepdeck-admin-mcp", "endpointPath": "/admin-mcp", "tokenEnvVar": "PREPDECK_ADMIN_MCP_TOKEN", "identityTool": "admin_get_identity"},
}


class ValidationError(ValueError):
  pass


def require(condition, message):
  if not condition:
    raise ValidationError(message)


def scan_secret(data, label):
  # Never include matched values or file contents in diagnostics.
  require(not SECRET.search(data), f"Likely MCP credential in {label}")


def load_yaml(text, label):
  try:
    data = yaml.safe_load(text)
  except yaml.YAMLError:
    raise ValidationError(f"Invalid YAML in {label}") from None
  require(isinstance(data, dict), f"Expected YAML mapping in {label}")
  return data


def check_links(path, text, directory):
  # Markdown inline links/images and reference-style definitions.
  links = re.findall(r"\]\(([^\s)]+)(?:\s+[^)]*)?\)", text)
  links += re.findall(r"^\s*\[[^\]]+\]:\s*(\S+)", text, re.M)
  for link in links:
    link = link.strip("<>").split("#", 1)[0]
    if not link or re.match(r"^[a-z][a-z0-9+.-]*:", link, re.I):
      continue
    target = (path.parent / link).resolve()
    require(target.is_relative_to(directory.resolve()), f"Reference escapes package: {path.relative_to(directory)}")
    require(target.is_file(), f"Missing relative reference in {path.relative_to(directory)}: {link}")


def validate_credential_examples(text, label):
  examples = re.findall(r"^```(json|toml)\r?\n(.*?)^```", text, re.M | re.S)
  require(len(examples) == 3, f"Missing maintained credential examples in {label}")
  for language, source in examples:
    try:
      config = tomllib.loads(source) if language == "toml" else json.loads(source)
    except ValueError:
      raise ValidationError(f"Invalid credential configuration example in {label}") from None
    servers = config.get("mcp_servers", config.get("mcpServers", config.get("servers", {})))
    require(isinstance(servers, dict) and servers, f"Missing MCP connections in {label}")
    for name, server in servers.items():
      audience = next((value for value in CONNECTIONS.values() if value["connectionName"] == name), None)
      require(audience is not None and isinstance(server, dict), f"Unknown MCP connection in {label}")
      require(server.get("url") == f'<PREPDECK_ORIGIN>{audience["endpointPath"]}', f"Wrong endpoint in credential example: {label}")
      if language == "toml":
        require(server.get("bearer_token_env_var") == audience["tokenEnvVar"], f"Wrong credential variable in example: {label}")
      else:
        require(server.get("type") == "http", f"Wrong transport in credential example: {label}")
        if "inputs" in config:
          input_id = f'prepdeck-{audience["audience"]}-token'
          inputs = [item for item in config["inputs"] if item.get("id") == input_id]
          require(len(inputs) == 1 and inputs[0].get("password") is True and inputs[0].get("type") == "promptString", f"Missing secure audience input in {label}")
          authorization = f"Bearer ${{input:{input_id}}}"
        else:
          authorization = f'Bearer ${{{audience["tokenEnvVar"]}}}'
        require(server.get("headers", {}).get("Authorization") == authorization, f"Wrong credential header in example: {label}")


def validate_skill(directory, catalogs):
  require((directory / "SKILL.md").is_file(), f"Missing SKILL.md in {directory.name}")
  files = {}
  for path in sorted(directory.rglob("*")):
    rel = path.relative_to(directory)
    require(not path.is_symlink(), f"Symlink is not a package file: {directory.name}/{rel}")
    if "__pycache__" in rel.parts or path.suffix == ".pyc":
      continue
    if path.is_dir():
      continue
    require(not any(part.startswith(".") for part in rel.parts), f"Hidden file in {directory.name}/{rel}")
    require(rel.as_posix() == "SKILL.md" or (len(rel.parts) > 1 and rel.parts[0] in ALLOWED_DIRS), f"Unexpected package file: {directory.name}/{rel}")
    require(rel.parts[0] == "assets" or path.suffix in ALLOWED_EXTENSIONS, f"Unexpected file type: {directory.name}/{rel}")
    data = path.read_bytes()
    scan_secret(data, f"{directory.name}/{rel}")
    files[f"{directory.name}/{rel.as_posix()}"] = data
    if path.suffix == ".md":
      check_links(path, data.decode("utf-8"), directory)
    if rel.parts[0] == "agents" and path.suffix in {".yaml", ".yml"}:
      metadata = load_yaml(data.decode("utf-8"), f"{directory.name}/{rel}")
      if path.name == "openai.yaml":
        interface = metadata.get("interface", {})
        require(isinstance(interface, dict), f"Invalid interface in {directory.name}/{rel}")
        for key in ["display_name", "short_description", "default_prompt"]:
          require(isinstance(interface.get(key), str) and interface[key].strip(), f"Missing {key} in {directory.name}/{rel}")
        require(f"${directory.name}" in interface["default_prompt"], f"Incorrect default_prompt in {directory.name}/{rel}")
        require(25 <= len(interface["short_description"]) <= 64, f"Invalid short_description length in {directory.name}/{rel}")

  skill = (directory / "SKILL.md").read_text(encoding="utf-8")
  match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", skill, re.S)
  require(match, f"Missing front matter in {directory.name}")
  front = load_yaml(match[1], f"{directory.name}/SKILL.md")
  require(front.get("name") == directory.name and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", directory.name), f"Invalid Skill name in {directory.name}")
  require(len(directory.name) <= 64, f"Skill name too long: {directory.name}")
  require(isinstance(front.get("description"), str) and bool(front["description"].strip()), f"Missing description in {directory.name}")

  connection_path = directory / "references/connection.json"
  if connection_path.exists():
    try:
      connection = json.loads(connection_path.read_text(encoding="utf-8"))
    except ValueError:
      raise ValidationError(f"Invalid connection JSON in {directory.name}") from None
    audience = connection.get("audience")
    require(audience in CONNECTIONS and connection == CONNECTIONS[audience], f"MCP audience/endpoint/credential mismatch in {directory.name}")
    require(directory.name == connection["connectionName"], f"MCP Skill name mismatch in {directory.name}")
    if audience == "admin":
      require("Admin" in load_yaml((directory / "agents/openai.yaml").read_text(encoding="utf-8"), directory.name)["interface"]["display_name"], "Admin metadata must state its privilege")
    for name, data in files.items():
      if name.endswith((".md", ".json", ".yaml")):
        text = data.decode("utf-8")
        for tool in TOOL.findall(text):
          require(tool in catalogs[audience], f"Unknown or wrong-audience tool in {name}: {tool}")
        if name.endswith("/credentials.md"):
          validate_credential_examples(text, name)
        else:
          other = CONNECTIONS["admin" if audience == "user" else "user"]
          require(other["tokenEnvVar"] not in text, f"Wrong credential variable in {name}")
          require(f'<PREPDECK_ORIGIN>{other["endpointPath"]}' not in text, f"Wrong endpoint in {name}")
  return files


def validate_sources(skills_dir, root):
  catalogs = {}
  for audience in CONNECTIONS:
    path = root / f"apps/worker/src/mcp/{audience}/server.ts"
    catalogs[audience] = set(REGISTERED.findall(path.read_text(encoding="utf-8")))
    require(catalogs[audience], f"No {audience} registrations found; update catalog extraction")
  directories = sorted(p for p in skills_dir.iterdir() if p.is_dir())
  require(directories, "No Skills found")
  packages = {directory.name: validate_skill(directory, catalogs) for directory in directories}
  # Independently installable packages carry the exact same credential policy.
  policies = [skills_dir / name / "references/credentials.md" for name in ["prepdeck", "prepdeck-admin"]]
  if all(p.exists() for p in policies):
    require(policies[0].read_bytes() == policies[1].read_bytes(), "Shared credential policies differ")
  return packages


def build_packages(packages, output):
  output.mkdir(parents=True, exist_ok=True)
  require(not any(p.suffix == ".skill" and p.stem not in packages for p in output.iterdir()), "Unexpected stale .skill artifact in output directory")
  for name, files in packages.items():
    with zipfile.ZipFile(output / f"{name}.skill", "w", compression=zipfile.ZIP_DEFLATED) as archive:
      for path, data in sorted(files.items()):
        info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | 0o644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, data)
  validate_artifacts(packages, output)


def validate_artifacts(packages, output):
  require({p.stem for p in output.glob("*.skill")} == set(packages), "Missing or unexpected .skill artifacts")
  for name, files in packages.items():
    with zipfile.ZipFile(output / f"{name}.skill") as archive:
      names = archive.namelist()
      require(len(names) == len(set(names)) and set(names) == set(files), f"Unexpected artifact files in {name}.skill")
      for path in names:
        require(not PurePosixPath(path).is_absolute() and ".." not in PurePosixPath(path).parts, f"Unsafe artifact path in {name}.skill")
        data = archive.read(path)
        scan_secret(data, f"{name}.skill/{path}")
        require(data == files[path], f"Artifact differs from validated source: {name}.skill/{path}")


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--skills-dir", type=Path, default=ROOT / "skills")
  parser.add_argument("--root", type=Path, default=ROOT)
  parser.add_argument("--package-output", type=Path)
  parser.add_argument("--artifacts", type=Path)
  args = parser.parse_args()
  try:
    packages = validate_sources(args.skills_dir, args.root)
    if args.package_output:
      build_packages(packages, args.package_output)
    if args.artifacts:
      validate_artifacts(packages, args.artifacts)
  except (ValidationError, OSError, zipfile.BadZipFile, UnicodeError) as error:
    print(f"Skill validation failed: {error}", file=sys.stderr)
    return 1
  print(f"Validated {len(packages)} Skills" + (" and packaged artifacts" if args.package_output or args.artifacts else ""))
  return 0


if __name__ == "__main__":
  sys.exit(main())
