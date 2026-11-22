"""Determinism primitives: canonical serialisation, hashing, frozen clock."""
from analysis_app.determinism import (Clock, canonical_json, derive_run_id,
                                      sha256_obj, sha256_text)


def test_canonical_json_is_key_order_independent():
    a = {"b": 1, "a": 2, "c": [3, {"z": 1, "y": 2}]}
    b = {"c": [3, {"y": 2, "z": 1}], "a": 2, "b": 1}
    assert canonical_json(a) == canonical_json(b)


def test_canonical_json_float_stability():
    assert canonical_json({"x": 1.0}) == canonical_json({"x": 1.0})
    assert canonical_json({"x": 0.1 + 0.2}) == canonical_json({"x": 0.30000000000000004})


def test_sha256_text_and_obj_agree():
    # sha256_obj canonicalises (JSON) before hashing, so it equals hashing the
    # canonical JSON text.
    assert sha256_obj("hello") == sha256_text(canonical_json("hello"))
    assert sha256_text("hello") != sha256_text("hello ")


def test_clock_is_frozen():
    c = Clock.at("2026-09-30")
    assert c.date_str == "2026-09-30"
    assert c.now().isoformat().startswith("2026-09-30")
    # repeated reads are identical (no wall-clock drift)
    assert c.now() == c.now()


def test_derive_run_id_is_stable_and_input_sensitive():
    a = derive_run_id("u", "s", "c", "2026-09-30")
    b = derive_run_id("u", "s", "c", "2026-09-30")
    c = derive_run_id("u", "s", "c", "2026-10-01")
    assert a == b
    assert a != c
    assert len(a) == 16
