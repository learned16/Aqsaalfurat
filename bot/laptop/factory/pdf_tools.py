"""تحويل Word إلى PDF، ودمج الملفات، وترقيم الصفحات.

التحويل بالـ Word الحقيقي على ويندوز (الخطوط والترويسة تطلع مثل ما هي)،
وإذا ماكو Word نستعمل LibreOffice.
"""
import io
import os
import shutil
import subprocess
import tempfile

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.webp')
WORD_EXT = ('.docx', '.doc', '.rtf')


class ConvertError(Exception):
    pass


class Converter:
    def __init__(self):
        self.word = None
        self.soffice = None
        try:
            import win32com.client  # noqa: F401  (ويندوز + pywin32)
            import pythoncom
            pythoncom.CoInitialize()
            self.word = win32com.client.DispatchEx('Word.Application')
            self.word.Visible = False
            self.word.DisplayAlerts = 0
        except Exception:
            self.word = None
        if not self.word:
            for cand in ('soffice', 'libreoffice',
                         r'C:\Program Files\LibreOffice\program\soffice.exe',
                         r'C:\Program Files (x86)\LibreOffice\program\soffice.exe'):
                if shutil.which(cand) or os.path.exists(cand):
                    self.soffice = shutil.which(cand) or cand
                    break
        if not self.word and not self.soffice:
            raise ConvertError('ماكو Microsoft Word ولا LibreOffice على الجهاز، ما أكدر أحوّل PDF')

    @property
    def engine(self):
        return 'Word' if self.word else 'LibreOffice'

    def to_pdf(self, src, dst):
        src, dst = os.path.abspath(src), os.path.abspath(dst)
        ext = os.path.splitext(src)[1].lower()
        if ext == '.pdf':
            shutil.copyfile(src, dst)
            return dst
        if ext in IMAGE_EXT:
            return image_to_pdf(src, dst)
        if self.word:
            doc = self.word.Documents.Open(src, ReadOnly=True, AddToRecentFiles=False)
            try:
                doc.ExportAsFixedFormat(dst, 17)  # 17 = PDF
            finally:
                doc.Close(False)
            return dst
        out = tempfile.mkdtemp(prefix='aqsa-pdf-')
        # نسخة بإسم لاتيني حتى ما يتلخبط LibreOffice بالأسماء العربية
        tmp_src = os.path.join(out, 'in' + ext)
        shutil.copyfile(src, tmp_src)
        subprocess.run([self.soffice, '--headless', '--convert-to', 'pdf', '--outdir', out, tmp_src],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
        shutil.move(os.path.join(out, 'in.pdf'), dst)
        shutil.rmtree(out, ignore_errors=True)
        return dst

    def close(self):
        if self.word:
            try:
                self.word.Quit()
            except Exception:
                pass
            self.word = None


def image_to_pdf(src, dst):
    from PIL import Image
    img = Image.open(src)
    if img.mode != 'RGB':
        img = img.convert('RGB')
    img.save(dst, 'PDF', resolution=150.0)
    return dst


def page_count(path):
    return len(PdfReader(path).pages)


def merge(parts, dst, number_from=2):
    """يدمج ملفات PDF ويرقّم الصفحات من الصفحة number_from (الغلاف بلا رقم)."""
    w = PdfWriter()
    for p in parts:
        for page in PdfReader(p).pages:
            w.add_page(page)
    total = len(w.pages)
    for i, page in enumerate(w.pages, start=1):
        if i < number_from:
            continue
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(width, height))
        c.setFont('Helvetica', 9)
        c.drawCentredString(width / 2, 14, '- %d / %d -' % (i, total))
        c.save()
        buf.seek(0)
        page.merge_page(PdfReader(buf).pages[0])
    with open(dst, 'wb') as fh:
        w.write(fh)
    return total
