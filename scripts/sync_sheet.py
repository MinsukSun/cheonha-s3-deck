#!/usr/bin/env python3
"""구글 시트(시즌3 탭)를 내려받아 data/sheet-cache.js 로 저장합니다.

사이트의 '데이터 → 지금 업데이트' 버튼과 같은 일을 오프라인 캐시용으로 수행합니다.
사용법:  python3 scripts/sync_sheet.py [시트ID]
"""
import csv, io, json, sys, urllib.request, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_ID = "17NtAf-aULDH-RtGPlWHHTGXJdg6R3yPg87uIo-F75_I"

# kind: tier(티어덱) / variant(변칙·계열덱) / coexist(공존덱) / roster(무장 도감)
TABS = [
    {"name": "시즌3 티어덱", "gid": "1443176189", "kind": "tier"},
    {"name": "시즌3 변칙, 계열덱", "gid": "1922923785", "kind": "variant"},
    {"name": "시즌3 공존덱", "gid": "474450804", "kind": "coexist"},
    {"name": "시즌3 공존덱(2)", "gid": "841351688", "kind": "coexist"},
    {"name": "무장 도감", "gid": "1134089693", "kind": "roster"},
]


def fetch(sheet_id, gid):
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&headers=0&gid={gid}"
    with urllib.request.urlopen(url, timeout=30) as r:
        text = r.read().decode("utf-8")
    grid = []
    for row in csv.reader(io.StringIO(text)):
        while row and not row[-1].strip():
            row.pop()
        grid.append(row)
    return grid


def main():
    sheet_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ID
    out = {
        "sheetId": sheet_id,
        "fetchedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "tabs": [],
    }
    for t in TABS:
        grid = fetch(sheet_id, t["gid"])
        print(f"{t['name']}: {len(grid)} rows")
        out["tabs"].append({**t, "grid": grid})
    dest = ROOT / "data" / "sheet-cache.js"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text("window.SHEET_CACHE = " + json.dumps(out, ensure_ascii=False) + ";\n", encoding="utf-8")
    print("saved", dest)


if __name__ == "__main__":
    main()
