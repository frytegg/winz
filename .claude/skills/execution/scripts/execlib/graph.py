"""Dependency graph of a plan (contract/MODULES.md 4, pure computation on model.PlanModel).

Ancestors are computed once as integer bitsets in topological order, so `joined` (a path either way) is one AND.
Unknown dependency ids are ignored here (plan validation reports them, P-02). Every output that is a sequence is
ordered (ties by numeric id), never by set iteration order.
"""
from __future__ import annotations

from typing import Mapping

from .model import PlanModel


def _num(task_id: str) -> int:
    try:
        return int(task_id[1:])
    except ValueError:
        return 1 << 62


class Graph:
    def __init__(self, ids: list[str], deps: Mapping[str, tuple[str, ...]]) -> None:
        self._ids = list(ids)
        self._index = {tid: i for i, tid in enumerate(self._ids)}
        self._deps: dict[str, tuple[str, ...]] = {t: tuple(d for d in deps.get(t, ()) if d in self._index)
                                                  for t in self._ids}
        self._succ: dict[str, list[str]] = {t: [] for t in self._ids}
        for t in self._ids:
            for d in self._deps[t]:
                self._succ[d].append(t)
        for t in self._succ:
            self._succ[t].sort(key=_num)
        self._order = self._kahn()
        self._anc: dict[str, int] = {}
        for t in self._order:
            bits = 0
            for d in self._deps[t]:
                bits |= self._anc.get(d, 0) | (1 << self._index[d])
            self._anc[t] = bits
        self._desc: dict[str, int] = {t: 0 for t in self._ids}
        for t in reversed(self._order):
            bits = 0
            for s in self._succ[t]:
                bits |= self._desc[s] | (1 << self._index[s])
            self._desc[t] = bits

    @staticmethod
    def of(plan: PlanModel) -> Graph:
        return Graph([t.id for t in plan.tasks], {t.id: t.depends_on for t in plan.tasks})

    def _kahn(self) -> list[str]:
        indeg = {t: len(self._deps[t]) for t in self._ids}
        ready = sorted((t for t in self._ids if indeg[t] == 0), key=_num)
        out: list[str] = []
        while ready:
            t = ready.pop(0)
            out.append(t)
            changed = False
            for s in self._succ[t]:
                indeg[s] -= 1
                if indeg[s] == 0:
                    ready.append(s)
                    changed = True
            if changed:
                ready.sort(key=_num)
        if len(out) != len(self._ids):
            # A cycle (only possible in a plan that fails P-02): append the rest in id order so callers terminate.
            rest = sorted((t for t in self._ids if t not in set(out)), key=_num)
            out.extend(rest)
        return out

    def _ids_of(self, bits: int) -> frozenset[str]:
        return frozenset(self._ids[i] for i in range(len(self._ids)) if bits >> i & 1)

    def ancestors(self, task_id: str) -> frozenset[str]:
        return self._ids_of(self._anc.get(task_id, 0))

    def descendants(self, task_id: str) -> frozenset[str]:
        return self._ids_of(self._desc.get(task_id, 0))

    def joined(self, a: str, b: str) -> bool:
        """A dependency path exists from a to b or from b to a."""
        if a not in self._index or b not in self._index:
            return False
        ia, ib = self._index[a], self._index[b]
        return bool(self._anc[a] >> ib & 1) or bool(self._anc[b] >> ia & 1)

    def topo(self) -> list[str]:
        """Kahn's order with ties broken by numeric id (stable)."""
        return list(self._order)

    def successors(self, task_id: str) -> list[str]:
        """Direct successors, by numeric id."""
        return list(self._succ.get(task_id, []))

    def successors_count(self, task_id: str) -> int:
        """Number of direct successors (tasks that depend on this one)."""
        return len(self._succ.get(task_id, []))

    def remaining_path_min(self, task_id: str, durations: Mapping[str, float]) -> float:
        """Longest path in minutes from the start of task_id to the end of the graph, its own duration included."""
        memo: dict[str, float] = {}
        for t in reversed(self._order):
            tail = max((memo[s] for s in self._succ[t]), default=0.0)
            memo[t] = float(durations.get(t, 0.0)) + tail
        return memo.get(task_id, 0.0)
