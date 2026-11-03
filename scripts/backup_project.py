#!/usr/bin/env python3
"""Create or inspect a project backup archive. JSON-in/JSON-out over stdin/stdout."""
import base64
import io
import json
import re
import sys
import zipfile

MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 100 * 1024 * 1024
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}(?:\.[A-Za-z0-9_-]{1,10})?$")


def main():
    request = json.load(sys.stdin)
    if request.get("operation") == "create":
        workspace = request.get("workspace")
        files = request.get("files", [])
        if not isinstance(workspace, dict) or not isinstance(files, list):
            raise ValueError("备份数据结构无效。")
        output = io.BytesIO()
        manifest = {"format": "project-collab-backup", "version": 1, "workspace": workspace,
                    "files": [{k: v for k, v in item.items() if k != "bytes"} for item in files]}
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
            total = 0
            for item in files:
                storage = item.get("storage", "")
                raw = base64.b64decode(item.get("bytes", ""), validate=True)
                if not SAFE_ID.fullmatch(storage) or len(raw) > MAX_FILE:
                    raise ValueError("附件名称或大小无效。")
                total += len(raw)
                if total > MAX_TOTAL:
                    raise ValueError("项目附件总量超过100MB，无法打包。")
                archive.writestr("files/" + storage, raw)
        print(json.dumps({"archive": base64.b64encode(output.getvalue()).decode("ascii")}))
        return

    if request.get("operation") == "restore":
        raw = base64.b64decode(request.get("archive", ""), validate=True)
        if len(raw) > MAX_TOTAL + 10 * 1024 * 1024:
            raise ValueError("备份文件超过允许大小。")
        with zipfile.ZipFile(io.BytesIO(raw), "r") as archive:
            names = archive.namelist()
            if len(names) > 1001 or any(name.startswith("/") or ".." in name.split("/") for name in names):
                raise ValueError("备份文件目录结构无效。")
            info = archive.getinfo("manifest.json")
            if info.file_size > 10 * 1024 * 1024:
                raise ValueError("备份清单异常过大。")
            manifest = json.loads(archive.read(info))
            if manifest.get("format") != "project-collab-backup" or manifest.get("version") != 1:
                raise ValueError("不支持该备份格式。")
            files = manifest.get("files", [])
            if not isinstance(files, list) or len(files) > 1000:
                raise ValueError("备份附件清单无效。")
            total = 0
            for item in files:
                storage = item.get("storage", "")
                if not SAFE_ID.fullmatch(storage):
                    raise ValueError("备份附件名称无效。")
                info = archive.getinfo("files/" + storage)
                if info.file_size > MAX_FILE:
                    raise ValueError("备份中存在超过20MB的附件。")
                total += info.file_size
                if total > MAX_TOTAL:
                    raise ValueError("备份附件总量超过100MB。")
                item["bytes"] = base64.b64encode(archive.read(info)).decode("ascii")
        print(json.dumps(manifest, ensure_ascii=False))
        return

    raise ValueError("备份操作无效。")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
