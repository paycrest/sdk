# Release Playbook (Paycrest SDK)

This monorepo is the source-of-truth for all Paycrest SDK language clients.

## Versioning policy

- Monorepo release train uses semantic versioning.
- SDK language packages can patch independently for ecosystem fixes.
- Any wire-level behavior changes must be reflected in `specs/openapi.yaml` first.

## Preconditions

1. `bazel test //...` passes.
2. Changelog updates are merged.
3. Release notes include API compatibility and migration notes.
4. Run release scripts from a clean `main` working tree.
5. Use dry-run mode first (`--dry-run`, default) and only publish with `--publish`.
6. Optional but recommended: run live integration validation with sandbox keys:
   `./scripts/tests/run_all_integration.sh`

## TypeScript repository deployment

Target repo: `paycrest/sdk-typescript` (or your chosen public package repo)

1. Run `./scripts/release/release_typescript.sh <version> --dry-run`
2. Publish with `RELEASE_CONFIRM=YES ./scripts/release/release_typescript.sh <version> --publish` when ready.
3. Push git tag `typescript-v<version>` in this monorepo.
4. Mirror `sdks/typescript` subtree to `paycrest/sdk-typescript`.

## Python repository deployment

Target repo: `paycrest/sdk-python`

1. Run `./scripts/release/release_python.sh <version> --dry-run`
2. Publish with `RELEASE_CONFIRM=YES ./scripts/release/release_python.sh <version> --publish` when ready.
3. Push git tag `python-v<version>`.
4. Mirror subtree `sdks/python` to dedicated repository.

## Go repository deployment

Target repo: `paycrest/sdk-go`

1. Ensure module path remains `github.com/paycrest/sdk-go`.
2. Run `./scripts/release/release_go.sh <version> --dry-run` to validate smoke/tests.
3. Publish mode (`RELEASE_CONFIRM=YES ./scripts/release/release_go.sh <version> --publish`) validates again and prints operator steps since Go module release happens by tagging the target repository.
4. Tag with semver in Go repository (e.g. `v1.2.0`).
5. Mirror subtree `sdks/go` and create release tag.

## Rust repository deployment

Target repo: `paycrest/sdk-rust`

1. Run `./scripts/release/release_rust.sh <version> --dry-run`
2. Publish with `RELEASE_CONFIRM=YES ./scripts/release/release_rust.sh <version> --publish` when ready.
3. Push tag `rust-v<version>`.
4. Mirror `sdks/rust` subtree to dedicated repository.

## Laravel repository deployment

Target repo: `paycrest/sdk-laravel`

1. Run `./scripts/release/release_laravel.sh <version> --dry-run`
2. Publish mode (`RELEASE_CONFIRM=YES ./scripts/release/release_laravel.sh <version> --publish`) validates contracts and prints the operator steps for tag + Packagist sync.
3. Mirror `sdks/laravel` subtree and create tag `v<version>`.
4. Trigger Packagist update webhook (if not auto-synced).

## Cut a coordinated multi-language release

```bash
./scripts/release/release_all.sh 2.0.0 --dry-run
RELEASE_CONFIRM=YES ./scripts/release/release_all.sh 2.0.0 --publish
```

Then mirror each language subtree to its public repository and publish.

## Registry publish workflows (GitHub Actions)

This repository now includes manual publish workflows per registry:

- `.github/workflows/publish-typescript.yml` (npm)
- `.github/workflows/publish-python.yml` (PyPI)
- `.github/workflows/publish-rust.yml` (crates.io)
- `.github/workflows/publish-laravel.yml` (tag + optional Packagist ping)

All publish workflows:

- run only via `workflow_dispatch`,
- support explicit dry-run/publish toggles,
- run validation checks before publish,
- require publish confirmation (`RELEASE_CONFIRM=YES`) for publish mode,
- validate the requested version against package manifests.

### Required repository secrets

- `NPM_TOKEN` for npm publish
- `PYPI_API_TOKEN` for PyPI publish
- `CRATES_IO_TOKEN` for crates.io publish
- `PACKAGIST_WEBHOOK_URL` (optional) for Packagist refresh webhook
