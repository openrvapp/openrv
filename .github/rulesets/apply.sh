#!/usr/bin/env bash
# Applies the repository settings and rulesets in this folder to GitHub. Needs bash (Git Bash on
# Windows) and the GitHub CLI (gh), signed in as a repository admin. Safe to run again: it updates rulesets that already exist.
#
#   .github/rulesets/apply.sh [owner/repo]
#
# Rulesets on a private repository need a paid GitHub plan; on GitHub Free they apply once the
# repository is public.
set -euo pipefail

repo="${1:-openrvapp/openrv}"
# The website's own domain (DNS records in website/README.md); empty to use github.io.
domain="${OPENRV_DOMAIN-openrv.app}"
dir="$(cd "$(dirname "$0")" && pwd)"

echo "Repository settings for $repo"
gh api -X PATCH "repos/$repo" \
  -f description="Bluetooth gateway and phone app for RV sensors, coolers, locks and solar: ESP32-S3 firmware and a React Native app" \
  -f homepage="https://${domain:-${repo%%/*}.github.io/${repo#*/}}/" \
  -F has_issues=true -F has_discussions=true -F has_wiki=true -F has_projects=false \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
  -F delete_branch_on_merge=true -F allow_update_branch=true \
  -F web_commit_signoff_required=false >/dev/null
gh api -X PUT "repos/$repo/topics" -f "names[]=rv" -f "names[]=bluetooth-low-energy" -f "names[]=esp32" \
  -f "names[]=esp-idf" -f "names[]=react-native" -f "names[]=expo" -f "names[]=iot" -f "names[]=camper" \
  -f "names[]=mopeka" -f "names[]=home-automation" >/dev/null

echo "GitHub Pages, deployed by .github/workflows/pages.yml"
gh api -X POST "repos/$repo/pages" -f build_type=workflow >/dev/null 2>&1 || true
gh api -X PUT "repos/$repo/pages" -f build_type=workflow -f cname="$domain" >/dev/null

echo "Security features"
gh api -X PUT "repos/$repo/private-vulnerability-reporting" >/dev/null
gh api -X PUT "repos/$repo/vulnerability-alerts" >/dev/null
gh api -X PUT "repos/$repo/automated-security-fixes" >/dev/null

for file in "$dir"/*.json; do
  name="$(sed -n 's/^  "name": *"\([^"]*\)".*/\1/p' "$file")"
  id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"
  if [ -n "$id" ]; then
    echo "Updating ruleset: $name"
    gh api -X PUT "repos/$repo/rulesets/$id" --input "$file" >/dev/null
  else
    echo "Creating ruleset: $name"
    gh api -X POST "repos/$repo/rulesets" --input "$file" >/dev/null
  fi
done
echo "Done"
