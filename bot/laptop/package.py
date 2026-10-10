#!/usr/bin/env python3
"""يحزم برنامج المكتب.

  python3 laptop/package.py            يسوي AqsaOffice-laptop.zip للتنصيب أول مرة (مجلد AqsaOffice كامل)
  python3 laptop/package.py --update   يسوي AqsaOffice-<النسخة>.zip للتحديث عن بعد (agent.ps1 وVERSION وfactory)

التحديث ينرسل بـ `bridge.py pc update`، وهو يوقّعه برمز UPDATE_KEY من البيئة.
النسخة من ملف VERSION: زيدها قبل كل تحديث.
"""
import hashlib
import hmac
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
INSTALL_FILES = ["README.md", "install.cmd", "install.ps1", "uninstall.cmd", "agent.ps1", "launcher.ps1", "VERSION"]
# launcher.ps1 ما يتحدث عن بعد: هو اللي يرجّع النسخة القديمة إذا الجديدة خربت
UPDATE_FILES = ["agent.ps1", "VERSION"]


def version():
    return (HERE / "VERSION").read_text(encoding="utf-8").strip()


def factory_files():
    return sorted((HERE / "factory").glob("*.py"))


def install_zip(out=None):
    out = Path(out or HERE / "AqsaOffice-laptop.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in INSTALL_FILES:
            z.write(HERE / name, "AqsaOffice/" + name)
        for f in factory_files():
            z.write(f, "AqsaOffice/factory/" + f.name)
    return out


def update_zip(out=None):
    out = Path(out or HERE / ("AqsaOffice-%s.zip" % version()))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in UPDATE_FILES:
            z.write(HERE / name, name)
        for f in factory_files():
            z.write(f, "factory/" + f.name)
    return out


def sign(key, ver, sha256):
    """نفس التوقيع اللي يتأكد منه agent.ps1 (Apply-Update)."""
    msg = ("aqsa-office|%s|%s" % (ver, sha256)).encode("utf-8")
    return hmac.new(key.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


if __name__ == "__main__":
    path = update_zip() if "--update" in sys.argv else install_zip()
    print(path, path.stat().st_size, "bytes, version", version())
