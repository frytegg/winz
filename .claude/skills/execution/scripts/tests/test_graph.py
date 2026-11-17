"""The dependency graph (contract/MODULES.md 4 graph; TESTS.md 3.2 and the 7-task DAG of 3.5; LANES.md B01).

Protects: ancestors, descendants, joined (a path either way) and a stable topological order (ties by numeric id) on
the 7-task DAG; successors and the remaining path used by priorities.

Run: python -m unittest discover -s scripts/tests -p "test_graph.py" -v
"""
from __future__ import annotations

import unittest

import _support as S
from execlib.graph import Graph
from execlib.model import PlanModel

DAG = {"T001": (30, ()), "T002": (20, ("T001",)), "T003": (45, ("T001",)), "T004": (15, ("T002",)),
       "T005": (10, ("T003", "T004")), "T006": (25, ("T002",)), "T007": (20, ("T005", "T006"))}


def dag_plan() -> PlanModel:
    tasks = [S.build_task(tid, deps=deps) for tid, (_d, deps) in DAG.items()]
    return PlanModel.from_raw(S.build_plan(tasks=tasks))


class GraphTests(unittest.TestCase):
    def setUp(self) -> None:
        self.g = Graph.of(dag_plan())

    def test_ancestors_descendants(self) -> None:
        self.assertEqual(self.g.ancestors("T007"), frozenset({"T001", "T002", "T003", "T004", "T005", "T006"}))
        self.assertEqual(self.g.descendants("T002"), frozenset({"T004", "T005", "T006", "T007"}))
        self.assertEqual(self.g.ancestors("T001"), frozenset())
        self.assertEqual(self.g.ancestors("T999"), frozenset())

    def test_joined(self) -> None:
        self.assertFalse(self.g.joined("T004", "T006"))
        self.assertTrue(self.g.joined("T001", "T007"))
        self.assertTrue(self.g.joined("T007", "T001"))
        self.assertFalse(self.g.joined("T003", "T004"))
        self.assertTrue(self.g.joined("T004", "T005"))

    def test_topo_respects_edges_and_is_stable(self) -> None:
        order = self.g.topo()
        self.assertEqual(order, ["T001", "T002", "T003", "T004", "T005", "T006", "T007"])
        pos = {t: i for i, t in enumerate(order)}
        for tid, (_d, deps) in DAG.items():
            for dep in deps:
                self.assertLess(pos[dep], pos[tid])
        shuffled = [S.build_task(t, deps=DAG[t][1]) for t in ("T005", "T001", "T007", "T003", "T002", "T006",
                                                              "T004")]
        raw = S.build_plan(tasks=shuffled)
        self.assertEqual(Graph.of(PlanModel.from_raw(raw)).topo(), order, "independent of the array order")

    def test_successors_and_remaining_path(self) -> None:
        self.assertEqual(self.g.successors("T002"), ["T004", "T006"])
        self.assertEqual(self.g.successors_count("T002"), 2)
        self.assertEqual(self.g.successors_count("T007"), 0)
        durations = {t: float(d) for t, (d, _deps) in DAG.items()}
        # T001 -> T003 -> T005 -> T007 = 30 + 45 + 10 + 20
        self.assertEqual(self.g.remaining_path_min("T001", durations), 105.0)
        self.assertEqual(self.g.remaining_path_min("T002", durations), 65.0)
        self.assertEqual(self.g.remaining_path_min("T007", durations), 20.0)

    def test_unknown_dependency_ignored(self) -> None:
        raw = S.build_plan(tasks=[S.build_task("T001"), S.build_task("T002", deps=("T001", "T050"))])
        g = Graph.of(PlanModel.from_raw(raw))
        self.assertEqual(g.ancestors("T002"), frozenset({"T001"}))


if __name__ == "__main__":
    unittest.main()
