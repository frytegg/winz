"""Frozen dataclasses built from validated JSON, used for computation (contract/MODULES.md 2).

Documents stay dicts on disk; `raw` keeps the exact schema shape (Task.raw, PlanModel.raw), so writers never
rebuild a document from these values.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Mapping

from .clock import parse_utc
from .errors import ErrorItem, ValidationFailed
from .paths import Layout


def _utc_or_none(value: object) -> datetime | None:
    if value is None:
        return None
    return parse_utc(str(value))


@dataclass(frozen=True)
class Estimate:
    p10: float
    p50: float
    p90: float
    source: str

    @staticmethod
    def from_raw(raw: Mapping) -> Estimate:
        return Estimate(float(raw["p10_min"]), float(raw["p50_min"]), float(raw["p90_min"]), str(raw["source"]))


@dataclass(frozen=True)
class Requirement:
    id: str
    title: str
    priority: str
    required: bool
    group: str | None
    surface: str
    status_expected: str | None


@dataclass(frozen=True)
class Lane:
    id: str
    executor: str
    globs: tuple[str, ...]
    contract: bool


@dataclass(frozen=True)
class Deadline:
    id: str
    at: datetime
    kind: str
    irrecoverable: bool
    gate_phase: str


@dataclass(frozen=True)
class Task:
    id: str
    num: int
    title: str
    kind: str
    phase: str
    owner: str
    executor: str
    lane: str | None
    depends_on: tuple[str, ...]
    covers: tuple[str, ...]
    priority: str
    required: bool
    writes: tuple[str, ...]
    resources: tuple[str, ...]
    estimate: Estimate
    model: str | None
    effort: str | None
    release: datetime | None
    deadline: datetime | None
    anchor: dict | None = field(compare=False)
    template: str | None
    proof: dict = field(compare=False)
    manual: dict | None = field(compare=False)
    max_attempts: int
    raw: dict = field(compare=False, repr=False)

    @property
    def is_agent(self) -> bool:
        return self.owner == "agent"

    @property
    def is_human(self) -> bool:
        return self.kind in ("manual", "decision")

    @staticmethod
    def from_raw(raw: dict) -> Task:
        tid = str(raw["id"])
        return Task(
            id=tid,
            num=int(tid[1:]),
            title=str(raw.get("title", "")),
            kind=str(raw["kind"]),
            phase=str(raw["phase"]),
            owner=str(raw["owner"]),
            executor=str(raw["executor"]),
            lane=raw.get("lane"),
            depends_on=tuple(raw.get("depends_on") or ()),
            covers=tuple(raw.get("covers") or ()),
            priority=str(raw.get("priority", "P2")),
            required=bool(raw.get("required", False)),
            writes=tuple(raw.get("writes") or ()),
            resources=tuple(raw.get("resources") or ()),
            estimate=Estimate.from_raw(raw["estimate"]),
            model=raw.get("model"),
            effort=raw.get("effort"),
            release=_utc_or_none(raw.get("release_utc")),
            deadline=_utc_or_none(raw.get("deadline_utc")),
            anchor=raw.get("anchor"),
            template=raw.get("template"),
            proof=raw.get("proof") or {},
            manual=raw.get("manual"),
            max_attempts=int(raw.get("max_attempts", 2)),
            raw=raw,
        )


@dataclass(frozen=True)
class PlanModel:
    raw: dict = field(compare=False, repr=False)
    version: int
    approved: bool
    tasks: tuple[Task, ...]
    by_id: Mapping[str, Task] = field(compare=False, repr=False)
    requirements: tuple[Requirement, ...]
    lanes: tuple[Lane, ...]
    deadlines: tuple[Deadline, ...]
    protected: tuple[str, ...]

    @staticmethod
    def from_raw(raw: dict) -> PlanModel:
        """Build the model from a schema-valid plan document (a duplicate task id is E_TASK_ID)."""
        tasks = tuple(Task.from_raw(t) for t in raw.get("tasks") or ())
        by_id: dict[str, Task] = {}
        for t in tasks:
            if t.id in by_id:
                raise ValidationFailed(f"duplicate task id {t.id}", code="E_TASK_ID",
                                       items=[ErrorItem("E_TASK_ID", f"duplicate task id {t.id}", task=t.id)])
            by_id[t.id] = t
        reqs = tuple(
            Requirement(id=r["id"], title=r.get("title", ""), priority=r.get("priority", "P2"),
                        required=bool(r.get("required", False)), group=r.get("feature_group"),
                        surface=r.get("surface", "none"), status_expected=r.get("status_expected"))
            for r in raw.get("requirements") or ())
        lanes = tuple(Lane(id=ln["id"], executor=ln["executor"], globs=tuple(ln.get("globs") or ()),
                           contract=bool(ln.get("contract", False))) for ln in raw.get("lanes") or ())
        deadlines = tuple(Deadline(id=d["id"], at=parse_utc(d["at_utc"]), kind=d["kind"],
                                   irrecoverable=bool(d["irrecoverable"]), gate_phase=d["gate_phase"])
                          for d in raw.get("deadlines") or ())
        return PlanModel(raw=raw, version=int(raw.get("plan_version", 1)), approved=raw.get("approved") is not None,
                         tasks=tasks, by_id=MappingProxyType(by_id), requirements=reqs, lanes=lanes,
                         deadlines=deadlines, protected=tuple(raw.get("protected") or ()))


@dataclass(frozen=True)
class TaskState:
    status: str
    since: datetime
    attempts: int
    reruns: int
    raw: dict = field(compare=False, repr=False)


@dataclass(frozen=True)
class Ctx:
    layout: Layout
    executor: str | None
    now: datetime
    by: str
    pretty: bool
    command: str
    log: logging.Logger


@dataclass
class CommandResult:
    data: dict | None
    warnings: list[ErrorItem] = field(default_factory=list)
    exit_code: int = 0
    errors: list[ErrorItem] = field(default_factory=list)
