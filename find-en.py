import json, re, pathlib

possible = [
    pathlib.Path("messages/zh.json"),
    pathlib.Path("src/messages/zh.json"),
    pathlib.Path("wacrmhaisic-crm/messages/zh.json"),
]
file = None
for p in possible:
    if p.exists():
        file = p
        break
if not file:
    for p in pathlib.Path(".").rglob("zh.json"):
        file = p
        break

print(f"找到文件: {file}\n")

def scan(obj, prefix=""):
    bad = []
    if isinstance(obj, dict):
        for k,v in obj.items():
            bad += scan(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(obj, str):
        if len(obj.strip()) > 0 and len([c for c in obj if 'a'<=c<='z' or 'A'<=c<='Z']) > len(obj)*0.5:
            bad.append((prefix, obj))
    return bad

import json as _j
data = _j.loads(file.read_text(encoding='utf-8'))
for k,v in scan(data):
    print(f"{k}: {v}")