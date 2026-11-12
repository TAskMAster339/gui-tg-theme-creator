"""Validate the pinned Telegram Desktop inventory and report binding progress."""

import argparse
import csv
import hashlib
from collections import Counter, defaultdict
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
PALETTE_SHA256 = "e3cc71cfb37e6b0c9340d7ccf069688280ed62be73c344f02e6d75a40445bc30"
INVENTORY_SHA256 = "a8f7cbfaaa6b6c019443176018833fcb7403700b70419fcaa355b55a839066be"
COVERAGE_TASKS = ("T012", "T013", "T014", "T015", "T016", "T017")
EXTRA_FIELDS = {
    "cloud": {"name", "shortname", "wallpaper"},
    "archive": {"background.jpg", "background.png", "tiled.jpg", "tiled.png"},
}
BINDING_COLUMNS = (
    "key", "component", "state", "property", "description", "source",
    "implementation", "verification",
)


def read_table(path, columns):
    with path.open(encoding="utf-8", newline="") as file:
        rows = csv.reader(file, delimiter="\t", quoting=csv.QUOTE_NONE)
        if next(rows, None) != list(columns):
            raise ValueError(f"{path.name}: unexpected header")
        for line, row in enumerate(rows, 2):
            if len(row) != len(columns) or any(not cell or cell != cell.strip() for cell in row):
                raise ValueError(f"{path.name}:{line}: invalid columns or empty cell")
            yield dict(zip(columns, row))


def check_upstream(path, palette, coverage):
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != PALETTE_SHA256:
        raise ValueError("Upstream palette does not match the pinned revision")
    extracted = []
    for line_number, line in enumerate(content.decode("utf-8").splitlines(), 1):
        code, _, comment = line.partition("//")
        code = code.strip()
        if not code:
            continue
        match = re.fullmatch(r"(\w+):\s*(.+);", code)
        if not match:
            raise ValueError(f"Upstream palette:{line_number}: unexpected declaration")
        extracted.append({"key": match[1], "line": str(line_number), "default": match[2]})
        if coverage.get(match[1], {}).get("comment") != (comment.strip() or "-"):
            raise ValueError(f"Coverage comment differs from upstream: {match[1]}")
    if extracted != palette:
        raise ValueError("Inventory differs from upstream declarations")


def check_catalog(directory, upstream):
    inventory_path = directory / "palette.tsv"
    palette = list(read_table(inventory_path, ("key", "line", "default")))
    if hashlib.sha256(inventory_path.read_bytes()).hexdigest() != INVENTORY_SHA256:
        raise ValueError("palette.tsv differs from the pinned inventory")
    fields = list(read_table(directory / "fields.tsv", ("key", "kind", "description")))
    expected_fields = {(key, kind) for kind, keys in EXTRA_FIELDS.items() for key in keys}
    if {(row["key"], row["kind"]) for row in fields} != expected_fields:
        raise ValueError("fields.tsv has missing or unexpected fields")
    keys = [row["key"] for row in palette + fields]
    duplicates = [key for key, count in Counter(keys).items() if count > 1]
    if duplicates:
        raise ValueError(f"Duplicate fields: {', '.join(duplicates)}")
    coverage = {}
    for row in read_table(directory / "coverage.tsv", ("key", "task", "comment")):
        key = row["key"]
        if key in coverage:
            raise ValueError(f"Duplicate coverage key: {key}")
        if row["task"] not in COVERAGE_TASKS:
            raise ValueError(f"Unknown coverage task for {key}: {row['task']}")
        coverage[key] = row
    palette_keys = {row["key"] for row in palette}
    missing = palette_keys - coverage.keys()
    unknown = coverage.keys() - palette_keys
    if missing or unknown:
        raise ValueError(f"Coverage keys differ from inventory: missing {sorted(missing)}, unknown {sorted(unknown)}")
    if upstream:
        check_upstream(upstream, palette, coverage)

    known = set(keys)
    slots = {}
    progress = defaultdict(Counter)
    for row in read_table(directory / "bindings.tsv", BINDING_COLUMNS):
        key = row["key"]
        slot = (row["component"], row["state"], row["property"])
        if key not in known:
            raise ValueError(f"Unknown key in bindings.tsv: {key}")
        if slot in slots:
            raise ValueError(f"Duplicate binding {slot}: {slots[slot]} and {key}")
        slots[slot] = key
        if row["description"] == "-" or row["source"] == "-":
            raise ValueError(f"{slot}: expected a description and upstream evidence")
        implemented = row["implementation"] != "-"
        verified = row["verification"] != "-"
        if verified and not implemented:
            raise ValueError(f"{slot}: verification requires an implementation")
        progress[key]["mapped"] += 1
        progress[key]["implemented"] += implemented
        progress[key]["verified"] += verified
    for key in palette_keys:
        progress[key]["editable"] = 1
    return palette, fields, progress, coverage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, help="Compare against the pinned colors.palette")
    parser.add_argument("--report", action="store_true", help="Print progress for every field as TSV")
    args = parser.parse_args()
    try:
        palette, fields, progress, coverage = check_catalog(ROOT / "catalog", args.upstream)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")

    if args.report:
        writer = csv.writer(sys.stdout, delimiter="\t", lineterminator="\n")
        writer.writerow(("key", "kind", "mapped", "implemented", "verified", "task", "editable", "comment"))
        for row in palette + fields:
            counts = progress[row["key"]]
            coverage_row = coverage.get(row["key"], {})
            writer.writerow((
                row["key"], row.get("kind", "palette"),
                counts["mapped"], counts["implemented"], counts["verified"],
                coverage_row.get("task", "-"), counts["editable"],
                coverage_row.get("comment", row.get("description", "-")),
            ))
    else:
        print(f"OK: {len(palette)} palette keys, {len(fields)} additional fields")
        totals = defaultdict(Counter)
        stages = ("mapped", "implemented", "editable", "verified")
        for key, row in coverage.items():
            group = totals[row["task"]]
            group["keys"] += 1
            for stage in stages:
                group[stage] += progress[key][stage] > 0
        print("task\tkeys\t" + "\t".join(stages))
        for task in COVERAGE_TASKS:
            group = totals[task]
            print("\t".join([task, *(str(group[stage]) for stage in ("keys", *stages))]))


if __name__ == "__main__":
    main()
