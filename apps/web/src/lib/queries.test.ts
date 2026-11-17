import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { dropDeletedFileFromCache, qk } from "@/lib/queries";
import type { FileMetadata } from "@anomalib-defect-inspection-archive/shared";

function file(key: string): FileMetadata {
  return {
    key,
    filename: key.split("/").pop() ?? key,
    folder: "uploads/",
    size_bytes: 10,
    size_human: "10 B",
    content_type: "text/plain",
    uploaded_at: "2026-07-28T00:00:00Z",
    url: null,
  };
}

describe("dropDeletedFileFromCache", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
  });

  it("removes the deleted row from the default list", () => {
    qc.setQueryData(qk.files(), [file("uploads/a.txt"), file("uploads/b.txt")]);

    dropDeletedFileFromCache(qc, "uploads/a.txt");

    expect(qc.getQueryData<FileMetadata[]>(qk.files())).toEqual([
      file("uploads/b.txt"),
    ]);
  });

  it("removes it from every cached prefix/limit variant", () => {
    qc.setQueryData(qk.files(), [file("uploads/a.txt")]);
    qc.setQueryData(qk.files("uploads/", 100), [file("uploads/a.txt")]);
    qc.setQueryData(qk.files("", 25), [file("uploads/a.txt")]);

    dropDeletedFileFromCache(qc, "uploads/a.txt");

    expect(qc.getQueryData<FileMetadata[]>(qk.files())).toEqual([]);
    expect(qc.getQueryData<FileMetadata[]>(qk.files("uploads/", 100))).toEqual(
      [],
    );
    expect(qc.getQueryData<FileMetadata[]>(qk.files("", 25))).toEqual([]);
  });

  it("evicts the deleted key's presigned URL and detail so Preview can't 404", () => {
    qc.setQueryData(qk.preview("uploads/a.txt"), { url: "https://signed" });
    qc.setQueryData(qk.detail("uploads/a.txt"), { md5: "abc" });

    dropDeletedFileFromCache(qc, "uploads/a.txt");

    expect(qc.getQueryData(qk.preview("uploads/a.txt"))).toBeUndefined();
    expect(qc.getQueryData(qk.detail("uploads/a.txt"))).toBeUndefined();
  });

  it("leaves other files' cached previews alone", () => {
    qc.setQueryData(qk.preview("uploads/b.txt"), { url: "https://signed-b" });

    dropDeletedFileFromCache(qc, "uploads/a.txt");

    expect(qc.getQueryData(qk.preview("uploads/b.txt"))).toEqual({
      url: "https://signed-b",
    });
  });

  it("does not touch stats or activity caches", () => {
    qc.setQueryData(qk.stats(), { total_files: 2 });
    qc.setQueryData(qk.uploadActivity(7), [{ date: "2026-07-28", uploads: 2 }]);

    dropDeletedFileFromCache(qc, "uploads/a.txt");

    expect(qc.getQueryData(qk.stats())).toEqual({ total_files: 2 });
    expect(qc.getQueryData(qk.uploadActivity(7))).toHaveLength(1);
  });

  it("is a no-op for an unseeded cache", () => {
    expect(() =>
      dropDeletedFileFromCache(qc, "uploads/missing.txt"),
    ).not.toThrow();
    expect(qc.getQueryData(qk.files())).toBeUndefined();
  });
});

// --- Inspection cache surgery ------------------------------------------------

import {
  addQueuedModel,
  applyActivatedModel,
  dropVerdictedPartFromQueue,
  isScoreJobActive,
  isTrainingInFlight,
  modelRunFinished,
} from "@/lib/queries";
import type { Line, LineDetail, ModelVersion, ReviewItem, ScoreJob } from "@anomalib-defect-inspection-archive/shared";

function model(version: string, status: ModelVersion["status"]): ModelVersion {
  return {
    line_id: "line-01",
    version,
    status,
    backbone: "wide_resnet50_2",
    image_size: 256,
    coreset_ratio: 0.1,
    source: "reference_and_adjudicated",
    note: null,
    train_image_count: 4,
    eval_image_count: 2,
    threshold: null,
    threshold_method: null,
    image_auroc: null,
    image_f1: null,
    parent_version: null,
    created_at: "2026-11-16T00:00:00Z",
    started_at: null,
    finished_at: null,
    error: null,
    anomalib_version: null,
    stage: null,
    progress: null,
    active: false,
  };
}

function reviewItem(lineId: string, serial: string): ReviewItem {
  return { line_id: lineId, serial } as unknown as ReviewItem;
}

describe("applyActivatedModel", () => {
  it("shows the new active version in the line detail and the line list at once", () => {
    const qc = new QueryClient();
    const detailKey = [...qk.lineDetail(), "line-01"];
    qc.setQueryData(detailKey, { line_id: "line-01", active_model_version: "v1", part_count: 3 } as unknown as LineDetail);
    qc.setQueryData(qk.lines(), [{ line_id: "line-01", active_model_version: "v1" }, { line_id: "line-02", active_model_version: null }] as unknown as Line[]);

    applyActivatedModel(qc, { line_id: "line-01", active_model_version: "v2" } as unknown as Line);

    expect(qc.getQueryData<LineDetail>(detailKey)).toMatchObject({ active_model_version: "v2", part_count: 3 });
    expect(qc.getQueryData<Line[]>(qk.lines())?.map((l) => l.active_model_version)).toEqual(["v2", null]);
  });
});

describe("dropVerdictedPartFromQueue", () => {
  it("removes the part from every cached review queue, filtered or not", () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.reviewQueue(undefined), [reviewItem("line-01", "X006"), reviewItem("line-02", "X006")]);
    qc.setQueryData(qk.reviewQueue("line-01"), [reviewItem("line-01", "X006"), reviewItem("line-01", "X007")]);

    dropVerdictedPartFromQueue(qc, "line-01", "X006");

    expect(qc.getQueryData<ReviewItem[]>(qk.reviewQueue(undefined))).toEqual([reviewItem("line-02", "X006")]);
    expect(qc.getQueryData<ReviewItem[]>(qk.reviewQueue("line-01"))).toEqual([reviewItem("line-01", "X007")]);
  });
});

describe("addQueuedModel", () => {
  it("puts a just-queued version at the top of the line's version list", () => {
    const qc = new QueryClient();
    const key = [...qk.models(), "line-01"];
    qc.setQueryData(key, [model("v1", "ready")]);

    addQueuedModel(qc, model("v2", "queued"));
    addQueuedModel(qc, model("v2", "queued")); // idempotent

    expect(qc.getQueryData<ModelVersion[]>(key)?.map((m) => m.version)).toEqual(["v2", "v1"]);
  });
});

describe("training and scoring progress", () => {
  it("knows when a training run is in flight", () => {
    expect(isTrainingInFlight([model("v1", "ready"), model("v2", "training")])).toBe(true);
    expect(isTrainingInFlight([model("v1", "queued")])).toBe(true);
    expect(isTrainingInFlight([model("v1", "ready"), model("v2", "failed")])).toBe(false);
    expect(isTrainingInFlight(undefined)).toBe(false);
  });

  it("detects a run that just finished, so the line's active version is re-read", () => {
    expect(modelRunFinished([model("v1", "training")], [model("v1", "ready")])).toBe(true);
    expect(modelRunFinished([model("v1", "queued")], [model("v1", "failed")])).toBe(true);
    expect(modelRunFinished([model("v1", "training")], [model("v1", "training")])).toBe(false);
    expect(modelRunFinished(undefined, [model("v1", "ready")])).toBe(false);
  });

  it("treats queued and running score jobs as active", () => {
    const job = (status: ScoreJob["status"]) => ({ line_id: "line-01", status }) as ScoreJob;
    expect(isScoreJobActive(job("queued"))).toBe(true);
    expect(isScoreJobActive(job("running"))).toBe(true);
    expect(isScoreJobActive(job("done"))).toBe(false);
    expect(isScoreJobActive(undefined)).toBe(false);
  });
});

import { activeModelChanged } from "@/lib/queries";

describe("applyActivatedModel", () => {
  it("moves the active marker in the cached version list too", () => {
    const qc = new QueryClient();
    const row = (version: string, active: boolean) => ({ line_id: "l", version, active }) as ModelVersion;
    qc.setQueryData([...qk.models(), "l"], [row("v2", false), row("v1", true)]);
    applyActivatedModel(qc, { line_id: "l", active_model_version: "v2" } as LineDetail);
    expect(
      qc.getQueryData<ModelVersion[]>([...qk.models(), "l"])?.map((m) => [m.version, m.active]),
    ).toEqual([
      ["v2", true],
      ["v1", false],
    ]);
  });
});

describe("activeModelChanged", () => {
  it("is true only when a cached line names a different active version", () => {
    const line = (active: string | null) => ({ active_model_version: active }) as LineDetail;
    expect(activeModelChanged(line(null), line("v1"))).toBe(true);
    expect(activeModelChanged(line("v1"), line("v2"))).toBe(true);
    expect(activeModelChanged(line("v1"), line("v1"))).toBe(false);
    expect(activeModelChanged(undefined, line("v1"))).toBe(false);
  });
});

import { finishedModelRuns } from "@/lib/queries";

describe("finishedModelRuns", () => {
  it("returns the versions that just left queued/training", () => {
    expect(finishedModelRuns([model("v1", "training")], [model("v1", "ready")]).map((m) => m.version)).toEqual(["v1"]);
    expect(finishedModelRuns([model("v1", "ready")], [model("v1", "ready")])).toEqual([]);
    expect(finishedModelRuns(undefined, [model("v1", "ready")])).toEqual([]);
  });
});
