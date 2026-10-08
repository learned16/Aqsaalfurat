/**
 * المناقصات اليومية: Claude يرصد كل صبح ويرسل القائمة هنا (tenders_sync)،
 * والبوت يعرضها بزر "📊 مناقصات اليوم" ويرسل النشرة للمدير.
 */

const TENDER_HEADERS = [
  'المفتاح', 'تاريخ الإضافة', 'الجهة', 'العنوان', 'الرقم', 'المحافظة', 'النوع',
  'الكلفة (دينار)', 'الغلق', 'الرابط', 'الأهلية', 'ملاحظات', 'الحالة', 'آخر تحديث'
];

// حالات تعني إن المناقصة ما تنعرض بعد بقائمة اليوم
const TENDER_CLOSED = ['ما تهمنا', 'اعتذرنا', 'منتهية', 'محالة لنا'];

function tendersSheet_() {
  const ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  let sh = ss.getSheetByName('المناقصات');
  if (!sh) {
    sh = ss.insertSheet('المناقصات');
    sh.appendRow(TENDER_HEADERS);
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  return sh;
}

function rowToTender_(r) {
  return {
    key: r[0], added: r[1], entity: r[2], title: r[3], number: r[4], gov: r[5], category: r[6],
    cost: r[7], closing: r[8], link: r[9], fit: r[10], notes: r[11], status: r[12], updated: r[13]
  };
}

function listTenders_() {
  const values = tendersSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] && values[i][0] !== TENDER_HEADERS[0]) out.push(rowToTender_(values[i]));
  }
  return out;
}

/** يضيف أو يحدّث المناقصات حسب المفتاح. حالة يغيّرها الموظفين بالبوت ما تنكتب فوقها. */
function syncTenders_(tenders) {
  const sh = tendersSheet_();
  const values = sh.getDataRange().getValues();
  const index = {};
  for (let i = 1; i < values.length; i++) index[values[i][0]] = i + 1;
  let added = 0, updated = 0;
  tenders.forEach(function (t) {
    if (!t.key) return;
    const row = [
      t.key, t.added || today_(), t.entity || '', t.title || '', t.number || '', t.gov || '',
      t.category || '', t.cost || '', t.closing || '', t.link || '', t.fit || '', t.notes || '',
      t.status || 'جديدة', now_()
    ];
    const at = index[t.key];
    if (at) {
      const old = values[at - 1];
      row[1] = old[1];                                   // تاريخ الإضافة الأصلي
      if (old[12] && old[12] !== 'جديدة') row[12] = old[12]; // حالة اختارها موظف
      sh.getRange(at, 1, 1, row.length).setValues([row]);
      updated++;
    } else {
      sh.appendRow(row);
      added++;
    }
  });
  return { added: added, updated: updated };
}

function today_() {
  return Utilities.formatDate(new Date(), 'Asia/Baghdad', 'yyyy-MM-dd');
}

/** عدد الأيام لحد الغلق. null إذا التاريخ مو بصيغة yyyy-MM-dd. */
function daysLeft_(closing) {
  const m = String(closing || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date(today_().replace(/-/g, '/'));
  return Math.round((t - now) / 86400000);
}

function openTenders_() {
  return listTenders_().filter(function (t) {
    if (TENDER_CLOSED.indexOf(t.status) >= 0) return false;
    const d = daysLeft_(t.closing);
    return d === null || d >= 0;
  }).sort(function (a, b) {
    const ka = a.gov === 'كركوك' ? 0 : 1, kb = b.gov === 'كركوك' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    const da = daysLeft_(a.closing), db = daysLeft_(b.closing);
    return (da === null ? 9999 : da) - (db === null ? 9999 : db);
  });
}

function fmtCost_(n) {
  n = Number(n);
  if (!n) return 'غير معروفة';
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' مليار';
  if (n >= 1e6) return Math.round(n / 1e6) + ' مليون';
  return n.toLocaleString('en-US');
}

function tenderCard_(t) {
  const d = daysLeft_(t.closing);
  const when = d === null ? 'الغلق غير معروف' : d === 0 ? '🔴 يغلق اليوم' : d <= 3 ? '🔴 باقي ' + d + ' يوم' :
    d <= 7 ? '🟠 باقي ' + d + ' يوم' : 'باقي ' + d + ' يوم';
  const lines = [
    (t.gov === 'كركوك' ? '📍 ' : '') + '<b>' + escapeHtml_(t.title) + '</b>',
    escapeHtml_([t.entity, t.number ? 'رقم ' + t.number : ''].filter(Boolean).join(' · ')),
    escapeHtml_([t.gov, t.category].filter(Boolean).join(' · ')) + ' · الكلفة: ' + fmtCost_(t.cost),
    '📅 ' + escapeHtml_(t.closing || '—') + ' — ' + when
  ];
  if (t.fit) lines.push('✔️ الأهلية: ' + escapeHtml_(t.fit));
  if (t.notes) lines.push('📝 ' + escapeHtml_(t.notes));
  if (t.link) lines.push('<a href="' + escapeHtml_(t.link) + '">فتح الإعلان</a>');
  return lines.join('\n');
}

function tenderButtons_(t) {
  return [[btn_('📑 جهّز إلها حزمة', 'td:prep:' + t.key), btn_('🚫 ما تهمنا', 'td:skip:' + t.key)]];
}

function briefText_() {
  const raw = prop_('LAST_BRIEF');
  if (!raw) return '';
  const b = JSON.parse(raw);
  return '📰 <b>نشرة ' + escapeHtml_(b.date || '') + '</b>\n' + escapeHtml_(b.body || b.headline || '');
}

/** زر "📊 مناقصات اليوم": النشرة + كل مناقصة مفتوحة برسالة ويه أزرارها (أول 10، كركوك أولاً). */
function showTenders_(user) {
  const brief = briefText_();
  const open = openTenders_();
  if (brief) send_(user.chatId, brief);
  if (!open.length) return showMenu_(user.chatId, 'ماكو مناقصات مفتوحة بالقائمة حالياً.');
  open.slice(0, 10).forEach(function (t) { send_(user.chatId, tenderCard_(t), tenderButtons_(t)); });
  showMenu_(user.chatId, '📊 ' + open.length + ' مناقصة مفتوحة' + (open.length > 10 ? ' (عرضت أول 10)' : '') + '.');
}

function findTender_(key) {
  const sh = tendersSheet_();
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) return { row: i + 1, tender: rowToTender_(values[i]) };
  }
  return null;
}

function setTenderStatus_(key, status) {
  const found = findTender_(key);
  if (!found) return null;
  tendersSheet_().getRange(found.row, 13, 1, 2).setValues([[status, now_()]]);
  return found.tender;
}

function handleTenderButton_(user, action, key, message) {
  const found = findTender_(key);
  if (!found) return send_(user.chatId, 'المناقصة مو موجودة بالقائمة.');
  const t = found.tender;
  if (action === 'skip') {
    setTenderStatus_(key, 'ما تهمنا');
    return edit_(user.chatId, message.message_id, '🚫 ' + escapeHtml_(t.title) + '\n(انشالت من القائمة: ما تهمنا)');
  }
  if (action === 'prep') {
    setTenderStatus_(key, 'قيد الدراسة');
    send_(user.chatId, '📑 نبدي حزمة لـ: <b>' + escapeHtml_(t.title) + '</b>\nالرقم والجهة والغلق انعبّوا من النشرة.');
    return startFlow_(user, 'tender', {
      number: t.number || t.title, entity: t.entity, closing: t.closing,
      ref: [t.title, t.link].filter(Boolean).join(' — ')
    });
  }
}

/** ترسل النشرة للمدير (وللكل إذا target = all) ويه زر يفتح القائمة. */
function pushBrief_(target) {
  const open = openTenders_();
  const urgent = open.filter(function (t) { const d = daysLeft_(t.closing); return d !== null && d <= 3; }).length;
  const kirkuk = open.filter(function (t) { return t.gov === 'كركوك'; }).length;
  const text = briefText_() + '\n\n📊 مفتوحة: ' + open.length + ' · كركوك: ' + kirkuk + ' · تغلق خلال 3 أيام: ' + urgent;
  let targets = target === 'all' ? allowedIds_().concat([prop_('MANAGER_ID')]) : [prop_('MANAGER_ID')];
  targets = targets.filter(function (t, i, a) { return t && a.indexOf(t) === i; });
  targets.forEach(function (id) { send_(id, text, [[btn_('📊 عرض المناقصات', 'menu:tenders')]]); });
  return targets.length;
}
