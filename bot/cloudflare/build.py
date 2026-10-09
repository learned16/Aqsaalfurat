"""يولّد bot/single/worker.js: الوسيط ويه صفحة المكتب بداخله، حتى ينلصق بـ Cloudflare كملف واحد."""
import json
from pathlib import Path

here = Path(__file__).resolve().parent
src = (here / 'worker.js').read_text(encoding='utf-8')
html = (here / 'office.html').read_text(encoding='utf-8')
marker = "'/*OFFICE_HTML*/'"
assert src.count(marker) == 1, 'marker missing'
# json.dumps يعطي نص JavaScript صالح؛ نكسر </script حتى ما يتأثر شي لو انعرض
literal = json.dumps(html, ensure_ascii=False).replace('</script', '<\\/script')
out = here.parent / 'single' / 'worker.js'
out.write_text(src.replace(marker, literal), encoding='utf-8')
print('wrote', out, out.stat().st_size, 'bytes')
