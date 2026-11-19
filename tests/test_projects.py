"""Tes modul projects.py: slug, migrasi default, CRUD, dan penolakan traversal."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import projects as store  # noqa: E402


class ProjectStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.original = {k: getattr(store, k) for k in
                         ("PROJECTS", "TRASH", "LEGACY_DATA", "LEGACY_ANALYSIS", "LEGACY_FAILED", "ROOT")}
        store.PROJECTS = d / "projects"
        store.TRASH = store.PROJECTS / ".trash"
        store.LEGACY_DATA = d / "data.json"
        store.LEGACY_ANALYSIS = d / "llm_analysis.json"
        store.LEGACY_FAILED = d / "failed.json"
        store.ROOT = d
        store.PROJECTS.mkdir(parents=True)

    def tearDown(self):
        for k, v in self.original.items():
            setattr(store, k, v)
        self.tmp.cleanup()

    def test_validasi_slug(self):
        for good in ("default", "pendukung-a", "a1", "x" * 41):
            self.assertTrue(store.valid_slug(good), good)
        for bad in ("", "..", "../etc", "A", "a b", "a/b", "-a", "a_b", "a" * 42):
            self.assertFalse(store.valid_slug(bad), bad)
        with self.assertRaises(ValueError):
            store.project_dir("../etc")

    def test_slugify(self):
        self.assertEqual(store.slugify("Pendukung Kandidat A!"), "pendukung-kandidat-a")
        self.assertEqual(store.slugify("   "), "proyek")
        self.assertEqual(store.slugify("!!!"), "proyek")

    def test_migrasi_default_menyalin_bukan_memindah(self):
        store.LEGACY_DATA.write_text(json.dumps({"schema_version": 2, "posts": [{"code": "X"}]}),
                                      encoding="utf-8")
        store.LEGACY_ANALYSIS.write_text(json.dumps({"counts": {"labeled": 1}}),
                                         encoding="utf-8")
        info = store.ensure_default_project()
        self.assertEqual(info["slug"], "default")
        self.assertEqual(info["posts"], 1)
        self.assertTrue(store.LEGACY_DATA.exists(), "file lama harus tetap ada")
        self.assertTrue((store.PROJECTS / "default" / "data.json").exists())
        self.assertTrue((store.PROJECTS / "default" / "llm_analysis.json").exists())
        self.assertEqual(store.ensure_default_project(), None, "migrasi hanya sekali")

    def test_create_rename_delete_trash(self):
        created = store.create_project("Uji Proyek")
        slug = created["slug"]
        self.assertEqual(slug, "uji-proyek")
        again = store.create_project("Uji Proyek")
        self.assertEqual(again["slug"], "uji-proyek-2")
        renamed = store.rename_project(slug, "Nama Baru")
        self.assertEqual(renamed["name"], "Nama Baru")
        out = store.delete_project(slug)
        self.assertTrue(Path(store.ROOT / out["trashed"]).exists())
        self.assertIsNone(store.get_project(slug))

    def test_tidak_bisa_hapus_satu_satunya_proyek(self):
        store.create_project("Satu-satunya")
        for slug in [p["slug"] for p in store.list_projects()][1:]:
            store.delete_project(slug)
        remaining = [p["slug"] for p in store.list_projects()]
        self.assertEqual(len(remaining), 1)
        with self.assertRaises(ValueError):
            store.delete_project(remaining[0])


if __name__ == "__main__":
    unittest.main()
