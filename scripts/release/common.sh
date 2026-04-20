#!/usr/bin/env bash

semver_regex='^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$'

release_mode_from_arg() {
    case "${1:-}" in
        ""|"--dry-run")
            echo "dry-run"
            ;;
        "--publish")
            echo "publish"
            ;;
        *)
            echo "Unsupported release mode: ${1}" >&2
            echo "Expected --dry-run or --publish." >&2
            return 1
            ;;
    esac
}

require_semver() {
    local version="$1"
    if [[ ! "$version" =~ $semver_regex ]]; then
        echo "Invalid version '$version'. Expected semantic version (e.g. 2.1.0)." >&2
        return 1
    fi
}

require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Required command not found on PATH: $cmd" >&2
        return 1
    fi
}

ensure_file() {
    local file_path="$1"
    if [[ ! -f "$file_path" ]]; then
        echo "Required file not found: $file_path" >&2
        return 1
    fi
}

assert_version_match() {
    local expected="$1"
    local actual="$2"
    local context="$3"
    if [[ "$expected" != "$actual" ]]; then
        echo "Version mismatch for $context: expected '$expected' but found '$actual'." >&2
        return 1
    fi
}

ensure_clean_worktree() {
    local repo_root="$1"
    if [[ -n "$(git -C "$repo_root" status --porcelain)" ]]; then
        echo "Working tree must be clean before running release scripts." >&2
        echo "Please commit/stash changes and retry." >&2
        return 1
    fi
}

verify_manifest_version() {
    local file_path="$1"
    local version_regex="$2"
    if ! rg -n "$version_regex" "$file_path" >/dev/null 2>&1; then
        echo "Version in $file_path does not match release target." >&2
        return 1
    fi
}

maybe_run_smoke_suite() {
    local repo_root="$1"
    if [[ "${RELEASE_SKIP_SMOKE:-0}" == "1" ]]; then
        echo "Skipping smoke suite because RELEASE_SKIP_SMOKE=1"
        return 0
    fi

    "$repo_root/scripts/tests/run_all_smoke.sh"
}

confirm_publish_if_needed() {
    local package_name="$1"
    local version="$2"
    local mode="$3"
    if [[ "$mode" != "publish" ]]; then
        return 0
    fi

    if [[ "${RELEASE_CONFIRM:-}" != "YES" ]]; then
        echo "Publishing $package_name v$version is blocked." >&2
        echo "Set RELEASE_CONFIRM=YES to acknowledge and publish." >&2
        return 1
    fi
}

log_release_mode() {
    local package_name="$1"
    local version="$2"
    local mode="$3"
    echo "Preparing $package_name release for v$version ($mode)"
}

