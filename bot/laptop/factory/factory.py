#!/usr/bin/env python3
"""مصنع مناقصات أقصى الفرات: يبني الحزمة كاملة بدون Claude (بدون توكنز).

    python factory.py init  <مجلد_البيانات>            يسوي ملفات البيانات أول مرة (ما يكتب فوك الموجود)
    python factory.py build <طلب.xlsx|طلب.json> [--data DIR] [--dry]
    python factory.py check <طلب.xlsx|طلب.json> [--data DIR]   فحص بس، بدون بناء
    python factory.py docs  [--data DIR]               المستمسكات المنتهية أو اللي قربت تنتهي

مجلد البيانات («مصنع المناقصات» بالدرايف) بيه:
    الإعدادات.json      مجلد الأرشيف، وين ينحفظ الناتج
    الشركات.json        الاسم القانوني، المدير، نموذج الكتاب، الرقم الصادر التالي
    الجهات/*.json       وصفة كل جهة: سطر «الى»، التسليم، المدد، التعهدات، المتطلبات، الترتيب
    مستمسكات.xlsx       مستمسكات كل شركة ويه تاريخ الانتهاء
    طلب مناقصة.xlsx     نموذج فارغ يتعبى لكل مناقصة
    طلبات/              أي طلب ينحط هنا يتبنى وحده (برنامج اللابتوب يراقبه)
    سجل الصادر.xlsx، سجل المناقصات.xlsx، حالة.json   يتحدثون وحدهم

الناتج يروح لمجلد الأرشيف بالدرايف (Google Drive للكمبيوتر يرفعه وحده):
    كتب/ (Word)، PDF لكل ورقة، «الحزمة الكاملة» PDF مرقّم ويه غلاف وفهرس،
    ملصقات الأظرف، تقرير الفحص والمتبقي على الشركة، وzip بالوورد.

آخر سطر يطبعه JSON بالنتيجة (برنامج اللابتوب يقراه ويدز الخلاصة للبوت).
"""
import argparse
import datetime as dt
import glob
import json
import os
import random
import re
import shutil
import sys
import traceback
import zipfile
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import wording as W  # noqa: E402
from tafqit import tafqit, money  # noqa: E402

YES = ('نعم', 'اي', 'إي', 'ايه', 'yes', 'y', 'true', '1', 'صح')

# عناوين نموذج الطلب ← المفاتيح الداخلية
JOB_KEYS = [
    ('الشركة', 'company', 'اسم الشركة المختصر، مثل: أقصى الفرات'),
    ('الجهة', 'entity', 'اسم الجهة مثل ملف الوصفة بمجلد الجهات، مثل: كهرباء الوسط'),
    ('رقم الدعوة', 'number', 'مثل: DI/LMD-17/2026'),
    ('عنوان الدعوة', 'title', 'مثل: تجهيز أسلاك متنوعة ألمنيوم + نحاس'),
    ('نوع الدعوة', 'kind', 'فارغ = من وصفة الجهة (دعوة مباشرة / مناقصة عامة)'),
    ('تاريخ الإصدار', 'issued', 'مثل: 24/9/2026 (اختياري)'),
    ('موعد الغلق', 'closing', 'YYYY-MM-DD'),
    ('نسبة الزيادة %', 'percent', 'على السعر التخميني، مثل 25. فارغ إذا كتبت سعر الوحدة بنفسك'),
    ('مكان التسليم', 'place', 'فارغ = من وصفة الجهة'),
    ('المدة (يوم)', 'days', 'مدة التجهيز أو التنفيذ. فارغ = من الوصفة'),
    ('الضمان (يوم)', 'warranty', 'فارغ = من الوصفة'),
    ('نفاذ العطاء (يوم)', 'validity', 'فارغ = من الوصفة'),
    ('المواصفة', 'spec', 'مثل: المواصفة الفنية (D-47) المعتمدة لدى وزارة الكهرباء (اختياري)'),
    ('فقرة فنية إضافية', 'tech_extra', 'تنضاف للعرض الفني كما هي (اختياري)'),
    ('فقرة تجارية إضافية', 'comm_extra', 'تنضاف للعرض التجاري كما هي (اختياري)'),
    ('تعهدات إضافية', 'und_extra', 'كل تعهد بسطر (اختياري)'),
    ('تعهد هوية الشركة', 'id_undertaking', 'نعم إذا الهوية قيد التجديد'),
    ('بدون تعهدات', 'no_undertakings', 'نعم = ما يطلع أي تعهد'),
    ('ملف القسم الرابع', 'part4', 'مسار ملف القسم الرابع المعبّى (إذا الجهة عندها نموذج). فارغ = نولّد جدول كميات مسعّر'),
    ('ملفات إضافية', 'extra_files', 'مسارات ملفات تنضاف للحزمة، كل ملف بسطر (مثل جدول مطابقة المواصفات)'),
    ('بادئة الأسماء', 'prefix', 'فارغ = تلقائي (مثل LMD-17 دعوة 17)'),
    ('ملاحظات', 'notes', 'تنكتب بالتقرير بس'),
]
ITEM_HEAD = ['المادة', 'الوحدة', 'الكمية', 'السعر التخميني', 'سعر الوحدة']


class JobError(Exception):
    pass


# ------------------------------------------------------------------- القراءة

def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding='utf-8-sig') as fh:
        return json.load(fh)


def save_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def num(v, what):
    if v is None or str(v).strip() == '':
        return None
    s = str(v).strip().replace(',', '').replace('٬', '').translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789'))
    s = s.replace('%', '')
    try:
        return Decimal(s)
    except Exception:
        raise JobError('%s مو رقم: %s' % (what, v))


def read_job(path):
    if path.lower().endswith('.json'):
        data = load_json(path)
        job = {k: data.get(k) for _, k, _ in JOB_KEYS}
        for ar, k, _ in JOB_KEYS:
            if job.get(k) is None and ar in data:
                job[k] = data[ar]
        items = data.get('items') or data.get('المواد') or []
        job['items'] = [{
            'name': it.get('name') or it.get('المادة'),
            'unit': it.get('unit') or it.get('الوحدة') or '',
            'qty': it.get('qty') if it.get('qty') is not None else it.get('الكمية'),
            'base': it.get('base') if it.get('base') is not None else it.get('السعر التخميني'),
            'price': it.get('price') if it.get('price') is not None else it.get('سعر الوحدة'),
        } for it in items]
        return job
    from openpyxl import load_workbook
    wb = load_workbook(path, data_only=True)
    job = {}
    labels = {ar: k for ar, k, _ in JOB_KEYS}
    ws = wb['البيانات'] if 'البيانات' in wb.sheetnames else wb.worksheets[0]
    for row in ws.iter_rows(min_row=1, values_only=True):
        if not row or row[0] is None:
            continue
        key = labels.get(str(row[0]).strip())
        if key:
            job[key] = row[1]
    items = []
    if 'المواد' in wb.sheetnames:
        ws = wb['المواد']
        head = None
        for row in ws.iter_rows(values_only=True):
            if head is None:
                head = [str(c).strip() if c is not None else '' for c in row]
                continue
            if not row or all(c is None or str(c).strip() == '' for c in row):
                continue
            rec = dict(zip(head, row))
            items.append({'name': rec.get('المادة'), 'unit': rec.get('الوحدة') or '',
                          'qty': rec.get('الكمية'), 'base': rec.get('السعر التخميني'),
                          'price': rec.get('سعر الوحدة')})
    job['items'] = items
    return job


def s(v):
    return '' if v is None else str(v).strip()


def yes(v):
    return s(v).lower() in YES


def fmt_date(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime('%Y-%m-%d')
    return s(v)


def parse_date(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    t = s(v).translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789'))
    for f in ('%Y-%m-%d', '%Y/%m/%d', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return dt.datetime.strptime(t, f).date()
        except ValueError:
            pass
    return None


# -------------------------------------------------------------------- البيانات

class Data:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        if not os.path.isdir(self.root):
            raise JobError('مجلد البيانات مو موجود: ' + self.root)
        self.settings = load_json(self.p('الإعدادات.json'), {}) or {}
        self.companies = load_json(self.p('الشركات.json'), {}) or {}
        self.state = load_json(self.p('حالة.json'), {}) or {}

    def p(self, *parts):
        return os.path.join(self.root, *parts)

    def company(self, name):
        name = s(name)
        if name in self.companies:
            return name, self.companies[name]
        for k, v in self.companies.items():
            if name and (name in k or k in name or name in v.get('الاسم_القانوني', '')):
                return k, v
        raise JobError('الشركة «%s» مو موجودة بالشركات.json (الموجود: %s)' % (name, '، '.join(self.companies)))

    def entity(self, name):
        name = s(name)
        files = sorted(glob.glob(self.p('الجهات', '*.json')))
        names = {os.path.splitext(os.path.basename(f))[0]: f for f in files}
        hit = names.get(name) or next((f for n, f in names.items() if name and (name in n or n in name)), None)
        if not hit:
            hit = names.get('عام')
            if not hit:
                raise JobError('ماكو وصفة للجهة «%s» ولا وصفة «عام»' % name)
        prof = load_json(hit)
        prof['_name'] = os.path.splitext(os.path.basename(hit))[0]
        return prof

    def archive_root(self):
        root = s(self.settings.get('مجلد_الأرشيف'))
        if root and os.path.isdir(root):
            return root
        found = find_archive()
        if found:
            self.settings['مجلد_الأرشيف'] = found
            save_json(self.p('الإعدادات.json'), self.settings)
            return found
        return None

    def documents(self, company):
        """مستمسكات الشركة من مستمسكات.xlsx."""
        path = self.p('مستمسكات.xlsx')
        out = []
        if not os.path.exists(path):
            return out
        from openpyxl import load_workbook
        ws = load_workbook(path, data_only=True).worksheets[0]
        head = None
        for row in ws.iter_rows(values_only=True):
            if head is None:
                head = [s(c) for c in row]
                continue
            rec = dict(zip(head, row))
            if not s(rec.get('المستمسك')):
                continue
            comp = s(rec.get('الشركة'))
            if comp and company and comp not in company and company not in comp:
                continue
            out.append({'name': s(rec.get('المستمسك')), 'file': s(rec.get('الملف')),
                        'expiry': parse_date(rec.get('تاريخ الانتهاء')), 'company': comp})
        return out

    def resolve(self, rel):
        """مسار ملف: مطلق، أو نسبة لمجلد البيانات، أو لمجلد الأرشيف، أو بالاسم داخل الأرشيف."""
        rel = s(rel)
        if not rel:
            return None
        cands = [rel, self.p(rel), self.p('المستمسكات', rel)]
        arch = self.archive_root()
        if arch:
            cands.append(os.path.join(arch, rel))
        for c in cands:
            if os.path.isfile(c):
                return c
        if arch:
            base = os.path.basename(rel)
            for dirpath, _, files in os.walk(arch):
                if base in files:
                    return os.path.join(dirpath, base)
        return None


def find_archive():
    """يدوّر على مجلد الأرشيف (اللي بيه 03_مناقصات_مقدمة) بـ Google Drive للكمبيوتر."""
    roots = []
    for letter in 'GHIJKLMNOPDEF':
        for sub in ('My Drive', 'محرك Drive الخاص بي', 'Mon Drive'):
            roots.append('%s:\\%s' % (letter, sub))
    home = os.path.expanduser('~')
    roots += [os.path.join(home, 'Google Drive'), os.path.join(home, 'My Drive')]
    for r in roots:
        if not os.path.isdir(r):
            continue
        for dirpath, dirs, _ in os.walk(r):
            if '03_مناقصات_مقدمة' in dirs:
                return dirpath
            if dirpath.count(os.sep) - r.count(os.sep) >= 2:
                dirs[:] = []
    return None


# ----------------------------------------------------------------------- البناء

class Builder:
    def __init__(self, data, job, dry=False, log=print):
        self.data, self.job, self.dry, self.log = data, job, dry, log
        self.warnings, self.errors = [], []
        self.remaining = []
        self.numbers = []
        self.files = []        # (عنوان، مسار PDF، مسار Word أو None، داخل الحزمة؟)

    # ---------------------------------------------------------------- التحضير
    def prepare(self):
        job, data = self.job, self.data
        self.company_key, self.company = data.company(job.get('company'))
        self.profile = data.entity(job.get('entity'))
        pr = self.profile
        for need in ('number', 'title'):
            if not s(job.get(need)):
                raise JobError('ناقص بالطلب: ' + dict((k, a) for a, k, _ in JOB_KEYS)[need])
        self.to_name = s(pr.get('الى')) or s(job.get('entity'))
        if s(job.get('id_undertaking')) == '':
            job['id_undertaking'] = 'نعم' if self.company.get('الهوية_قيد_التجديد') else 'لا'
        self.kind = s(job.get('kind')) or pr.get('نوع_الدعوة', 'المناقصة')
        if not self.kind.startswith('ال'):
            self.kind = 'ال' + self.kind
        self.works = pr.get('النوع') == 'أعمال'
        self.place = s(job.get('place')) or pr.get('مكان_التسليم', '')
        self.days = s(job.get('days')) or s(pr.get('المدة'))
        self.warranty = s(job.get('warranty')) or s(pr.get('الضمان'))
        self.validity = s(job.get('validity')) or s(pr.get('نفاذ_العطاء', 90))
        self.closing = parse_date(job.get('closing'))
        if s(job.get('closing')) and not self.closing:
            self.warnings.append('موعد الغلق مو مفهوم: ' + s(job.get('closing')))
        if self.closing and self.closing < dt.date.today():
            self.warnings.append('⚠️ موعد الغلق (%s) فات!' % self.closing)
        for what, v in (('مكان التسليم', self.place), ('المدة', self.days), ('الضمان', self.warranty)):
            if not v:
                self.warnings.append('ناقص: %s (لا بالطلب ولا بوصفة الجهة)، انترك فارغ' % what)
        self.price_items()
        self.prefix = s(job.get('prefix')) or self.auto_prefix()
        self.rng = random.Random('%s|%s' % (self.company_key, job.get('number')))
        self.ctx = {
            'company_full': self.company.get('الاسم_القانوني', self.company_key),
            'kind': self.kind,
            'kind_l': 'ل' + self.kind[1:] if self.kind.startswith('ال') else 'ل' + self.kind,
            'kind_b': 'ب' + self.kind,
            'number': s(job.get('number')),
            'title': s(job.get('title')),
            'issued_phrase': (' الصادرة في ' + fmt_date(job.get('issued'))) if s(job.get('issued')) else '',
            'verb_tech': 'تنفيذ الأعمال' if self.works else 'تجهيز المواد',
            'verb_tech_noun': 'تنفيذ الأعمال' if self.works else 'تجهيز المواد',
            'spec_phrase': (' طبقاً لـ' + s(job.get('spec'))) if s(job.get('spec')) else '',
            'place': self.place or '..........', 'days': self.days or '....',
            'warranty': self.warranty or '....', 'validity': self.validity or '....',
            'total': money(self.total), 'total_words': tafqit(self.total),
        }
        self.ctx['kind_l'] = 'لل' + self.kind[2:] if self.kind.startswith('ال') else 'ل' + self.kind

    def auto_prefix(self):
        n = s(self.job.get('number'))
        m = re.search(r'LMD-?\s*(\d+)', n, re.I)
        if m:
            return 'LMD-%s دعوة %s' % (m.group(1), m.group(1))
        return re.sub(r'[\\/:*?"<>|]+', '-', n).strip('- ')

    def price_items(self):
        pct = num(self.job.get('percent'), 'نسبة الزيادة')
        dec = int(self.profile.get('مراتب_السعر', 2))
        q = Decimal(1).scaleb(-dec)
        self.items = []
        total = Decimal(0)
        if not self.job.get('items'):
            raise JobError('ماكو مواد بالطلب (ورقة «المواد»)')
        for i, it in enumerate(self.job['items'], 1):
            name = s(it.get('name'))
            qty = num(it.get('qty'), 'كمية المادة %d' % i)
            price = num(it.get('price'), 'سعر المادة %d' % i)
            base = num(it.get('base'), 'السعر التخميني للمادة %d' % i)
            if not name or qty is None:
                raise JobError('المادة %d ناقصة الاسم أو الكمية' % i)
            if price is None:
                if base is None or pct is None:
                    raise JobError('المادة %d (%s) ماكو سعر وحدة، ولا سعر تخميني ويه نسبة' % (i, name))
                price = (base * (1 + pct / 100)).quantize(q, rounding=ROUND_HALF_UP)
            amount = qty * price
            # تأكيد الحساب: الكمية × السعر = المبلغ
            assert amount == qty * price and amount >= 0
            total += amount
            self.items.append({'i': i, 'name': name, 'unit': s(it.get('unit')), 'qty': qty,
                               'price': price, 'amount': amount, 'base': base})
        self.total = total
        assert self.total == sum(x['amount'] for x in self.items)

    def pick(self, slot, options):
        """يختار صياغة ما انستعملت بآخر مناقصة لنفس الشركة."""
        st = self.data.state.setdefault('صياغات', {}).setdefault(self.company_key, {})
        last = st.get(slot)
        idx = [i for i in range(len(options)) if i != last] or [0]
        choice = self.rng.choice(idx)
        st[slot] = choice
        return options[choice].format(**self.ctx)

    def next_number(self):
        c = self.company
        n = int(c.get('الرقم_التالي', 1))
        skip = set(int(x) for x in c.get('أرقام_متخطاة', []))
        used = set(self.numbers)
        while n in skip or n in used:
            n += 1
        self.numbers.append(n)
        return n

    # ------------------------------------------------------------------ الكتب
    def template(self):
        from docx_tools import LetterTemplate
        path = self.data.resolve(self.company.get('مسار_نموذج_الكتاب')) or \
            self.data.resolve(self.company.get('نموذج_الكتاب'))
        if not path:
            raise JobError('ما لكيت نموذج كتاب الشركة «%s». حط مساره بالشركات.json (مسار_نموذج_الكتاب)'
                           % self.company.get('نموذج_الكتاب'))
        if path != self.company.get('مسار_نموذج_الكتاب'):
            self.company['مسار_نموذج_الكتاب'] = path
        self.tpl = LetterTemplate(path)
        return self.tpl

    def letter(self, fname, subject, paras, number=True, table=None, table_after=0, closing=True):
        """يبني كتاب. paras: قائمة (نوع، نص) والنوع body أو item."""
        from docx_tools import make_para, insert_before, set_number, make_table, doc_text
        tpl = self.tpl
        doc, anchor = tpl.new_document()
        P = tpl.proto
        to_line = 'الى / ' + self.to_name
        els = [make_para(P['to'], to_line), make_para(P['subject'], subject)]
        for i, (kind, text) in enumerate(paras):
            els.append(make_para(P['body'], text))
            if table is not None and i == table_after:
                els.append(make_table(doc, P['body'], table, bold_last=True))
        if closing:
            els.append(make_para(P['closing'], self.pick('closing', W.CLOSING)))
        for el in els:
            insert_before(doc, anchor, el)
        no = None
        if number:
            no = self.next_number()
            if not set_number(doc, no):
                self.warnings.append('ما لكيت سطر «العدد» بنموذج الكتاب، الرقم %s ما انكتب بـ%s' % (no, fname))
        else:
            set_number(doc, '')
        text = doc_text(doc)
        if '{' in text or '}' in text:
            self.errors.append('بقى حقل فارغ {} داخل ' + fname)
        doc.save(fname)
        return no

    def plain(self, fname, blocks):
        """ورقة بدون عدد (غلاف، فهرس، ملصقات، تقرير). blocks: (نوع، نص أو صفوف)."""
        from docx_tools import make_para, insert_before, make_table, page_break, _set_center
        tpl = self.tpl
        doc, anchor = tpl.new_document()
        tpl.strip_header_block(doc)
        # نشيل التوقيع والإيميل بالأوراق الداخلية
        from docx.oxml.ns import qn
        body = doc.element.body
        if anchor is not None:
            k = anchor
            while k is not None and k.tag != qn('w:sectPr'):
                nxt = k.getnext()
                body.remove(k)
                k = nxt
            anchor = None
        P = tpl.proto
        for kind, val in blocks:
            if kind == 'title':
                el = _set_center(make_para(P['subject'], val, bold=True, size=20))
            elif kind == 'center':
                el = _set_center(make_para(P['body'], val, size=15))
            elif kind == 'line':
                el = make_para(P['body'], val)
            elif kind == 'table':
                el = make_table(doc, P['body'], val)
            elif kind == 'break':
                el = page_break(P['blank'])
            elif kind == 'gap':
                el = make_para(P['body'], ' ')
            insert_before(doc, anchor, el)
        doc.save(fname)

    # ------------------------------------------------------------------- كلشي
    def build(self, out_dir):
        from pdf_tools import Converter, merge, page_count
        self.prepare()
        self.template()
        os.makedirs(out_dir, exist_ok=True)
        words = os.path.join(out_dir, 'كتب')
        os.makedirs(words, exist_ok=True)
        cname = self.company_key
        name = lambda seq, title, no=None: '%s - %s %s%s - %s' % (
            self.prefix, seq, title, (' (%s)' % no) if no else '', cname)
        ctx, job, pr = self.ctx, self.job, self.profile
        sections = []   # (عنوان، docx أو ملف جاهز)
        seq = 0

        order = pr.get('الترتيب') or ['عرض فني', 'القسم الرابع', 'ملفات إضافية', 'تعهدات', 'عرض تجاري']
        for part in order:
            if part == 'عرض فني':
                seq += 1
                paras = [('body', self.pick('tech_open', W.TECH_OPEN))]
                for it in self.items:
                    paras.append(('item', self.pick_item(it)))
                for extra in (pr.get('فقرات_فنية') or []) + [s(job.get('tech_extra'))]:
                    if extra:
                        paras.append(('body', extra.format(**ctx)))
                paras.append(('body', self.pick('delivery', W.WORKS_DELIVERY if self.works else W.TECH_DELIVERY)))
                tmp = os.path.join(words, 'tmp.docx')
                no = self.letter(tmp, 'م/ عرض فني', paras)
                f = os.path.join(words, name(seq, 'عرض فني', no) + '.docx')
                os.replace(tmp, f)
                sections.append(('العرض الفني', f))
            elif part == 'عرض تجاري':
                seq += 1
                rows = self.price_rows('المبلغ الإجمالي للعطاء')
                paras = [('body', self.pick('comm_open', W.COMM_OPEN)),
                         ('body', self.pick('comm_total', W.COMM_TOTAL))]
                for extra in (pr.get('فقرات_تجارية') or []) + [s(job.get('comm_extra'))]:
                    if extra:
                        paras.append(('body', extra.format(**ctx)))
                paras.append(('body', self.pick('comm_validity', W.COMM_VALIDITY)))
                tmp = os.path.join(words, 'tmp.docx')
                no = self.letter(tmp, 'م/ عرض تجاري', paras, table=rows, table_after=0)
                f = os.path.join(words, name(seq, 'عرض تجاري', no) + '.docx')
                os.replace(tmp, f)
                sections.append(('العرض التجاري', f))
            elif part == 'تعهدات':
                if yes(job.get('no_undertakings')):
                    continue
                seq += 1
                items = [self.pick('und_docs', W.UND_DOCS), self.pick('und_black', W.UND_BLACKLIST),
                         self.pick('und_one', W.UND_ONE_WORK)]
                items += [x.format(**ctx) for x in pr.get('تعهدات_إضافية') or []]
                items += [x.strip() for x in s(job.get('und_extra')).splitlines() if x.strip()]
                paras = [('body', self.pick('und_open', W.UND_OPEN))]
                paras += [('item', '%d- %s' % (i, t)) for i, t in enumerate(items, 1)]
                paras.append(('body', self.pick('und_close', W.UND_CLOSE)))
                tmp = os.path.join(words, 'tmp.docx')
                no = self.letter(tmp, 'م/ تعهد', paras)
                f = os.path.join(words, name(seq, 'تعهد', no) + '.docx')
                os.replace(tmp, f)
                sections.append(('التعهدات', f))
                if yes(job.get('id_undertaking')):
                    seq += 1
                    tmp = os.path.join(words, 'tmp.docx')
                    no = self.letter(tmp, 'م/ تعهد', [('body', self.pick('id_und', W.ID_UND))])
                    f = os.path.join(words, name(seq, 'تعهد هوية الشركة', no) + '.docx')
                    os.replace(tmp, f)
                    sections.append(('تعهد تجديد هوية الشركة', f))
            elif part == 'القسم الرابع':
                seq += 1
                given = s(job.get('part4'))
                if given:
                    path = self.data.resolve(given)
                    if not path:
                        self.errors.append('ملف القسم الرابع مو موجود: ' + given)
                        continue
                    ext = os.path.splitext(path)[1]
                    f = os.path.join(words, name(seq, 'القسم الرابع') + ext)
                    shutil.copyfile(path, f)
                else:
                    rows = self.price_rows('المجموع')
                    f = os.path.join(words, name(seq, 'جدول الكميات المسعر') + '.docx')
                    self.plain(f, [('title', 'جدول الكميات المسعّر'),
                                   ('center', '%s %s' % (self.kind, ctx['number'])),
                                   ('center', ctx['title']), ('gap', ''), ('table', rows), ('gap', ''),
                                   ('line', 'المجموع كتابةً: فقط ' + ctx['total_words'])])
                    if pr.get('نموذج_قسم_رابع'):
                        self.warnings.append('هذي الجهة عندها نموذج قسم رابع خاص؛ انولّد جدول عام. '
                                             'إذا الدعوة بيها نموذج، عبّيه وحط مساره بـ«ملف القسم الرابع»')
                sections.append(('القسم الرابع / جدول الكميات', f))
            elif part == 'ملفات إضافية':
                for line in s(job.get('extra_files')).splitlines() + list(pr.get('ملفات_ثابتة') or []):
                    line = line.strip()
                    if not line:
                        continue
                    path = self.data.resolve(line)
                    if not path:
                        self.errors.append('ملف إضافي مو موجود: ' + line)
                        continue
                    seq += 1
                    title = os.path.splitext(os.path.basename(path))[0]
                    f = os.path.join(words, name(seq, title) + os.path.splitext(path)[1])
                    shutil.copyfile(path, f)
                    sections.append((title, f))

        docs = self.check_documents()
        self.audit_rows = self.audit(docs)

        # ------------------------------------------------------- PDF والدمج
        conv = Converter()
        self.engine = conv.engine
        try:
            pdfs = []
            for title, f in sections:
                pdf = os.path.join(out_dir, os.path.splitext(os.path.basename(f))[0] + '.pdf')
                conv.to_pdf(f, pdf)
                pdfs.append((title, pdf))
            doc_pdfs = []
            for d in docs:
                if d['status'] != 'ok':
                    continue
                pdf = os.path.join(out_dir, '_مستمسك_%s.pdf' % re.sub(r'[\\/:*?"<>|]', '-', d['name']))
                try:
                    conv.to_pdf(d['path'], pdf)
                    doc_pdfs.append((d['name'], pdf))
                except Exception as e:
                    self.warnings.append('ما تحول المستمسك %s: %s' % (d['name'], e))

            parts = pdfs + doc_pdfs
            # الفهرس: الغلاف صفحة 1، الفهرس يبدي من 2
            cover = os.path.join(words, '00 غلاف.docx')
            self.plain(cover, self.cover_blocks())
            cover_pdf = conv.to_pdf(cover, os.path.join(out_dir, '_غلاف.pdf'))
            index_pages = 1
            for _ in range(3):
                start = page_count(cover_pdf) + index_pages + 1
                rows = [['ت', 'المحتوى', 'الصفحة']]
                for i, (title, pdf) in enumerate(parts, 1):
                    rows.append([str(i), title, str(start)])
                    start += page_count(pdf)
                index = os.path.join(words, '00 فهرس.docx')
                self.plain(index, [('title', 'فهرس المحتويات'), ('gap', ''), ('table', rows)])
                index_pdf = conv.to_pdf(index, os.path.join(out_dir, '_فهرس.pdf'))
                if page_count(index_pdf) == index_pages:
                    break
                index_pages = page_count(index_pdf)

            full = os.path.join(out_dir, '%s - الحزمة الكاملة - %s.pdf' % (self.prefix, cname))
            pages = merge([cover_pdf, index_pdf] + [p for _, p in parts], full)

            labels = os.path.join(words, '%s - ملصقات الأظرف - %s.docx' % (self.prefix, cname))
            self.plain(labels, self.label_blocks())
            conv.to_pdf(labels, os.path.join(out_dir, os.path.splitext(os.path.basename(labels))[0] + '.pdf'))

            report = os.path.join(words, '%s - 00 تدقيق المتطلبات والمتبقي - %s.docx' % (self.prefix, cname))
            self.plain(report, self.report_blocks())
            conv.to_pdf(report, os.path.join(out_dir, os.path.splitext(os.path.basename(report))[0] + '.pdf'))
        finally:
            conv.close()
        for f in glob.glob(os.path.join(out_dir, '_*.pdf')):
            os.remove(f)
        for f in (cover, index):
            if os.path.exists(f):
                os.remove(f)

        zpath = os.path.join(out_dir, '%s - Word - %s.zip' % (self.prefix, cname))
        with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
            for f in sorted(os.listdir(words)):
                z.write(os.path.join(words, f), f)   # zipfile يحفظ الأسماء العربية UTF-8
        self.full_pdf, self.pages = full, pages
        return full

    def price_rows(self, total_label):
        """جدول الأسعار مثل كتب الشركة: المادة، الكمية، سعر الوحدة، المبلغ. الوحدة بالعنوان إذا وحدة."""
        units = {it['unit'] for it in self.items}
        one = units.pop() if len(units) == 1 else None
        head = ['المادة', 'الكمية' + (' (%s)' % one if one else ''), 'سعر الوحدة (دينار)', 'المبلغ (دينار)']
        rows = [head]
        for it in self.items:
            qty = money(it['qty']) + ('' if one or not it['unit'] else ' ' + it['unit'])
            rows.append([it['name'], qty, money(it['price']), money(it['amount'])])
        rows.append([total_label, '', '', money(self.total)])
        return rows

    def pick_item(self, it):
        opts = W.TECH_ITEM
        st = self.data.state.setdefault('صياغات', {}).setdefault(self.company_key, {})
        if 'item_style' not in self.__dict__:
            last = st.get('item')
            self.item_style = self.rng.choice([i for i in range(len(opts)) if i != last] or [0])
            st['item'] = self.item_style
        return opts[self.item_style].format(i=it['i'], name=it['name'], qty=money(it['qty']),
                                            unit=it['unit'] or '').replace('  ', ' ').replace(' .', '.')

    # ------------------------------------------------------------ المستمسكات
    def check_documents(self):
        wanted = self.profile.get('المستمسكات') or []
        have = self.data.documents(self.company_key)
        out = []
        for want in wanted:
            rec = next((d for d in have if d['name'] == want), None) or \
                next((d for d in have if want in d['name'] or d['name'] in want), None)
            if not rec:
                out.append({'name': want, 'status': 'missing'})
                self.remaining.append(want + ' (مو مسجل بمستمسكات.xlsx)')
                continue
            path = self.data.resolve(rec['file'])
            limit = self.closing or dt.date.today()
            if not path:
                out.append({'name': want, 'status': 'nofile'})
                self.remaining.append(want + ' (الملف مو موجود: %s)' % rec['file'])
            elif rec['expiry'] and rec['expiry'] < limit:
                out.append({'name': want, 'status': 'expired', 'expiry': rec['expiry']})
                self.remaining.append('%s منتهي (%s) — يحتاج تجديد' % (want, rec['expiry']))
                self.warnings.append('⚠️ %s منتهي بتاريخ %s' % (want, rec['expiry']))
            else:
                out.append({'name': want, 'status': 'ok', 'path': path, 'expiry': rec['expiry']})
                if rec['expiry'] and (rec['expiry'] - limit).days <= 30:
                    self.warnings.append('%s ينتهي قريب (%s)' % (want, rec['expiry']))
        return out

    def audit(self, docs):
        rows = [['ت', 'المتطلب', 'الحالة']]
        dstat = {d['name']: d for d in docs}
        for i, req in enumerate(self.profile.get('المتطلبات') or [], 1):
            name, src = req.get('المتطلب'), req.get('من', 'الشركة')
            if src.startswith('مستمسك:'):
                d = dstat.get(src.split(':', 1)[1])
                st = {'ok': 'متوفر (مرفق)', 'expired': 'منتهي — على الشركة',
                      'missing': 'غير مسجل — على الشركة', 'nofile': 'الملف ناقص — على الشركة'}.get(
                    d['status'] if d else 'missing')
            elif src == 'الحزمة':
                st = 'متوفر (ضمن الحزمة)'
            else:
                st = 'على الشركة'
                self.remaining.append(name)
            rows.append([str(i), name, st])
        return rows

    # ----------------------------------------------------------- أوراق داخلية
    def cover_blocks(self):
        c = self.ctx
        b = [('gap', ''), ('gap', ''), ('title', self.to_name), ('gap', ''),
             ('center', '%s %s' % (self.kind, c['number'])), ('center', c['title']), ('gap', ''),
             ('title', 'عطاء شركة/ ' + c['company_full'])]
        if self.closing:
            b += [('gap', ''), ('center', 'موعد الغلق: %s' % self.closing.strftime('%d/%m/%Y'))]
        return b

    def label_blocks(self):
        c = self.ctx
        out = []
        for i, which in enumerate(('العرض الفني', 'العرض التجاري')):
            if i:
                out.append(('break', ''))
            out += [('gap', ''), ('title', which), ('gap', ''), ('center', 'الى / ' + self.to_name),
                    ('center', '%s %s' % (self.kind, c['number'])), ('center', c['title']), ('gap', ''),
                    ('center', 'مقدم من شركة/ ' + c['company_full'])]
            if self.closing:
                out.append(('center', 'موعد الغلق: %s' % self.closing.strftime('%d/%m/%Y')))
        return out

    def report_blocks(self):
        c = self.ctx
        b = [('title', 'تدقيق المتطلبات'), ('center', '%s %s — %s' % (self.kind, c['number'], self.company_key)),
             ('gap', ''), ('table', self.audit_rows), ('gap', ''), ('title', 'المتبقي على الشركة')]
        rem = list(dict.fromkeys(self.remaining))
        b += [('line', '• ' + r) for r in rem] or [('line', 'لا شيء')]
        if self.warnings:
            b += [('gap', ''), ('title', 'تنبيهات')] + [('line', '• ' + w) for w in self.warnings]
        b += [('gap', ''), ('line', 'المجموع: %s دينار (%s)' % (c['total'], c['total_words'])),
              ('line', 'الأرقام الصادرة: %s' % ('، '.join(map(str, self.numbers)) or 'لا يوجد'))]
        if s(self.job.get('notes')):
            b.append(('line', 'ملاحظات: ' + s(self.job.get('notes'))))
        return b

    # -------------------------------------------------------- الحفظ والسجلات
    def commit(self, out_dir):
        """ينقل الناتج للأرشيف، ويحدّث الأرقام والسجلات (مو بوضع التجربة)."""
        arch = self.data.archive_root()
        dest = None
        if arch:
            sub = self.profile.get('مجلد_الأرشيف', '03_مناقصات_مقدمة')
            base = os.path.join(arch, sub, '%s - %s - %s' % (self.prefix, self.ctx['title'][:60], self.company_key))
            base = re.sub(r'[*?"<>|]', '-', base)
            dest, n = base, 2
            while os.path.exists(dest):
                dest = '%s (%d)' % (base, n)
                n += 1
            shutil.copytree(out_dir, dest)
        else:
            self.warnings.append('ما لكيت مجلد الأرشيف بالدرايف؛ الملفات بقت بـ ' + out_dir)
        if self.numbers:
            self.company['الرقم_التالي'] = max(self.numbers) + 1
        self.data.companies[self.company_key] = self.company
        save_json(self.data.p('الشركات.json'), self.data.companies)
        save_json(self.data.p('حالة.json'), self.data.state)
        today = dt.date.today().isoformat()
        append_xlsx(self.data.p('سجل الصادر.xlsx'), ['التاريخ', 'الرقم', 'الشركة', 'الموضوع', 'الجهة', 'رقم الدعوة'],
                    [[today, n, self.company_key, 'حزمة ' + self.ctx['number'], self.to_name,
                      self.ctx['number']] for n in self.numbers])
        append_xlsx(self.data.p('سجل المناقصات.xlsx'),
                    ['التاريخ', 'الشركة', 'الجهة', 'رقم الدعوة', 'العنوان', 'المبلغ', 'موعد الغلق', 'المجلد'],
                    [[today, self.company_key, self.to_name, self.ctx['number'], self.ctx['title'],
                      float(self.total), self.closing.isoformat() if self.closing else '', dest or out_dir]])
        return dest


def append_xlsx(path, head, rows):
    from openpyxl import Workbook, load_workbook
    if os.path.exists(path):
        wb = load_workbook(path)
        ws = wb.worksheets[0]
    else:
        wb = Workbook()
        ws = wb.active
        ws.sheet_view.rightToLeft = True
        ws.append(head)
    for r in rows:
        ws.append(r)
    wb.save(path)


# --------------------------------------------------------------------- الأوامر

def cmd_build(args, check_only=False):
    data = Data(args.data)
    job = read_job(args.job)
    b = Builder(data, job, dry=args.dry)
    out_root = os.path.join(os.environ.get('TEMP') or '/tmp', 'aqsa-factory')
    os.makedirs(out_root, exist_ok=True)
    out_dir = os.path.join(out_root, dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
    result = {'ok': False}
    try:
        if check_only:
            b.prepare()
            b.template()
            b.check_documents()
            result = {'ok': True, 'total': money(b.total), 'total_words': tafqit(b.total), 'items': len(b.items),
                      'warnings': b.warnings, 'remaining': b.remaining}
            return result
        b.build(out_dir)
        if b.errors:
            result = {'ok': False, 'errors': b.errors, 'warnings': b.warnings, 'out': out_dir}
            return result
        dest = out_dir if args.dry else b.commit(out_dir)
        final_pdf = os.path.join(dest, os.path.basename(b.full_pdf)) if dest else b.full_pdf
        result = {'ok': True, 'folder': dest, 'pdf': final_pdf, 'pages': b.pages, 'numbers': b.numbers,
                  'total': money(b.total), 'total_words': tafqit(b.total), 'warnings': b.warnings,
                  'remaining': list(dict.fromkeys(b.remaining)), 'engine': b.engine, 'dry': bool(args.dry),
                  'company': b.company_key, 'number': b.ctx['number'], 'title': b.ctx['title']}
        return result
    except (JobError, Exception) as e:
        if not isinstance(e, JobError):
            traceback.print_exc()
        result = {'ok': False, 'errors': [str(e)], 'warnings': b.warnings}
        return result


def cmd_docs(args):
    data = Data(args.data)
    today = dt.date.today()
    soon = []
    for d in data.documents(''):
        if d['expiry'] and (d['expiry'] - today).days <= int(args.days):
            soon.append({'company': d['company'], 'name': d['name'], 'expiry': d['expiry'].isoformat(),
                         'days': (d['expiry'] - today).days})
    return {'ok': True, 'expiring': sorted(soon, key=lambda x: x['days'])}


def cmd_init(args):
    """ينسخ ملفات البداية لمجلد البيانات بدون ما يكتب فوك أي ملف موجود."""
    import seed
    created = seed.create(args.dir)
    return {'ok': True, 'dir': os.path.abspath(args.dir), 'created': created}


def main(argv=None):
    ap = argparse.ArgumentParser(description='مصنع مناقصات أقصى الفرات')
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('build', 'check'):
        p = sub.add_parser(name)
        p.add_argument('job')
        p.add_argument('--data', default=os.environ.get('AQSA_FACTORY_DATA', ''))
        p.add_argument('--dry', action='store_true', help='تجربة: ما يرقّم ولا يرفع للأرشيف')
    p = sub.add_parser('docs')
    p.add_argument('--data', default=os.environ.get('AQSA_FACTORY_DATA', ''))
    p.add_argument('--days', default=30)
    p = sub.add_parser('init')
    p.add_argument('dir')
    args = ap.parse_args(argv)
    if args.cmd == 'build':
        res = cmd_build(args)
    elif args.cmd == 'check':
        res = cmd_build(args, check_only=True)
    elif args.cmd == 'docs':
        res = cmd_docs(args)
    else:
        res = cmd_init(args)
    print(json.dumps(res, ensure_ascii=False, default=str))
    return 0 if res.get('ok') else 1


if __name__ == '__main__':
    sys.exit(main())
