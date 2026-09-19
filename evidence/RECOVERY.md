# Recovery Provenance — Canonical P3 Baseline

> **Context for readers encountering this document for the first time:**
> This is a historical provenance record, not an active incident report. It
> documents a one-time repository reconstruction event from early in the
> project (2026-09-11) and the verification steps taken to confirm nothing
> was lost or altered in the process. It is preserved here, alongside the
> project's other evidence reports, in the same spirit of transparency —
> nothing below has been rewritten or softened after the fact.

This repository was re-initialized on 2026-09-11 after the development
sandbox's filesystem was reset, which destroyed the original `.git` object
database. This document records exactly what was recovered, from where, and
what could not be recovered.

**Read this before reasoning about commit history.** The commit that
introduces this file is a *recovery baseline*, not a continuation of the
original history.

---

## Original protected P3 commit (provenance metadata only)

```
195067856a15261301f62e3c49ea582e138bc3ea
Fix immature current deviation visibility
```

**This SHA no longer exists in any repository.** It is recorded here purely
as historical provenance. The recovery baseline commit in this repository
has a different SHA and does not — and cannot — reproduce it: `git archive`
exports a source tree only, without commit objects, so the original commit's
identity (parents, author, timestamps, tree hashes) is unrecoverable.

Do not treat the recovery baseline SHA as equivalent to the historical SHA.

## Source of recovery

```
Artifact: parity-p3-1950678.tar.gz
SHA256:   83945df162a1ed0b9dd080224122478dd1a5296158816cb0ad510a92021b4850
```

This archive was produced earlier with `git archive` directly against commit
`195067856a15261301f62e3c49ea582e138bc3ea`, exported outside the sandbox,
and its checksum was reported at the time of creation. On recovery the
archive was re-checksummed and matched that previously-reported value
byte-for-byte, which is what establishes that the recovered tree is the
genuine P3 baseline rather than an approximation or a corrupted copy.

## Reason for recovery

The Claude sandbox filesystem reset removed `/home/claude/parity` in its
entirety, including the `.git` object database. The source tree was
recovered from the previously exported, checksum-verified `git archive`
artifact. The recovered tree passes the same P3 gate suite that the original
commit passed.

## Verification performed before committing

1. **Checksum match** — archive SHA256 identical to the value reported when
   it was created (above).
2. **Byte-level tree diff** — `diff -r` between a pristine extraction of the
   artifact and the working tree reported zero differences across every
   file (excluding `node_modules/` and `dist/`, which are build products).
3. **Purity check** — no design-concept or mock files are present in the
   production source tree. The approved visual specification is kept
   deliberately outside this repository (see below).
4. **Mock-string scan** — no occurrences of `DESIGN MOCK DATA`,
   `NOT PRODUCTION VALUES`, or `FINALIST` anywhere in production source.
5. **Full gate suite** — re-run on the recovered tree:
   - `npm test` → 22 files, 259/259 passing
   - `npm run typecheck` → clean
   - `npm run lint` → clean
   - `npm run build` → clean

These are the same counts and results the original P3 commit produced, which
is the strongest available evidence that nothing was lost or altered in the
recovered source.

## What was NOT recovered

- **The original `.git` object database** — all commit history from Slice P0
  through P3 (`40f08cf`, `d501b76`, `999830f`, `bcff338`, `a5f64fa`,
  `f7de065`, `1950678`). The source state of the final commit survives; the
  history leading to it does not.
- **Uncommitted P4.1 / P4.2 production-file modifications** — approximately
  930 lines across `public/index.html`, `public/app.js`, and
  `public/styles.css`. These were never committed and are unrecoverable.
  This loss is **not material**: those files represented visual directions
  that were explicitly rejected during the P4 art-direction round, and the
  locked visual specification supersedes them entirely.

The production deployment on the VPS was deployed from source archives rather than
as a git checkout, so it holds no recoverable history either.

## Approved P4 visual specification

The locked visual specification for the production overview is:

```
concepts/final-neon-refined.html
SHA256: 513cce6fd68e960e896e5bf10083b9d88cf2a336c1c40474557b2f7bf775dc83
```

**PARITY — NEON // INSTRUMENT.** It is retained deliberately *outside* this
repository (alongside it, not within it) so that the recovery baseline commit
contains exactly the canonical P3 production source and nothing else. It is a
locked specification, not a reference or an inspiration: the production
overview is required to match it visually, and it must not be redesigned,
approximated, or replaced with the rejected P4.1/P4.2 work.

## Status at the time of this commit

P3 intelligence semantics remain frozen. No production P4 integration work
has begun. This commit establishes a clean, verified baseline to build on.
