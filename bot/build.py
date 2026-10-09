#!/usr/bin/env python3
"""يولّد single/Code.gs من ملفات apps-script/ بالترتيب الصحيح."""
import os

ORDER = "Config Telegram Storage Bot Search Tenders Admin Office Api Setup Poll Worker".split()
HERE = os.path.dirname(os.path.abspath(__file__))
HEAD = ("// بوت أقصى الفرات — كل الكود بملف واحد. انسخه كامل لملف Code.gs بـ Apps Script.\n"
        "// مولّد من مجلد apps-script/ (لا تعدّل هنا، عدّل الملفات الأصلية وأعد التوليد).\n\n")

parts = []
for name in ORDER:
    with open(os.path.join(HERE, "apps-script", name + ".gs"), encoding="utf-8") as fh:
        parts.append("// ===== %s.gs =====\n%s" % (name, fh.read().rstrip("\n") + "\n"))
with open(os.path.join(HERE, "single", "Code.gs"), "w", encoding="utf-8") as fh:
    fh.write(HEAD + "\n".join(parts))
print("single/Code.gs جاهز")
