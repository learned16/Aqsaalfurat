#!/usr/bin/env python3
"""أوامر Excel وWord للمكتب، بدون ما يفتح البرنامج (ما يصرف توكنز، وما يحتاج شاشة).

يستدعى من agent.ps1 (أمر pc office): يقرا طلب JSON من ملف ويطبع نتيجة JSON.
  python3 office.py <request.json>

الطلب: {"op": "...", "path": "...", ...}
  xlsx_read   path [sheet] [max]            يرجّع صفوف الورقة (أول max صف)
  xlsx_sheets path                          أسماء الأوراق
  xlsx_set    path cells {"A1": "..", ...} [sheet]   يكتب خلايا (نص، رقم، أو معادلة تبدي بـ =)
  xlsx_append path row ["..", ..] [sheet]   يضيف صف بالآخر
  docx_read   path [max]                    نص المستند
  docx_replace path repl {"قديم":"جديد"}    استبدال نص بالمستند (يحافظ على التنسيق قدر الإمكان)

الكتابة تصير على نسخة البرنامج بعد ما agent.ps1 يحفظ النسخة القديمة. ما يمسح شي.
"""
import json
import sys


def _ws(wb, sheet):
    if sheet:
        if sheet not in wb.sheetnames:
            raise ValueError("ماكو ورقة باسم: " + sheet)
        return wb[sheet]
    return wb.active


def xlsx_read(req):
    import openpyxl
    wb = openpyxl.load_workbook(req["path"], data_only=bool(req.get("data_only", True)))
    ws = _ws(wb, req.get("sheet"))
    mx = int(req.get("max", 200))
    rows = []
    for r in ws.iter_rows(values_only=True):
        rows.append(["" if v is None else v for v in r])
        if len(rows) >= mx:
            break
    return {"sheet": ws.title, "rows": rows, "dims": ws.dimensions}


def xlsx_sheets(req):
    import openpyxl
    wb = openpyxl.load_workbook(req["path"], read_only=True)
    return {"sheets": wb.sheetnames}


def xlsx_set(req):
    import openpyxl
    wb = openpyxl.load_workbook(req["path"])
    ws = _ws(wb, req.get("sheet"))
    cells = req["cells"]
    if not isinstance(cells, dict) or len(cells) > 500:
        raise ValueError("cells لازم يكون كائن فيه 500 خلية أو أقل")
    for ref, val in cells.items():
        ws[ref] = val
    wb.save(req["path"])
    return {"sheet": ws.title, "written": len(cells)}


def xlsx_append(req):
    import openpyxl
    wb = openpyxl.load_workbook(req["path"])
    ws = _ws(wb, req.get("sheet"))
    row = req["row"]
    if not isinstance(row, list):
        raise ValueError("row لازم يكون قائمة")
    ws.append(row)
    wb.save(req["path"])
    return {"sheet": ws.title, "row": ws.max_row}


def docx_read(req):
    import docx
    doc = docx.Document(req["path"])
    mx = int(req.get("max", 400))
    paras = [p.text for p in doc.paragraphs if p.text.strip()][:mx]
    return {"paragraphs": paras}


def docx_replace(req):
    import docx
    doc = docx.Document(req["path"])
    repl = req["repl"]
    if not isinstance(repl, dict) or len(repl) > 200:
        raise ValueError("repl لازم يكون كائن فيه 200 بدل أو أقل")
    n = 0
    for p in doc.paragraphs:
        for run in p.runs:
            for old, new in repl.items():
                if old in run.text:
                    run.text = run.text.replace(old, new)
                    n += 1
    doc.save(req["path"])
    return {"replaced": n}


OPS = {
    "xlsx_read": xlsx_read, "xlsx_sheets": xlsx_sheets, "xlsx_set": xlsx_set,
    "xlsx_append": xlsx_append, "docx_read": docx_read, "docx_replace": docx_replace,
}


def main(argv):
    if not argv:
        sys.exit("يحتاج ملف الطلب")
    with open(argv[0], encoding="utf-8") as fh:
        req = json.load(fh)
    op = req.get("op")
    if op not in OPS:
        print(json.dumps({"ok": False, "error": "أمر office غير معروف: " + str(op)}, ensure_ascii=False))
        return
    try:
        data = OPS[op](req)
        print(json.dumps(dict(data, ok=True), ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
