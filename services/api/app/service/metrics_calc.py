"""Evaluation metrics on the B2-read eval split, in pure Python.

Scores are raw PatchCore image scores; a part is flagged when its score is at or
above the threshold (the same rule Anomalib's F1 adaptive threshold uses).
"""

import math


def auroc(labels: list[int], scores: list[float]) -> float | None:
    """Area under the ROC curve (1 = anomalous). None without both classes.

    Mann-Whitney U formulation with average ranks for ties.
    """
    positives = sum(1 for label in labels if label == 1)
    negatives = len(labels) - positives
    if positives == 0 or negatives == 0:
        return None
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        average = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = average
        i = j + 1
    rank_sum = sum(rank for rank, label in zip(ranks, labels, strict=True) if label == 1)
    u = rank_sum - positives * (positives + 1) / 2.0
    return u / (positives * negatives)


def f1_at(labels: list[int], scores: list[float], threshold: float) -> float:
    tp = sum(1 for lb, s in zip(labels, scores, strict=True) if lb == 1 and s >= threshold)
    fp = sum(1 for lb, s in zip(labels, scores, strict=True) if lb == 0 and s >= threshold)
    fn = sum(1 for lb, s in zip(labels, scores, strict=True) if lb == 1 and s < threshold)
    if tp == 0:
        return 0.0
    return 2 * tp / (2 * tp + fp + fn)


def f1_max_threshold(labels: list[int], scores: list[float]) -> tuple[float, float]:
    """(threshold, F1) maximizing F1 over every observed score as a cut-off.

    Ties in F1 keep the higher threshold, which flags fewer normal parts.
    """
    best_threshold, best_f1 = math.inf, -1.0
    for candidate in sorted(set(scores)):
        f1 = f1_at(labels, scores, candidate)
        if f1 >= best_f1:
            best_threshold, best_f1 = candidate, f1
    return best_threshold, best_f1


def percentile(values: list[float], q: float) -> float:
    """Linear-interpolated percentile, q in [0, 100]."""
    if not values:
        raise ValueError("percentile of an empty list")
    ordered = sorted(values)
    position = (len(ordered) - 1) * q / 100.0
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def evaluate(labels: list[int], scores: list[float]) -> dict:
    """Threshold and metrics for an eval split (labels: 1 anomalous, 0 normal)."""
    if len(labels) != len(scores) or not labels:
        raise ValueError("Evaluation needs one score per label and at least one image")
    anomalous = sum(labels)
    normal = len(labels) - anomalous
    if anomalous and normal:
        threshold, f1 = f1_max_threshold(labels, scores)
        method = "f1_max"
    else:
        normal_scores = [s for s, lb in zip(scores, labels, strict=True) if lb == 0]
        threshold = percentile(normal_scores or scores, 99.0)
        f1 = f1_at(labels, scores, threshold) if anomalous else None
        method = "p99_normal"
    return {
        "threshold": float(threshold),
        "threshold_method": method,
        "image_auroc": auroc(labels, scores),
        "image_f1": f1,
        "eval_normal_count": normal,
        "eval_anomalous_count": anomalous,
        "eval_flagged_count": sum(1 for s in scores if s >= threshold),
    }
