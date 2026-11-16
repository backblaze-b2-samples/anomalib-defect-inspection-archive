# Opt-in targets that need real B2 credentials and the ML extra
# (`pnpm setup:ml`). `pnpm verify` needs neither.
.PHONY: test demo

# End-to-end self-test against a REAL B2 test bucket with REAL PatchCore on CPU.
# Writes a run-unique line `selftest-<utc-ts>` and deletes nothing.
test:
	RUN_LIVE_B2_TESTS=1 pnpm test:live:inspection

# Same flow against the running dev servers (`pnpm dev`), leaving a line with
# flagged parts waiting in /review, then opens /review in the browser.
demo:
	pnpm wait-ready
	services/api/.venv/bin/python scripts/demo.py
