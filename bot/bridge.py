#!/usr/bin/env python3
"""جسر Claude ↔ بوت أقصى الفرات (Google Apps Script).

يحتاج متغيرين بالبيئة:
  BOT_URL  رابط الـ Web app (ينتهي بـ /exec)
  BOT_KEY  مفتاح API من showConfig()

الأوامر:
  bridge.py list [status]                     الطلبات الجديدة (أو حالة معيّنة، "" = الكل)
  bridge.py files <id>                        مرفقات الطلب (ids بالدرايف)
  bridge.py update <id> <status> [note] [--notify]
  bridge.py upload <id> <file>...             يرفع ملفات النتائج لمجلد "النتائج"
  bridge.py deliver <id> [--manager] [--msg النص]
  bridge.py notify <manager|all|chat_id> <text>

الملفات ترتفع من هنا مباشرة كـ base64، فما تمر على المحادثة.
"""
import base64
import json
import mimetypes
import os
import sys
import urllib.request

MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".zip": "application/zip",
}


def call(payload):
    url = os.environ.get("BOT_URL")
    key = os.environ.get("BOT_KEY")
    if not url or not key:
        sys.exit("BOT_URL و BOT_KEY لازم يكونون بالبيئة")
    payload["api_key"] = key
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # Apps Script يرد بتحويل 302 لرابط النتيجة، وurllib يتبعه بـ GET تلقائياً
    with urllib.request.urlopen(req, timeout=300) as res:
        body = json.loads(res.read().decode("utf-8"))
    if not body.get("ok"):
        sys.exit("خطأ من البوت: " + str(body.get("error")))
    return body


def flag(args, name):
    if name in args:
        args.remove(name)
        return True
    return False


def option(args, name):
    if name in args:
        i = args.index(name)
        value = args[i + 1]
        del args[i : i + 2]
        return value
    return None


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd, args = argv[0], argv[1:]

    if cmd == "list":
        payload = {"action": "list"}
        if args:
            payload["status"] = args[0]
        out = call(payload)["requests"]
    elif cmd == "files":
        out = call({"action": "files", "id": args[0]})
    elif cmd == "update":
        notify = flag(args, "--notify")
        out = call({"action": "update", "id": args[0], "status": args[1],
                    "note": args[2] if len(args) > 2 else "", "notify": notify})
    elif cmd == "upload":
        rid, paths = args[0], args[1:]
        out = []
        for p in paths:
            ext = os.path.splitext(p)[1].lower()
            mime = MIME.get(ext) or mimetypes.guess_type(p)[0] or "application/octet-stream"
            with open(p, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("ascii")
            r = call({"action": "upload", "id": rid, "name": os.path.basename(p), "mime": mime, "b64": b64})
            out.append({"name": os.path.basename(p), "file_id": r["file_id"]})
    elif cmd == "deliver":
        manager = flag(args, "--manager")
        msg = option(args, "--msg") or ""
        out = call({"action": "deliver", "id": args[0], "message": msg, "to_manager": manager})
    elif cmd == "notify":
        out = call({"action": "notify", "target": args[0], "text": " ".join(args[1:])})
    else:
        sys.exit("أمر غير معروف: " + cmd)

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
