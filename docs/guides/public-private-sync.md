# Public source and private deployment

[Documentation index](../README.md)

Generic application development belongs in the public upstream repository.
Deployment configuration, private question banks and personal integrations belong
in the existing private downstream repository. Updates flow **public to private**.
The private repository retains its existing history and is never made public.

## Prepare a reviewable release snapshot

Commit the source changes intended for review. The exporter reads tracked files
from that clean working tree and creates a new directory without `.git`, branches,
tags, reflogs, remotes or historical objects. It does not publish anything:

```bash
npm run oss:export -- --out ../PrepDeck-public-review --repository OWNER/PrepDeck --assets private/export/reviewed-assets.json
```

Use the intended public `OWNER/REPO`, or a clearly marked placeholder while the
destination is still undecided. Add `--private-domain your-private-domain` for
each deployment domain that needs replacement. The exporter derives the private
repository name from `origin`; it rewrites repository links and removes private
issue/PR references only in the exported copy. Original private source comments
and contribution history remain intact.

The exporter excludes secrets/environment files, private directories, generated
state, binary question-bank documents, old screenshots and the deployment-specific
emergency workflow. It preserves safe environment examples. In the exported copy
only, Wrangler production resource IDs, OAuth/Access identifiers, application URL
and sender become placeholders, including matching generated type declarations.
The private deployment configuration and existing deployment command stay intact.
Migration `0002_seed_sap_c02_questions.sql` becomes a numbered no-op: no
restricted question text is copied and the migration sequence stays compatible.
Run `dev:seed` for three original generic examples. Never rewrite an applied
migration in the private deployment.

Every binary asset must appear in a reviewed JSON mapping from repository-relative
path to SHA-256. Review its provenance, visible content, metadata and license before
adding a hash; do not automatically approve every file just because it is an image.
Unknown or changed binary assets stop the export. Do not include private fixtures,
old product screenshots, exam PDFs or user-uploaded material in this allowlist.

A hash approves one exact file, so re-editing or re-exporting an image stops the
export until that file is reviewed again. The downstream's own reviewed
allowlist and the review that produced it are kept in `private/export/`, which
the export excludes; author names and licences agreed for publication belong in
`CREDITS.md`, which it does not.

`public-export-manifest.json` records all copied file hashes and excluded paths.
It deliberately records no private name, domain or resource ID, because the
manifest is published with the snapshot. The scanner therefore re-derives the
export's policy from the private checkout: run it through `npm run` from the
private repository, not from inside the snapshot. It checks that the reviewed
snapshot has not changed, rejects recognizable credential/private-key patterns,
private repository/issue references, private deployment domains and the private
Wrangler resource identifiers, and verifies the no-op seed:

```bash
npm run oss:scan -- --out ../PrepDeck-public-review --private-domain your-private-domain
```

Pass the same `--private-domain` values as the export. Resource identifiers are
not recognizable patterns, so the production D1/KV IDs, Access and OAuth
identifiers, application URL and sender address are detected only by comparison
against the private configuration. A scan that cannot reach that checkout fails
instead of reporting a clean snapshot.

Automated scanning cannot determine copyright ownership or recognize every form
of personal data. Review fixtures, domains, documentation, assets, licenses and
deployment templates in the actual export. Run `npm ci`, the full test suite,
type checks, the web build and local smoke inside that export. Confirm every
production resource ID is a placeholder and configure public vulnerability
reporting before release. Repository links are rewritten to the public
destination, so confirm that every rewritten issue, release, badge and security
link addresses something that will exist there. Record remaining decisions
explicitly.

CI runs `npm run oss:check` against tracked source for recognizable credential and
private-key patterns, alongside export/history/asset-gate regression tests. This
does not approve an asset's license or replace the concrete pre-publication review.

Only after this concrete snapshot is approved, initialize a new repository in
the export directory and make its first commit. Before committing, set a
repository-local public identity: Git records both author and committer email
addresses, even when no source file contains them. Use your GitHub-provided
noreply address from GitHub email settings if your personal address should stay
private; do not copy the private repository's identity automatically.

```bash
git config --local user.name "YOUR_PUBLIC_NAME"
git config --local user.email "YOUR_GITHUB_NOREPLY_ADDRESS"
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

Check the displayed identities before committing (environment variables can
override Git configuration), then inspect `git log -1 --format=fuller` afterward.
If an unpublished initial commit uses a personal address, correct the local
identity and recreate it with `git commit --amend --reset-author --no-edit`.
Check that `git rev-list --all
--count` returns `1` and no remotes exist; rerun the scanner.

The initialized-repository scan rejects staged or unstaged tracked changes and
checks file hashes, credentials, the manifest and the no-op seed directly from
the committed tree. Restoring safe working files without updating the commit
does not make an unsafe commit pass. Ignored local validation artifacts remain
outside the scan.

Create and publish
the separate public repository only after the destination and audited contents
are approved. Never push existing private branches/tags or use a mirror push.
The export helper intentionally has no publish, push or visibility-changing mode.

## Private deployment boundary

Keep private additions in `private/question-bank/`, `private/deployment/` and
`private/integrations/`, or similarly isolated locations. The current private
checkout retains its working production Wrangler configuration and `npm run deploy`
command. No configuration migration is required to adopt local development.

The exported upstream Wrangler file is a template and must be configured before
deployment. When establishing the public/private split, a private downstream may
move real cloud settings to `private/deployment/wrangler.toml`. Adjust paths relative
to that file: `main = "../../apps/worker/src/index.ts"`, assets `directory =
"../../apps/web/dist"`, and `migrations_dir = "../../migrations"`. Preserve real
resource IDs, bindings, production auth settings and sender configuration. Build
shared code and select that configuration explicitly:

```bash
npm run build:prompts --workspace apps/worker
npm run build --workspace apps/web
npx wrangler d1 migrations apply prepdeck --config private/deployment/wrangler.toml --remote
npx wrangler deploy --config private/deployment/wrangler.toml --env=""
```

These commands affect the explicitly configured cloud deployment; they are not
local validation. Update the private CI build/deploy configuration at the same
time, including its migration command, and configure secrets against the selected
Worker. Do not copy placeholders over a working private production configuration.

When a generic fix is needed, implement it from a public checkout. Do not export
or merge private branch commits back to upstream. Any proposed upstream change
from private work needs a separately authored, reviewed public patch without
private context or history.

## Initial connection between unrelated histories

The public first commit intentionally has no private ancestor. After the public
repository exists, configure only the private checkout:

```bash
git remote add upstream https://github.com/PUBLIC_OWNER/PUBLIC_REPO.git
git remote set-url --push upstream DISABLED
git fetch upstream
git switch -c sync/initial-public
git merge --no-ff --no-commit --allow-unrelated-histories upstream/main
```

Replace `main` with the actual public default branch. This initial merge requires
manual review: retain private deployment configuration and data; take the public
versions of generic functionality. Do not resolve every conflict with `--ours` or
`--theirs`. Check migrations by number and semantics, preserving already-applied
private migrations. Run the complete tests and review the final diff, then commit
and open a PR against private `origin`. Merge it only after normal review. This
establishes the shared ancestry used by later public-to-private updates.

## Subsequent upstream updates

From a clean private default branch, run:

```bash
npm run upstream:sync -- main
```

The helper verifies separate remotes and the disabled upstream push URL, fetches
the public branch, creates a new `sync/upstream-<sha>` branch and prepares a merge
without committing. It never pushes or deploys. Review conflicts file by file,
preserve private extensions, run tests, commit and push only to private `origin`
to open a normal PR. Abort an unwanted merge with `git merge --abort`.

An optional future scheduler can open these private PRs, but must use read-only
public access and credentials restricted to the private repository. CI permissions
stay `contents: read` for validation. No workflow should automatically push to
public upstream, merge private synchronization PRs, or deploy them without review.
