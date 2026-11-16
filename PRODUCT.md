# Product

## Users

ML engineers and manufacturing-software engineers who run (or are building)
camera-based part inspection, and the AI coding agents they work with. Their context:
an anomaly model flags parts, operators decide, and months later someone asks why a
part shipped. They need every image, score, heatmap, verdict and model version kept
together and findable by part serial, on storage that grows with the line.

## Product Purpose

A visual inspection archive built on Anomalib PatchCore and Backblaze B2. Each part
image lands in B2 under its line and date; PatchCore scores it locally and writes a
heatmap and a score row with the model version and threshold; parts above the
threshold go to an operator review queue; adjudicated images become the next training
set, and each new model version is trained from images read back from B2 and stored
beside its metrics and a manifest of exactly which images it saw. Success = any part
serial returns its full, explainable record, and the archive needs no second API key
and no GPU to run.

Out of scope: camera or PLC integration, line-rate or throughput claims, other anomaly
libraries, MVTec datasets, deleting inspection records, and claims of compliance with
any specific quality standard.

## Maturity and Support Boundary

This is a maintained open-source template/sample, not a complete hosted SaaS product.
It is built with production-minded controls and can be adapted for production use with
caution, but adopters own product-specific validation, security, deployment, and
operations. Repository defects and feature requests go through the public GitHub issue
tracker; B2 account, billing, service, and API questions go through Backblaze Support.
The template/sample itself is not covered by the Backblaze service level agreement,
and no SLA is provided for the repository software.

## Brand Personality

Confident, precise, quietly professional. Voice is direct and free of hype; numbers
are shown in the units they were computed in (raw PatchCore scores beside their
threshold). The interface should feel like a modern inspection tool: calm, exact,
trustworthy. Evidence (image, heatmap, score, verdict, model) is always one click away.

## Anti-references

- **Generic AI/SaaS slop.** No gradient text, hero-metric templates, identical
  icon-card grids, tracked uppercase eyebrows, or decorative glassmorphism. These are
  the exact 2026 AI tells this kit exists to help builders avoid.
- **Over-branded / loud.** No heavy brand-color drenching, decorative motion, or flashy
  effects. It is scaffolding to be rebranded, not a hero page.
- **Toy / prototype feel.** No missing states, inconsistent components, or placeholder
  polish. Must read as polished, dependable scaffolding.
- **Enterprise-drab.** No Bootstrap-era gray boxes or dense-but-lifeless admin-panel
  look. Considered, like modern dev tools (Linear, GitHub Primer, Stripe).

## Design Principles

- **Evidence over summaries.** Every number links back to the image, heatmap and model
  version that produced it; nothing that a trace depends on is overwritten or deleted.
- **Neutral foundation, easy to rebrand.** Identity lives in tokens (`globals.css`) and
  one config file. Screens are built from the shared UI kit so a rebrand is a token
  swap, not a rewrite.
- **Earned familiarity over novelty.** Use standard, trusted affordances (top bar +
  side nav, command palette, data tables). The tool disappears into the task.
- **Every state is designed.** Default, hover, focus, active, disabled, loading (skeleton),
  empty (teaches the interface), and error (says what's wrong + offers retry) — never
  half-shipped.
- **Consistency is the feature.** One button vocabulary, one form-control set, one icon
  style across every screen. Divergence is a bug.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Body text ≥ 4.5:1, large/bold text ≥ 3:1, visible focus
indicators on every interactive element, full keyboard navigation, correct semantic
landmarks and heading order, labelled form controls, and a `prefers-reduced-motion`
alternative for every animation. Full light and dark theme parity.
