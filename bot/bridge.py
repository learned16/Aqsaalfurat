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
  bridge.py tenders <file.json> [--push manager|all]   يحدّث مناقصات اليوم (JSON فيه tenders وbrief)
  bridge.py tenders-list

الملفات ترتفع من هنا مباشرة كـ base64، فما تمر على المحادثة.

«إيد Claude» على لابتوب الشركة (عبر وسيط Cloudflare، تحتاج PC_KEY بالبيئة، وOFFICE_URL اختياري):
  bridge.py pc roots                          المجلدات المسموحة ومجلد المصنع
  bridge.py pc ls <مسار>                       محتويات مجلد
  bridge.py pc find <مسار> <نمط>               بحث (مثل *.docx)
  bridge.py pc get <مسار> [ملف_محلي]           يسحب ملف للجلسة
  bridge.py pc put <ملف_محلي> <مسار>           يحط ملف (النسخة القديمة تنحفظ بـ _نسخ_قبل_التعديل)
  bridge.py pc mkdir <مسار> | copy <من> <إلى> | pdf <docx> [pdf] | print <مسار>
  bridge.py pc tender <طلب.xlsx|json> [--dry]  يبني مناقصة بالمصنع (ملف محلي أو مسار باللابتوب)
  bridge.py pc check <مسار_طلب> | docs [أيام]
  bridge.py pc status | printers | log [سطور] | zip <مجلد> [ملف.zip]
  bridge.py pc office <xlsx_read|xlsx_sheets|xlsx_set|xlsx_append|docx_read|docx_replace> <مسار> [--json '{...}']
       مثال: office xlsx_read "G:\\...\\سجل.xlsx" | office xlsx_set <مسار> --json '{"cells":{"B2":777}}'
مكتبة الأوامر الحساسة (توصل لصاحب البوت بتلغرام وما تتنفذ إلا يوافق خلال ساعة):
  bridge.py pc install <sumatra|libreoffice|python|gdrive|7zip|chrome|acrobat>
  bridge.py pc default_printer "<اسم الطابعة>" | clear_queue | close_word | wake_time 07:45
  bridge.py pc screenshot [ملف.png]
  bridge.py pc open_url <https://...>         يفتح رابط بالمتصفح على اللابتوب
  bridge.py pc update [--notes "شنو تغيّر"]  يحزم bot/laptop (النسخة من VERSION)، يوقّعه بـ UPDATE_KEY،
                                              يحطه بمجلد المصنع («_تحديثات»)، ويطلب الموافقة للتنصيب
اللابتوب يسأل كل 5 ثواني، فالنتيجة توصل خلال ثواني إذا شغّال.
"""
import base64
import json
import mimetypes
import os
import sys
import time
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
    # Apps Script يرجّع أحياناً صفحة HTML بدل JSON (ضغط مؤقت)، فنعيد المحاولة
    body = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                body = json.loads(res.read().decode("utf-8"))
            break
        except (ValueError, OSError):
            time.sleep(2 * (attempt + 1))
    if body is None:
        sys.exit("البوت ما رد بشكل صحيح بعد 4 محاولات (Apps Script مشغول). جرّب بعد دقيقة.")
    if not body.get("ok"):
        sys.exit("خطأ من البوت: " + str(body.get("error")))
    return body


OFFICE_URL = "https://aqsa-bot.companyaqsaalfurat.workers.dev"


def pc_call(op, args, wait=600):
    base = os.environ.get("OFFICE_URL", OFFICE_URL).rstrip("/")
    key = os.environ.get("PC_KEY")
    if not key:
        sys.exit("PC_KEY لازم يكون بالبيئة (نفس PC_KEY بإعدادات الوسيط)")
    hdr = {"Content-Type": "application/json", "X-PC-Key": key, "User-Agent": "aqsa-bridge"}
    req = urllib.request.Request(base + "/pc/cmd", data=json.dumps({"op": op, "args": args}).encode("utf-8"),
                                 headers=hdr, method="POST")
    with urllib.request.urlopen(req, timeout=120) as res:
        sent = json.loads(res.read().decode("utf-8"))
    if not sent.get("ok"):
        sys.exit("الوسيط رفض: " + str(sent.get("error")))
    if sent.get("awaiting_approval"):
        print("🟡 الأمر يحتاج موافقة صاحب البوت بتلغرام؛ أنتظر (لحد ساعة)…", file=sys.stderr)
        wait = max(wait, 3700)
    if sent.get("now", 0) - sent.get("seen", 0) > 6 * 60 * 1000:
        print("⚠️ اللابتوب ما سأل من أكثر من 6 دقايق (مطفي أو نايم)؛ الأمر ينتظر بالطابور.", file=sys.stderr)
    deadline = time.time() + wait
    while time.time() < deadline:
        time.sleep(3)
        r = urllib.request.Request(base + "/pc/result?id=" + sent["id"], headers=hdr)
        try:
            with urllib.request.urlopen(r, timeout=60) as res:
                body = json.loads(res.read().decode("utf-8"))
        except OSError:
            continue
        if body.get("pending"):
            continue
        if not body.get("ok"):
            sys.exit("اللابتوب: " + str(body.get("error")))
        return body.get("data")
    sys.exit("ما وصلت نتيجة خلال %d ثانية (الأمر %s بالطابور)" % (wait, sent["id"]))


def pc_main(args):
    op, rest = args[0], args[1:]
    if op == "get":
        data = pc_call("get", {"path": rest[0]})
        out = rest[1] if len(rest) > 1 else data["name"]
        with open(out, "wb") as fh:
            fh.write(base64.b64decode(data["b64"]))
        return {"saved": out, "from": data["path"]}
    if op == "put":
        with open(rest[0], "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        return pc_call("put", {"path": rest[1], "b64": b64})
    if op == "screenshot":
        data = pc_call("screenshot", {})
        out = rest[0] if rest else "screen.png"
        with open(out, "wb") as fh:
            fh.write(base64.b64decode(data["b64"]))
        return {"saved": out}
    if op == "update":
        return pc_update(rest)
    if op == "office":
        sub = rest[0]
        extra = option(rest, "--json")
        args = json.loads(extra) if extra else {}
        args["op"] = sub
        args["path"] = rest[1]
        return pc_call("office", args)
    if op == "open_url":
        return pc_call("open_url", {"url": rest[0]})
    if op == "tender":
        dry = flag(rest, "--dry")
        src = rest[0]
        if os.path.isfile(src):
            with open(src, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("ascii")
            return pc_call("tender", {"b64": b64, "name": os.path.basename(src), "dry": dry}, wait=900)
        return pc_call("tender", {"path": src, "dry": dry}, wait=900)
    simple = {
        "roots": lambda: {}, "ls": lambda: {"path": rest[0]},
        "find": lambda: {"path": rest[0], "pattern": rest[1] if len(rest) > 1 else "*"},
        "mkdir": lambda: {"path": rest[0]}, "copy": lambda: {"from": rest[0], "to": rest[1]},
        "pdf": lambda: {"path": rest[0], "out": rest[1] if len(rest) > 1 else ""},
        "print": lambda: {"path": rest[0]}, "check": lambda: {"path": rest[0]},
        "docs": lambda: {"days": rest[0] if rest else "30"},
        "status": lambda: {}, "printers": lambda: {}, "clear_queue": lambda: {}, "close_word": lambda: {},
        "log": lambda: {"lines": rest[0] if rest else "80"},
        "zip": lambda: {"path": rest[0], "out": rest[1] if len(rest) > 1 else ""},
        "install": lambda: {"name": rest[0]}, "default_printer": lambda: {"name": rest[0]},
        "wake_time": lambda: {"time": rest[0]},
    }
    if op not in simple:
        sys.exit("أمر pc غير معروف: " + op)
    return pc_call(op, simple[op]())


def pc_update(rest):
    key = os.environ.get("UPDATE_KEY")
    if not key:
        sys.exit("UPDATE_KEY لازم يكون بالبيئة (نفس رمز التحديث اللي انكتب وقت تنصيب اللابتوب)")
    notes = option(rest, "--notes") or ""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "laptop"))
    import package
    ver = package.version()
    zpath = package.update_zip()
    sha = package.sha256_file(zpath)
    roots = pc_call("roots", {})
    if not roots.get("data"):
        sys.exit("مجلد المصنع مو مضبوط باللابتوب")
    target = roots["data"].rstrip("\\") + "\\_تحديثات\\" + zpath.name
    with open(zpath, "rb") as fh:
        pc_call("put", {"path": target, "b64": base64.b64encode(fh.read()).decode("ascii")})
    print("📦 انحط %s باللابتوب؛ هسه ينتظر موافقتك بتلغرام" % zpath.name, file=sys.stderr)
    return pc_call("update", {"version": ver, "notes": notes[:300], "file": target,
                              "sha256": sha, "sig": package.sign(key, ver, sha)})


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
    elif cmd == "tenders":
        push = option(args, "--push")
        with open(args[0], encoding="utf-8") as fh:
            data = json.load(fh)
        out = call({"action": "tenders_sync", "tenders": data.get("tenders", []),
                    "brief": data.get("brief"), "push": push or False})
    elif cmd == "pc":
        out = pc_main(args)
    elif cmd == "tenders-list":
        out = call({"action": "tenders_list"})["tenders"]
    else:
        sys.exit("أمر غير معروف: " + cmd)

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
