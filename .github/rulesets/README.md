# Repository rules

The GitHub settings this project runs with, kept here so they're reviewed like code. `apply.sh` applies them with the GitHub CLI; run it as a repository admin after changing a file here.

**`main`** (`main.json`)
- Changes arrive through pull requests only, squash-merged, so history stays linear. No force pushes, and the branch can't be deleted.
- A pull request needs one approving review, from a code owner (`.github/CODEOWNERS`). A new push dismisses earlier approvals, and its last push must be approved by someone other than its author. Review threads must be resolved.
- CI must pass on the latest `main`: the device tests on the host, the firmware build, the website checks and the app checks (`.github/workflows/ci.yml`). If a job is renamed, update its name here too.
- Repository admins may merge a pull request without waiting for these, for a maintainer working alone or an urgent fix. They still can't push to `main` directly.

**Release tags** (`release-tags.json`): only repository admins can create `firmware-v*` and `app-v*` tags, which start release builds, and nobody can move or delete one once pushed, because the app checks downloaded firmware against the release published from its tag.

**Repository settings** (in `apply.sh`): squash merges only, branches deleted after merging, Discussions on, the website on GitHub Pages (deployed by `.github/workflows/pages.yml`), private vulnerability reporting, Dependabot alerts and security fixes.
