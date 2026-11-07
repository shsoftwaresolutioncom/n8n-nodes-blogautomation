# Changelog

## 0.1.1 – 2026-11-07
- First release published from GitHub Actions with **npm provenance** (required for n8n verified community nodes since 1 May 2026;
  0.1.0 was published from a workstation without provenance and fails `@n8n/scan-community-package`).
- Publish workflow: updates npm for trusted publishing (OIDC), runs the tests and checks that the tag equals the package version.
- No functional changes to the nodes.

## 0.1.0 – 2026-11-07
- Blog Automation node (ideas, write an article with AI, publish, add to calendar, articles, token balance) and Blog Automation Trigger
  (article ready / published / failed and more, via REST hooks).
