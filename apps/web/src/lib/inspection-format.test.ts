import { describe, expect, it } from "vitest";

import { binScores, formatBytes, formatScore } from "./inspection-format";

describe("binScores", () => {
  it("puts every score in exactly one bin, max in the last", () => {
    const bins = binScores([1, 2, 3, 4, 5], 4);
    expect(bins).toHaveLength(4);
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(5);
    expect(bins[3].count).toBe(2); // 4 and 5 (the max) share the top bin
  });

  it("handles identical scores and empty input", () => {
    expect(binScores([2, 2, 2], 3)[0].count).toBe(3);
    expect(binScores([])).toEqual([]);
  });
});

describe("formatters", () => {
  it("formats scores and bytes", () => {
    expect(formatScore(12.34567)).toBe("12.346");
    expect(formatScore(null)).toBe("-");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });
});

import { captureButtonLabel, formatElapsed, scoreJobProgress } from "./inspection-format";
import type { ScoreJob } from "@anomalib-defect-inspection-archive/shared";

describe("formatElapsed", () => {
  it("shows seconds, then minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(42_400)).toBe("42s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});

describe("scoreJobProgress", () => {
  const job = (over: Partial<ScoreJob>): ScoreJob =>
    ({ line_id: "l", status: "running", model_version: "v1", total: 14, scored: 3, failed: 0, ...over }) as ScoreJob;

  it("names the stage and counts k of N", () => {
    expect(scoreJobProgress(job({}))).toEqual({ label: "Scoring part 4 of 14 with v1", percent: 21 });
    expect(scoreJobProgress(job({ status: "queued", total: null, scored: 0 }))).toEqual({
      label: "Queued: waiting for the ML worker",
      percent: null,
    });
    expect(scoreJobProgress(job({ total: null, scored: 0 }))).toEqual({
      label: "Finding unscored parts",
      percent: null,
    });
  });
});

describe("captureButtonLabel", () => {
  it("only claims scoring when the line has a model", () => {
    expect(captureButtonLabel({ pending: false, progress: 0, hasModel: true })).toBe("Capture and score");
    expect(captureButtonLabel({ pending: false, progress: 0, hasModel: false })).toBe("Capture");
    expect(captureButtonLabel({ pending: true, progress: 40, hasModel: true })).toBe("Uploading to B2...");
    expect(captureButtonLabel({ pending: true, progress: 100, hasModel: true })).toBe("Scoring with PatchCore...");
    expect(captureButtonLabel({ pending: true, progress: 100, hasModel: false })).toBe("Saving to B2...");
  });
});

import type { ModelVersion } from "@anomalib-defect-inspection-archive/shared";
import {
  activationPrompt,
  EVIDENCE_MAX_RETRIES,
  evidenceRetryDelay,
  pickReviewItem,
  progressValueProps,
  referenceSerials,
  reviewQueueHref,
  trainingPercent,
} from "./inspection-format";

function model(version: string, extra: Partial<ModelVersion> = {}): ModelVersion {
  return {
    line_id: "line-01",
    version,
    status: "ready",
    backbone: "wide_resnet50_2",
    image_size: 256,
    coreset_ratio: 0.1,
    source: "reference_and_adjudicated",
    train_image_count: 4,
    eval_image_count: 2,
    created_at: "2026-11-16T00:00:00Z",
    active: false,
    ...extra,
  } as ModelVersion;
}

describe("activationPrompt", () => {
  it("names the newest ready version that is not active, against the active one", () => {
    const v1 = model("v1", { active: true, image_auroc: 0.8 });
    const v2 = model("v2", { image_auroc: 0.9 });
    expect(activationPrompt([v2, v1])).toEqual({ candidate: v2, active: v1 });
  });

  it("stays quiet when the newest ready version is already active (a rollback is a choice)", () => {
    expect(activationPrompt([model("v2", { active: true }), model("v1")])).toBeNull();
    expect(activationPrompt([model("v2"), model("v1", { active: true }), model("v3", { status: "failed" })]))
      .toEqual({ candidate: model("v2"), active: model("v1", { active: true }) });
  });

  it("ignores runs that are not ready", () => {
    expect(activationPrompt([model("v2", { status: "training" }), model("v1", { active: true })])).toBeNull();
    expect(activationPrompt([])).toBeNull();
  });
});

describe("trainingPercent", () => {
  it("turns the server's stage share into a whole percent, null when unknown", () => {
    expect(trainingPercent(model("v1", { status: "training", progress: 0.4 }))).toBe(40);
    expect(trainingPercent(model("v1", { status: "queued", progress: 0 }))).toBe(0);
    expect(trainingPercent(model("v1", { progress: null }))).toBeNull();
  });
});

describe("progressValueProps", () => {
  it("exposes a determinate value in the DOM (aria-valuenow / data-value)", () => {
    expect(progressValueProps(42)).toEqual({
      "aria-valuenow": 42,
      "data-value": 42,
      "data-state": "loading",
    });
    expect(progressValueProps(100)["data-state"]).toBe("complete");
  });
});

describe("pickReviewItem", () => {
  const queue = [
    { line_id: "a", serial: "old" },
    { line_id: "a", serial: "new" },
  ];
  it("pre-selects the requested part, else the oldest", () => {
    expect(pickReviewItem(queue, "a/new")).toEqual(queue[1]);
    expect(pickReviewItem(queue, "a/gone")).toEqual(queue[0]);
    expect(pickReviewItem(queue, null)).toEqual(queue[0]);
    expect(pickReviewItem(undefined, "a/new")).toBeUndefined();
  });

  it("builds a review link that carries the serial", () => {
    expect(reviewQueueHref("line 1", "S-1")).toBe("/review?line=line%201&serial=S-1");
    expect(reviewQueueHref("line-1")).toBe("/review?line=line-1");
  });
});

describe("referenceSerials", () => {
  it("numbers a batch from a prefix, zero-padded", () => {
    expect(referenceSerials("GOOD", 3)).toEqual(["GOOD-001", "GOOD-002", "GOOD-003"]);
    expect(referenceSerials("G", 1200)[1199]).toBe("G-1200");
    expect(referenceSerials("G", 0)).toEqual([]);
  });
});

describe("evidenceRetryDelay", () => {
  it("backs off between a few retries of a not-yet-written heatmap", () => {
    expect(EVIDENCE_MAX_RETRIES).toBeGreaterThanOrEqual(2);
    expect(evidenceRetryDelay(0)).toBeLessThan(evidenceRetryDelay(1));
  });
});

import {
  captureBlockedReason,
  batchStamp,
  captureReferencesHref,
  defaultReferencePrefix,
  describeScoreRef,
  parseReferenceParam,
  trainBlockedReason,
  trainModelHref,
} from "./inspection-format";

describe("capture and train deep links", () => {
  it("carries the reference intent and the train intent in the URL", () => {
    expect(captureReferencesHref("line-01")).toBe("/upload?line=line-01&reference=normal");
    expect(trainModelHref("line-01")).toBe("/lines/line-01/models?train=1");
    expect(parseReferenceParam("normal")).toBe("normal");
    expect(parseReferenceParam("anomalous")).toBe("anomalous");
    expect(parseReferenceParam("nonsense")).toBeUndefined();
    expect(parseReferenceParam(undefined)).toBeUndefined();
  });
});

describe("defaultReferencePrefix", () => {
  it("names a batch after its line, label and (when given) a UTC stamp", () => {
    expect(defaultReferencePrefix("line-01", "normal")).toBe("LINE-01-GOOD");
    expect(defaultReferencePrefix("line-01", "anomalous")).toBe("LINE-01-DEFECT");
    const stamp = batchStamp(new Date("2026-11-16T22:05:09Z"));
    expect(stamp).toBe("1116-2205");
    expect(defaultReferencePrefix("line-01", "normal", stamp)).toBe("LINE-01-GOOD-1116-2205");
    // The longest line id still yields serials within the 64-char limit.
    const longest = `${defaultReferencePrefix("a".repeat(41), "anomalous", stamp)}-001`;
    expect(longest.length).toBeLessThanOrEqual(64);
  });
});

describe("captureBlockedReason", () => {
  const ok = { lineId: "line-01", serial: "S-1", serialValid: true, fileCount: 1, busy: false };
  it("says why Capture is disabled, or null when it is not", () => {
    expect(captureBlockedReason(ok)).toBeNull();
    expect(captureBlockedReason({ ...ok, lineId: undefined })).toBe("Choose a line first.");
    expect(captureBlockedReason({ ...ok, serial: "", serialValid: false })).toBe("Type a serial first.");
    expect(captureBlockedReason({ ...ok, serial: "a b", serialValid: false })).toMatch(/Serial can only/);
    expect(captureBlockedReason({ ...ok, fileCount: 0 })).toBe("Drop an image first.");
    expect(captureBlockedReason({ ...ok, busy: true })).toBeNull();
  });
});

describe("trainBlockedReason", () => {
  it("names how many known-good references are missing", () => {
    expect(trainBlockedReason(0, 3)).toBe("Needs at least 3 known-good reference images; this line has 0.");
    expect(trainBlockedReason(2, 3)).toBe("Needs at least 3 known-good reference images; this line has 2.");
    expect(trainBlockedReason(3, 3)).toBeNull();
    expect(trainBlockedReason(undefined, 3)).toBeNull();
  });
});

describe("describeScoreRef", () => {
  const scores = [
    { scored_at: "2026-11-16T22:44:29.282431Z", model_version: "v1", score: 18.6691 },
    { scored_at: "2026-11-16T23:01:00Z", model_version: "v2", score: 3.2 },
  ];
  it("resolves the reviewed score row instead of showing the raw id", () => {
    const out = describeScoreRef("2026-11-16T22:44:29.282431+00:00@v1", scores);
    expect(out).toMatch(/^18\.669 · v1 · /);
    expect(out).not.toContain("@");
  });
  it("still reads well when the row is gone or there is no ref", () => {
    expect(describeScoreRef("2026-11-16T10:00:00+00:00@v3", scores)).toMatch(/^v3 · /);
    expect(describeScoreRef(null, scores)).toBe("-");
  });
});
