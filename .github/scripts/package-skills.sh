#!/usr/bin/env bash

set -euo pipefail

skills_dir="${1:-skills}"
output_dir="${2:-dist/skills}"

if [[ ! -d "$skills_dir" ]]; then
  printf 'Skills directory does not exist: %s\n' "$skills_dir" >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The validator also constructs deterministic archives from its validated file
# inventory and inspects their contents. It never recursively deletes output.
python3 "$script_dir/validate_skills.py" --skills-dir "$skills_dir" --package-output "$output_dir"
