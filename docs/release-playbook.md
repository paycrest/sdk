# Release Playbook (v2 Sender SDK)

This monorepo is the source-of-truth for all Paycrest Sender SDK v2 language clients.

## Versioning policy

- Monorepo release train tracks API line: `v2.x.y`
- SDK language packages can patch independently for ecosystem fixes.
- Any wire-level behavior changes must be reflected in `specs/sender-v2.openapi.yaml` first.

## Preconditions

1. `bazel test //...` passes.
2. Changelog updates are merged.
3. Release notes include API compatibility and migration notes.

## TypeScript repository deployment

Target repo: `paycrest/sdk-typescript` (or your chosen public package repo)

1. Run `./scripts/release/release_typescript.sh <version>`
2. Push git tag `typescript-v<version>` in this monorepo.
3. Mirror `sdks/typescript` subtree to `paycrest/sdk-typescript`.

## Python repository deployment

Target repo: `paycrest/sdk-python`

1. Run `./scripts/release/release_python.sh <version>`
2. Push git tag `python-v<version>`.
3. Mirror subtree `sdks/python` to dedicated repository.

## Go repository deployment

Target repo: `paycrest/sdk-go`

1. Ensure module path remains `github.com/paycrest/sdk-go`.
2. Tag with semver in Go repository (e.g. `v2.1.0`).
3. Mirror subtree `sdks/go` and create release tag.

## Rust repository deployment

Target repo: `paycrest/sdk-rust`

1. Run `./scripts/release/release_rust.sh <version>`
2. Push tag `rust-v<version>`.
3. Mirror `sdks/rust` subtree to dedicated repository.

## Laravel repository deployment

Target repo: `paycrest/sdk-laravel`

1. Update `composer.json` version via tag.
2. Run `./scripts/release/release_laravel.sh <version>`.
3. Mirror `sdks/laravel` subtree and create tag `v<version>`.
4. Trigger Packagist update webhook (if not auto-synced).

## Cut a coordinated multi-language release

```bash
./scripts/release/release_all.sh 2.0.0
```

Then mirror each language subtree to its public repository and publish.
