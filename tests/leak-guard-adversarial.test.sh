#!/usr/bin/env bash
# Additional adversarial coverage for provider credentials and gate-file bypasses.
set -uo pipefail
cd "$(dirname "$0")/.."

GUARD="$PWD/.github/scripts/leak-guard.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
failures=0

expect_block() {
  local label="$1" marker="$2" file="$3" output
  if output="$(bash "$GUARD" "$file" 2>&1)"; then
    echo "FAIL: $label passed but must be blocked"
    failures=$((failures + 1))
    return
  fi
  if ! grep -q "$marker" <<<"$output"; then
    echo "FAIL: $label did not report $marker"
    failures=$((failures + 1))
    return
  fi
  echo "BLOCKED: $label -> $marker"
}

printf '%s%s%s\n' 'AWS_SECRET_ACCESS_' 'KEY=' 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY' > "$TMP/aws.txt"
expect_block "AWS secret access key" "AWS secret access key" "$TMP/aws.txt"

printf '%s%s%s%s\n' 'OPENAI_API_' 'KEY=' 'sk-proj-' 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG' > "$TMP/openai.txt"
expect_block "OpenAI project key" "OpenAI or Anthropic API token" "$TMP/openai.txt"

printf '%s%s%s%s\n' 'ANTHROPIC_API_' 'KEY=' 'sk-ant-api03-' 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5' > "$TMP/anthropic.txt"
expect_block "Anthropic API key" "OpenAI or Anthropic API token" "$TMP/anthropic.txt"

printf '%s%s%s%s\n' 'GEMINI_API_' 'KEY=' 'AIza' 'SyA1bC3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1x' > "$TMP/gemini.txt"
expect_block "Gemini API key" "Google API key" "$TMP/gemini.txt"

printf '%s%s%s\n' 'SERVICE_ACCESS_' 'TOKEN=' 'aB3dE5fG7hJ9kL1mN3pQ5rS7' > "$TMP/env.txt"
expect_block "unquoted uppercase credential" "environment credential assignment" "$TMP/env.txt"

agent_name='da''ne'
memory_path="$TMP/orgs/acme/agents/$agent_name/MEMORY.md"
mkdir -p "$(dirname "$memory_path")"
printf 'clean\n' > "$memory_path"
expect_block "tracked agent memory" "private runtime path is tracked" "$memory_path"

# Guard machinery is never exempt from secret detection.
mkdir -p "$TMP/no-bypass/.github/scripts" "$TMP/no-bypass/.github/workflows" "$TMP/no-bypass/tests"
for path in \
  .github/scripts/leak-guard.sh \
  .github/workflows/leak-guard.yml \
  tests/leak-guard.test.sh
do
  printf 'token=%s%s\n' 'ghp_' 'abcdefghijklmnopqrstuvwxyz1234567890ABCD' > "$TMP/no-bypass/$path"
  expect_block "gate-file bypass $path" "GitHub token" "$TMP/no-bypass/$path"
done

if [[ "$failures" -ne 0 ]]; then
  echo "leak-guard-adversarial.test: FAIL ($failures failure(s))"
  exit 1
fi
echo "leak-guard-adversarial.test: PASS"
