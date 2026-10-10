"""التفقيط: كتابة المبلغ بالعربي (دينار عراقي) بصيغة الكتب الرسمية.

    tafqit(2670157500) → 'ملياران وستمائة وسبعون مليوناً ومائة وسبعة وخمسون ألفاً وخمسمائة دينار عراقي لا غير'
"""
from decimal import Decimal, ROUND_HALF_UP

ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
        'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر',
        'ثمانية عشر', 'تسعة عشر']
TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

# (المفرد، المثنى، الجمع 3-10، التمييز المنصوب 11-99)
SCALES = [
    (10 ** 9, ('مليار', 'ملياران', 'مليارات', 'ملياراً')),
    (10 ** 6, ('مليون', 'مليونان', 'ملايين', 'مليوناً')),
    (10 ** 3, ('ألف', 'ألفان', 'آلاف', 'ألفاً')),
]


def _below_100(n):
    if n < 20:
        return ONES[n]
    t, o = divmod(n, 10)
    return (ONES[o] + ' و' + TENS[t]) if o else TENS[t]


def _below_1000(n):
    h, r = divmod(n, 100)
    parts = []
    if h:
        parts.append(HUNDREDS[h])
    if r:
        parts.append(_below_100(r))
    return ' و'.join(parts)


def _group(n, forms):
    """عدد من 1 إلى 999 ويه اسم المرتبة (ألف، مليون، مليار) بالصيغة الصحيحة."""
    one, two, plural, acc = forms
    h, r = divmod(n, 100)
    head = HUNDREDS[h]
    if r == 0:
        return head + ' ' + one                     # مائة ألف
    if r == 1:
        return (head + ' و' if h else '') + one     # ألف / مائة وألف
    if r == 2:
        return (head + ' و' if h else '') + two     # ألفان / مائة وألفان
    tail = _below_100(r) + ' ' + (plural if r <= 10 else acc)
    return (head + ' و' if h else '') + tail


def number_words(n):
    """العدد الصحيح بالكلمات بدون عملة."""
    n = int(n)
    if n == 0:
        return 'صفر'
    if n < 0:
        return 'سالب ' + number_words(-n)
    parts = []
    for size, forms in SCALES:
        q, n = divmod(n, size)
        if q >= 1000:
            parts.append(number_words(q) + ' ' + forms[3])
        elif q:
            parts.append(_group(q, forms))
    if n:
        parts.append(_below_1000(n))
    return ' و'.join(parts)


def tafqit(amount, currency='دينار عراقي'):
    """المبلغ كتابةً. الكسر (إذا موجود) ينكتب فلوس من الألف."""
    d = Decimal(str(amount)).quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)
    whole = int(d)
    fils = int((d - whole) * 1000)
    text = number_words(whole) + ' ' + currency
    if fils:
        text += ' و' + number_words(fils) + ' فلساً'
    return text + ' لا غير'


def money(amount):
    """رقم بفواصل: 2670157500 → 2,670,157,500 و5782.05 → 5,782.05"""
    d = Decimal(str(amount))
    if d == d.to_integral_value():
        return '{:,}'.format(int(d))
    return '{:,.3f}'.format(d).rstrip('0').rstrip('.')


if __name__ == '__main__':
    import sys
    print(tafqit(sys.argv[1] if len(sys.argv) > 1 else 2670157500))
