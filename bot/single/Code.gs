// بوت أقصى الفرات — كل الكود بملف واحد. انسخه كامل لملف Code.gs بـ Apps Script.
// مولّد من مجلد apps-script/ (لا تعدّل هنا، عدّل الملفات الأصلية وأعد التوليد).

// ===== Config.gs =====
/**
 * بوت أقصى الفرات — الإعدادات
 *
 * كل القيم السرية تنحفظ بـ Script Properties (مو بالكود):
 *   TELEGRAM_TOKEN   رمز البوت من @BotFather
 *   TG_SECRET        كلمة سر عشوائية تنحط برابط الـ webhook حتى ما أحد غير تلغرام يرسل للسكربت
 *   API_KEY          كلمة سر عشوائية يستعملها Claude حتى يقرا الطابور ويرفع النتائج
 *   ALLOWED_IDS      معرّفات التلغرام المسموح إلها، مفصولة بفارزة (مثال: 11111111,22222222)
 *   MANAGER_ID       معرّف تلغرام المدير (يستلم أزرار الموافقة والطباعة)
 *   WATCH_IDS        معرّفات تشوف كل شي يرسله الموظفين (كل طلب ويه ملفاته، وكل بحث)، مفصولة بفارزة
 *   PRINTER_EMAIL    إيميل طابعة Epson Connect (ينكتب بعد تسجيل الطابعة)
 *   ROOT_FOLDER_ID   يتعبى وحده من دالة setup()
 *   SHEET_ID         يتعبى وحده من دالة setup()
 */

// مجلد "أرشيف شركة أقصى الفرات" بالدرايف
const ARCHIVE_FOLDER_ID = '18ypIMmqpsXTlMFNFN0LtX64V0ipAUXSY';

const COMPANIES = [
  'أقصى الفرات', 'أنباء سبأ', 'قوس البرج', 'الحارث',
  'شمس الهمام', 'تاج السراي', 'آفاق المدينة', 'نور الدعاء',
  'كرم الخليل', 'عبير الفرات'
];

const APOLOGY_REASONS = [
  'ارتفاع أسعار المواد وسعر الصرف',
  'عدم توفر المادة بالسوق المحلي',
  'التزامات الشركة بأعمال أخرى',
  'سبب آخر (أكتبه)'
];

const STATUS = {
  NEW: 'جديد',
  WORKING: 'قيد العمل',
  READY: 'جاهز',
  WAITING_MANAGER: 'بانتظار موافقة المدير',
  APPROVED: 'موافق عليه',
  PRINTED: 'مطبوع',
  REJECTED: 'مرجّع للتعديل',
  CANCELLED: 'ملغي'
};

const REQUEST_HEADERS = [
  'رقم الطلب', 'التاريخ', 'النوع', 'chat_id', 'مقدم الطلب', 'الشركة',
  'رقم الدعوة', 'الجهة', 'موعد الغلق', 'السعر', 'السبب', 'ملاحظات',
  'مجلد الطلب', 'مجلد النتائج', 'الحالة', 'ملاحظة الحالة', 'آخر تحديث'
];

const RECEIPT_HEADERS = [
  'التاريخ', 'مقدم الوصل', 'المبلغ (دينار)', 'الوصف', 'رابط الصورة'
];

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function setProp_(name, value) {
  PropertiesService.getScriptProperties().setProperty(name, String(value));
}

function idList_(name) {
  return prop_(name).split(',').map(function (s) { return s.trim(); }).filter(String);
}

function allowedIds_() {
  return idList_('ALLOWED_IDS');
}

function watchIds_() {
  return idList_('WATCH_IDS');
}

/** المراقب أو المدير يشوف كل الطلبات. */
function canSeeAll_(id) {
  id = String(id);
  return watchIds_().indexOf(id) >= 0 || id === prop_('MANAGER_ID');
}

// ===== Telegram.gs =====
/**
 * دوال الاتصال بتلغرام.
 */

function tgUrl_(method) {
  return 'https://api.telegram.org/bot' + prop_('TELEGRAM_TOKEN') + '/' + method;
}

function tg_(method, payload) {
  const res = UrlFetchApp.fetch(tgUrl_(method), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const body = JSON.parse(res.getContentText() || '{}');
  if (!body.ok) console.warn('Telegram ' + method + ' failed: ' + res.getContentText());
  return body;
}

function send_(chatId, text, keyboard) {
  const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  return tg_('sendMessage', payload);
}

function edit_(chatId, messageId, text, keyboard) {
  const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  return tg_('editMessageText', payload);
}

function answerCallback_(callbackId, text) {
  return tg_('answerCallbackQuery', { callback_query_id: callbackId, text: text || '' });
}

/** يرسل ملف من الدرايف كمستند بالتلغرام (حد تلغرام 50 ميغا). */
function sendDriveFile_(chatId, fileId, caption, keyboard) {
  const blob = DriveApp.getFileById(fileId).getBlob();
  const payload = { chat_id: String(chatId), document: blob };
  if (caption) payload.caption = caption;
  if (keyboard) payload.reply_markup = JSON.stringify({ inline_keyboard: keyboard });
  const res = UrlFetchApp.fetch(tgUrl_('sendDocument'), {
    method: 'post', payload: payload, muteHttpExceptions: true
  });
  return JSON.parse(res.getContentText() || '{}');
}

/** ينزّل ملف أرسله المستخدم للبوت ويرجعه كـ Blob (حد تلغرام للتنزيل 20 ميغا). */
function downloadTelegramFile_(fileId, fileName) {
  const info = tg_('getFile', { file_id: fileId });
  if (!info.ok) throw new Error('تعذّر تنزيل الملف من تلغرام');
  const url = 'https://api.telegram.org/file/bot' + prop_('TELEGRAM_TOKEN') + '/' + info.result.file_path;
  const blob = UrlFetchApp.fetch(url).getBlob();
  const ext = info.result.file_path.split('.').pop();
  blob.setName(fileName || ('ملف_' + Date.now() + '.' + ext));
  return blob;
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** يقسّم قائمة أزرار إلى صفوف. */
function rows_(buttons, perRow) {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
}

function btn_(text, data) {
  return { text: text, callback_data: data };
}

// ===== Storage.gs =====
/**
 * الطابور (Google Sheet) ومجلدات الطلبات بالدرايف وحالة المحادثة.
 */

// ---------- حالة المحادثة لكل مستخدم ----------

function getState_(chatId) {
  const raw = PropertiesService.getScriptProperties().getProperty('state_' + chatId);
  return raw ? JSON.parse(raw) : null;
}

function setState_(chatId, state) {
  PropertiesService.getScriptProperties().setProperty('state_' + chatId, JSON.stringify(state));
}

function clearState_(chatId) {
  PropertiesService.getScriptProperties().deleteProperty('state_' + chatId);
}

// ---------- الجدول ----------

function sheet_(name) {
  return SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName(name);
}

function nextRequestId_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const n = Number(prop_('REQ_COUNTER') || '0') + 1;
    setProp_('REQ_COUNTER', n);
    const d = Utilities.formatDate(new Date(), 'Asia/Baghdad', 'yyMMdd');
    return 'R' + d + '-' + ('000' + n).slice(-3);
  } finally {
    lock.releaseLock();
  }
}

function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Baghdad', 'yyyy-MM-dd HH:mm');
}

/** يحوّل صف من الجدول إلى كائن بأسماء إنكليزية يقراها Claude بسهولة. */
function rowToRequest_(r) {
  return {
    id: r[0], created: r[1], type: r[2], chat_id: String(r[3]), requester: r[4],
    company: r[5], number: r[6], entity: r[7], closing: r[8], price: r[9],
    reason: r[10], notes: r[11], folder_id: r[12], results_folder_id: r[13],
    status: r[14], status_note: r[15], updated: r[16]
  };
}

function appendRequest_(req) {
  sheet_('الطلبات').appendRow([
    req.id, now_(), req.type, String(req.chat_id), req.requester, req.company || '',
    req.number || '', req.entity || '', req.closing || '', req.price || '',
    req.reason || '', req.notes || '', req.folder_id, req.results_folder_id,
    STATUS.NEW, '', now_()
  ]);
}

function findRequest_(id) {
  const sh = sheet_('الطلبات');
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) return { row: i + 1, req: rowToRequest_(values[i]) };
  }
  return null;
}

function listRequests_(status) {
  const values = sheet_('الطلبات').getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (!status || values[i][14] === status) out.push(rowToRequest_(values[i]));
  }
  return out;
}

function updateStatus_(id, status, note) {
  const found = findRequest_(id);
  if (!found) throw new Error('الطلب غير موجود: ' + id);
  const sh = sheet_('الطلبات');
  sh.getRange(found.row, 15, 1, 3).setValues([[status, note || '', now_()]]);
  found.req.status = status;
  found.req.status_note = note || '';
  return found.req;
}

function appendReceipt_(r) {
  sheet_('الوصولات').appendRow([now_(), r.requester, r.amount, r.description, r.url]);
}

// ---------- مجلدات الدرايف ----------

function rootFolder_() {
  return DriveApp.getFolderById(prop_('ROOT_FOLDER_ID'));
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** يسوي مجلد للطلب: <الرقم>_<النوع>_<الشركة>_<الدعوة> وجواه "مرفقات" و"النتائج". */
function createRequestFolders_(req) {
  const parts = [req.id, req.type, req.company, req.number].filter(String).join('_').replace(/[\/\\]/g, '-');
  const folder = childFolder_(rootFolder_(), 'الطلبات').createFolder(parts);
  const attachments = folder.createFolder('مرفقات');
  const results = folder.createFolder('النتائج');
  return { folder: folder, attachments: attachments, results: results };
}

function receiptsFolder_() {
  const month = Utilities.formatDate(new Date(), 'Asia/Baghdad', 'yyyy-MM');
  return childFolder_(childFolder_(rootFolder_(), 'الوصولات'), month);
}

// ===== Bot.gs =====
/**
 * نقطة الدخول: تلغرام يرسل كل رسالة هنا (webhook)، وClaude يكلّم نفس الرابط بمفتاح API.
 */

function doPost(e) {
  let data = {};
  try {
    data = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }

  // طلب من Claude
  if (data.api_key || (e.parameter && e.parameter.api_key)) {
    const key = data.api_key || e.parameter.api_key;
    if (!prop_('API_KEY') || key !== prop_('API_KEY')) return json_({ ok: false, error: 'unauthorized' });
    try {
      return json_(Object.assign({ ok: true }, handleApi_(data)));
    } catch (err) {
      return json_({ ok: false, error: String(err.message || err) });
    }
  }

  // تحديث من تلغرام
  if (!e.parameter || e.parameter.tg !== prop_('TG_SECRET')) return json_({ ok: false });
  if (data.update_id && isDuplicate_(data.update_id)) return json_({ ok: true });
  try {
    handleUpdate_(data);
  } catch (err) {
    console.error(err);
    const chatId = (data.message && data.message.chat.id) ||
      (data.callback_query && data.callback_query.message.chat.id);
    if (chatId) send_(chatId, '⚠️ صار خطأ: ' + escapeHtml_(err.message || err) + '\nجرّب مرة ثانية أو اكتب /start');
  }
  return json_({ ok: true });
}

function doGet() {
  return ContentService.createTextOutput('بوت أقصى الفرات يشتغل ✅');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** تلغرام ممكن يعيد نفس التحديث إذا ما وصله رد 200، فنتجاهل المكرر. */
function isDuplicate_(updateId) {
  const cache = CacheService.getScriptCache();
  const key = 'u' + updateId;
  if (cache.get(key)) return true;
  cache.put(key, '1', 21600);
  return false;
}

// ---------------------------------------------------------------------------
// توجيه الرسائل
// ---------------------------------------------------------------------------

function handleUpdate_(u) {
  const msg = u.message;
  const cb = u.callback_query;
  const from = msg ? msg.from : cb ? cb.from : null;
  if (!from) return;
  const chatId = msg ? msg.chat.id : cb.message.chat.id;
  const userId = String(from.id);

  if (msg && msg.text === '/myid') {
    send_(chatId, 'معرّفك بالتلغرام: <code>' + userId + '</code>');
    return;
  }
  if (allowedIds_().indexOf(userId) < 0 && !canSeeAll_(userId)) {
    send_(chatId, '⛔ هذا البوت خاص بشركة أقصى الفرات.\nمعرّفك: <code>' + userId + '</code>\nدزّه للمسؤول حتى يضيفك.');
    return;
  }

  const user = { id: userId, chatId: chatId, name: [from.first_name, from.last_name].filter(Boolean).join(' ') };

  if (cb) {
    answerCallback_(cb.id);
    handleCallback_(user, cb.data, cb.message);
    return;
  }
  if (msg.text === '/start' || msg.text === '/menu' || msg.text === 'القائمة') {
    clearState_(chatId);
    showMenu_(chatId, 'أهلاً ' + escapeHtml_(from.first_name || '') + ' 👋\nشنو تحتاج؟');
    return;
  }
  if (msg.text === '/cancel') {
    clearState_(chatId);
    showMenu_(chatId, 'انلغى. شنو تحتاج؟');
    return;
  }

  const state = getState_(chatId);
  if (!state) return handleLoose_(user, msg);
  if (state.flow === 'search' && (msg.text || '').trim()) watchLog_(user, '🔍 بحث: ' + escapeHtml_(msg.text.trim()));
  handleInput_(user, state, msg);
}

/** رسالة بدون ما يكون بخطوة: نص يتحول لطلب أو بحث، وملف يبدي طلب جديد. */
function handleLoose_(user, msg) {
  const text = (msg.text || '').trim();
  if (msg.document || msg.photo) {
    startFlow_(user, 'ask', {}, true);
    return handleInput_(user, getState_(user.chatId), msg);
  }
  if (!text || text.charAt(0) === '/') return showMenu_(user.chatId, 'اختار من القائمة 👇');
  setState_(user.chatId, { flow: 'loose', step: 0, data: { text: text }, files: [] });
  send_(user.chatId, '«' + escapeHtml_(text.slice(0, 200)) + '»\nشنو أسوي بيها؟', [
    [btn_('🙋 أرسلها طلب لـ Claude', 'loose:ask'), btn_('🔍 دوّر بالأرشيف', 'loose:search')]
  ]);
}

function showMenu_(chatId, text) {
  const kb = [
    [btn_('🙋 اطلب شي', 'menu:ask'), btn_('🔍 بحث بالأرشيف', 'menu:search')],
    [btn_('📊 مناقصات اليوم', 'menu:tenders'), btn_('📝 اعتذار', 'menu:apology')],
    [btn_('🧾 تسجيل وصل', 'menu:receipt'), btn_('📋 طلباتي', 'menu:mine')]
  ];
  if (canSeeAll_(chatId)) kb.push([btn_('📥 كل الطلبات', 'menu:all')]);
  send_(chatId, text, kb);
}

/** يرسل سطر للمراقبين (WATCH_IDS) بكل شي يسويه الموظفين، إلا إذا المراقب نفسه هو اللي سواه. */
function watchLog_(user, text) {
  watchIds_().forEach(function (id) {
    if (id !== user.id) send_(id, '👁️ ' + escapeHtml_(user.name) + ' — ' + text);
  });
}

/** آخر 10 طلبات من كل الموظفين، ويه زر يجيب ملفات كل طلب. */
function showAll_(user) {
  if (!canSeeAll_(user.id)) return showMenu_(user.chatId, '⛔ هذا للمدير والمراقب بس.');
  const all = listRequests_('').slice(-10).reverse();
  if (!all.length) return showMenu_(user.chatId, 'ماكو طلبات بعد.');
  all.forEach(function (r) {
    const what = r.type === FLOW_NAMES.ask ? String(r.notes || '') : [r.company, r.number, r.reason, r.notes].filter(Boolean).join(' · ');
    send_(user.chatId, '<b>' + r.id + '</b> · ' + escapeHtml_(r.requester) + ' · ' + escapeHtml_(r.created) +
      '\n' + escapeHtml_(r.type) + ': ' + escapeHtml_(what.slice(0, 300)) +
      '\nالحالة: ' + escapeHtml_(r.status) + (r.status_note ? ' — ' + escapeHtml_(r.status_note) : ''),
      [[btn_('📎 ملفاته', 'rq:files:' + r.id)]]);
  });
  showMenu_(user.chatId, '📥 آخر ' + all.length + ' طلبات.');
}

/** يرسل مرفقات الطلب ونتائجه للمراقب أو المدير. */
function sendRequestFiles_(user, id) {
  if (!canSeeAll_(user.id)) return;
  const req = mustFind_(id);
  const sent = [['مرفقات', DriveApp.getFolderById(req.folder_id).getFoldersByName('مرفقات').next()],
    ['النتائج', DriveApp.getFolderById(req.results_folder_id)]].map(function (pair) {
    const it = pair[1].getFiles();
    let n = 0;
    while (it.hasNext()) { sendDriveFile_(user.chatId, it.next().getId(), id + ' · ' + pair[0]); n++; }
    return n;
  });
  if (!sent[0] && !sent[1]) send_(user.chatId, 'الطلب ' + id + ' ما بيه ملفات.');
}

// ---------------------------------------------------------------------------
// الخطوات
// ---------------------------------------------------------------------------

const FLOWS = {
  ask: ['what', 'files'],
  search: ['query'],
  apology: ['company', 'number', 'entity', 'reason', 'notes', 'confirm'],
  receipt: ['photo', 'amount', 'description']
};

const FLOW_NAMES = { ask: 'طلب', apology: 'اعتذار', receipt: 'وصل' };

const ENTITIES = ['كهرباء الوسط', 'غاز الشمال', 'نفط الشمال', 'مصفى الشمال', 'أخرى (أكتبها)'];

/** quiet = لا تسأل أول سؤال (المتصل يكمل بنفسه). */
function startFlow_(user, flow, prefill, quiet) {
  const state = { flow: flow, step: 0, data: prefill || {}, files: [] };
  setState_(user.chatId, state);
  if (!quiet) ask_(user, state);
}

function stepName_(state) {
  const steps = FLOWS[state.flow];
  return steps ? steps[state.step] : '';
}

function next_(user, state) {
  state.step++;
  setState_(user.chatId, state);
  ask_(user, state);
}

function ask_(user, state) {
  const c = user.chatId;
  const step = stepName_(state);
  switch (step) {
    case 'what':
      if (state.data.base) {
        send_(c, '📑 ' + escapeHtml_(state.data.base) +
          '\n\nاكتب الشركة والسعر وأي تفصيل ثاني (مثال: أقصى الفرات، +25%):');
      } else {
        send_(c, '🙋 شنو تريد؟ اكتبه بكلامك.\nأمثلة:\n• سويلي حزمة مناقصة كهرباء الوسط 17/2026 لأقصى الفرات بسعر +25%\n' +
          '• اريد كتاب تمديد كفالة 18478\n• دزلي هوية غرفة التجارة وشهادة التأسيس');
      }
      break;
    case 'query':
      send_(c, '🔍 اكتب اسم الملف أو كلمة منه (مثال: هوية الغرفة، تأسيس، كفالة 18478).');
      break;
    case 'company':
      send_(c, '🏢 لأي شركة؟', rows_(COMPANIES.map(function (n, i) { return btn_(n, 'co:' + i); }), 2));
      break;
    case 'number':
      send_(c, '🔢 اكتب رقم الدعوة أو المناقصة (مثال: LMD-17/2026 أو 12/2026)');
      break;
    case 'entity':
      send_(c, '🏛️ الجهة المعلنة؟', rows_(ENTITIES.map(function (n, i) { return btn_(n, 'ent:' + i); }), 2));
      break;
    case 'files':
      send_(c, '📎 إذا عندك ملفات (وثيقة الدعوة، صور، وورد) ارفعها وحدة وحدة. ومن تخلص، أو ما عندك ملفات، دوس أرسل.',
        [[btn_('📨 أرسل الطلب', 'files:done')], [btn_('❌ إلغاء', 'confirm:cancel')]]);
      break;
    case 'reason':
      send_(c, '❓ سبب الاعتذار؟', APOLOGY_REASONS.map(function (r, i) { return [btn_(r, 'reason:' + i)]; }));
      break;
    case 'notes':
      send_(c, '📝 أي ملاحظة لـ Claude؟ (مثلاً: الكمية، شرط خاص، رقم كتاب)', [[btn_('بدون ملاحظات', 'notes:none')]]);
      break;
    case 'confirm':
      send_(c, summary_(state), [
        [btn_('✅ أرسل الطلب', 'confirm:send')],
        [btn_('🔄 من جديد', 'confirm:restart'), btn_('❌ إلغاء', 'confirm:cancel')]
      ]);
      break;
    case 'photo':
      send_(c, '📸 صوّر الوصل وأرسله.');
      break;
    case 'amount':
      send_(c, '💵 شكد المبلغ بالدينار؟ (أرقام بس)');
      break;
    case 'description':
      send_(c, '🗒️ شنو هذا الوصل؟ (مثال: شراء وثيقة مناقصة المرمر)');
      break;
  }
}

function summary_(state) {
  const d = state.data;
  const lines = ['<b>ملخص ' + (state.flow === 'ask' ? 'الطلب' : 'طلب ' + FLOW_NAMES[state.flow]) + '</b>'];
  if (d.text) lines.push('🙋 ' + escapeHtml_(d.text));
  if (d.company) lines.push('🏢 الشركة: ' + escapeHtml_(d.company));
  if (d.number) lines.push('🔢 الرقم: ' + escapeHtml_(d.number));
  if (d.entity) lines.push('🏛️ الجهة: ' + escapeHtml_(d.entity));
  if (d.reason) lines.push('❓ السبب: ' + escapeHtml_(d.reason));
  if (d.ref) lines.push('🔗 من النشرة: ' + escapeHtml_(d.ref));
  if (state.files.length) lines.push('📎 المرفقات: ' + state.files.length + ' ملف');
  if (state.flow !== 'ask') lines.push('📝 ملاحظات: ' + escapeHtml_(d.notes || 'لا يوجد'));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// الأزرار
// ---------------------------------------------------------------------------

function handleCallback_(user, data, message) {
  const parts = data.split(':');
  const kind = parts[0];
  const value = parts.slice(1).join(':');

  if (kind === 'menu') {
    if (value === 'mine') return showMine_(user);
    if (value === 'tenders') return showTenders_(user);
    if (value === 'all') return showAll_(user);
    return startFlow_(user, value);
  }
  if (kind === 'mgr') return handleManager_(user, parts[1], parts.slice(2).join(':'), message);
  if (kind === 'td') return handleTenderButton_(user, parts[1], parts.slice(2).join(':'), message);
  if (kind === 'sf') return sendFoundFile_(user, value);
  if (kind === 'rq' && parts[1] === 'files') return sendRequestFiles_(user, parts.slice(2).join(':'));

  const state = getState_(user.chatId);
  if (!state) return showMenu_(user.chatId, 'الجلسة انتهت، ابدي من جديد 👇');
  const step = stepName_(state);

  if (kind === 'loose' && (state.flow === 'loose' || state.flow === 'search') && state.data.text) {
    const text = state.data.text;
    if (value === 'search') {
      watchLog_(user, '🔍 بحث: ' + escapeHtml_(text));
      startFlow_(user, 'search', {}, true);
      return runSearch_(user, text);
    }
    startFlow_(user, 'ask', { text: text }, true);
    return next_(user, getState_(user.chatId));
  }
  if (kind === 'co' && step === 'company') {
    state.data.company = COMPANIES[Number(value)];
    return next_(user, state);
  }
  if (kind === 'ent' && step === 'entity') {
    const ent = ENTITIES[Number(value)];
    if (ent.indexOf('أخرى') === 0) {
      state.awaitText = true;
      setState_(user.chatId, state);
      return send_(user.chatId, 'اكتب اسم الجهة:');
    }
    state.data.entity = ent;
    return next_(user, state);
  }
  if (kind === 'reason' && step === 'reason') {
    const r = APOLOGY_REASONS[Number(value)];
    if (r.indexOf('سبب آخر') === 0) {
      state.awaitText = true;
      setState_(user.chatId, state);
      return send_(user.chatId, 'اكتب السبب:');
    }
    state.data.reason = r;
    return next_(user, state);
  }
  if (kind === 'files' && value === 'done' && step === 'files') {
    if (!state.data.text && state.data.base) state.data.text = state.data.base;
    if (!state.data.text) return send_(user.chatId, '✍️ اكتب شنو تريد بالملفات، وبعدين دوس أرسل.');
    return submit_(user, state);
  }
  if (kind === 'notes' && value === 'none' && step === 'notes') {
    state.data.notes = '';
    return next_(user, state);
  }
  if (kind === 'confirm' && (step === 'confirm' || value === 'cancel')) {
    if (value === 'cancel') {
      discardStaged_(state);
      clearState_(user.chatId);
      return showMenu_(user.chatId, '❌ انلغى الطلب.');
    }
    if (value === 'restart') {
      discardStaged_(state);
      return startFlow_(user, state.flow);
    }
    if (value === 'send') return submit_(user, state);
  }
}

// ---------------------------------------------------------------------------
// الكتابة والملفات
// ---------------------------------------------------------------------------

function handleInput_(user, state, msg) {
  const step = stepName_(state);
  const text = (msg.text || '').trim();
  if (state.flow === 'reject') return finishReject_(user, state, text);

  const fileRef = msg.document ? { id: msg.document.file_id, name: msg.document.file_name } :
    msg.photo ? { id: msg.photo[msg.photo.length - 1].file_id, name: 'صورة_' + Date.now() + '.jpg' } : null;

  if (state.flow === 'search' && text) return runSearch_(user, text);
  if (state.flow === 'loose') {
    clearState_(user.chatId);
    return handleLoose_(user, msg);
  }
  // بخطوة "شنو تريد" إذا أرسل ملف بدل الكتابة، نروح للملفات ونخلي الكتابة بعدين
  if (step === 'what' && fileRef) state.step = FLOWS.ask.indexOf('files');
  if (stepName_(state) === 'files' && !fileRef && text) {
    state.data.text = [state.data.text || state.data.base, text].filter(Boolean).join('\n');
    setState_(user.chatId, state);
    return send_(user.chatId, '✅ انضافت للطلب. ارفع ملفات أو دوس أرسل.',
      [[btn_('📨 أرسل الطلب', 'files:done')], [btn_('❌ إلغاء', 'confirm:cancel')]]);
  }

  if (stepName_(state) === 'files' || step === 'photo') {
    if (!fileRef) return send_(user.chatId, '📎 أرسل ملف أو صورة، أو دوس الزر إذا خلصت.');
    const blob = downloadTelegramFile_(fileRef.id, fileRef.name);
    const file = childFolder_(rootFolder_(), 'مؤقت').createFile(blob);
    state.files.push(file.getId());
    if (step === 'photo') return next_(user, state);
    if (msg.caption) state.data.text = [state.data.text || state.data.base, msg.caption.trim()].filter(Boolean).join('\n');
    setState_(user.chatId, state);
    const tail = state.data.text ? 'ارفع غيره، أو دوس أرسل.' : 'ارفع غيره، واكتب شنو تريد بيه، وبعدين دوس أرسل.';
    return send_(user.chatId, '✅ استلمت: ' + escapeHtml_(file.getName()) + '\n' + tail,
      [[btn_('📨 أرسل الطلب', 'files:done')], [btn_('❌ إلغاء', 'confirm:cancel')]]);
  }

  if (!text) return send_(user.chatId, 'اكتب جواب، أو /cancel للإلغاء.');

  if (state.awaitText) {
    delete state.awaitText;
    if (step === 'entity') state.data.entity = text;
    if (step === 'reason') state.data.reason = text;
    return next_(user, state);
  }

  switch (step) {
    case 'what':
      state.data.text = [state.data.base, text].filter(Boolean).join('\n');
      return next_(user, state);
    case 'company':
      state.data.company = text;
      return next_(user, state);
    case 'number':
      state.data.number = text;
      return next_(user, state);
    case 'entity':
      state.data.entity = text;
      return next_(user, state);
    case 'notes':
      state.data.notes = text;
      return next_(user, state);
    case 'amount': {
      const n = Number(text.replace(/[^\d٠-٩]/g, '').replace(/[٠-٩]/g, function (ch) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(ch); }));
      if (!n) return send_(user.chatId, 'اكتب المبلغ أرقام بس، مثال: 250000');
      state.data.amount = n;
      return next_(user, state);
    }
    case 'description':
      state.data.description = text;
      return saveReceipt_(user, state);
    default:
      return send_(user.chatId, 'دوس على أحد الأزرار فوك 👆');
  }
}

function discardStaged_(state) {
  state.files.forEach(function (id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* تجاهل */ }
  });
}

// ---------------------------------------------------------------------------
// إرسال الطلب للطابور
// ---------------------------------------------------------------------------

function submit_(user, state) {
  const d = state.data;
  const req = {
    id: nextRequestId_(), type: FLOW_NAMES[state.flow], chat_id: user.chatId, requester: user.name,
    company: d.company, number: d.number, entity: d.entity, closing: d.closing,
    reason: d.reason, notes: [d.text, d.notes, d.ref].filter(Boolean).join(' | ')
  };
  const f = createRequestFolders_(req);
  state.files.forEach(function (id) { DriveApp.getFileById(id).moveTo(f.attachments); });
  req.folder_id = f.folder.getId();
  req.results_folder_id = f.results.getId();
  appendRequest_(req);
  clearState_(user.chatId);

  send_(user.chatId, '✅ انرسل الطلب <b>' + req.id + '</b>\nClaude يشتغل عليه، والملفات توصلك هنا من تجهز (عادة خلال ساعة).');
  const note = '📥 طلب جديد ' + req.id + ' من ' + escapeHtml_(user.name) + '\n' + summary_(state);
  const mgr = prop_('MANAGER_ID');
  if (mgr && mgr !== user.id) send_(mgr, note);
  // المراقبين يشوفون الطلب ويه ملفاته
  watchIds_().forEach(function (id) {
    if (id === user.id) return;
    if (id !== mgr) send_(id, note);
    state.files.forEach(function (fid) { sendDriveFile_(id, fid, req.id); });
  });
}

function saveReceipt_(user, state) {
  const file = DriveApp.getFileById(state.files[0]);
  const d = state.data;
  const ext = (file.getName().match(/\.[A-Za-z0-9]+$/) || ['.jpg'])[0];
  file.moveTo(receiptsFolder_());
  file.setName(Utilities.formatDate(new Date(), 'Asia/Baghdad', 'yyyy-MM-dd') + '_' + d.amount + '_' +
    d.description.slice(0, 40).replace(/[\/\\]/g, '-') + ext);
  appendReceipt_({ requester: user.name, amount: d.amount, description: d.description, url: file.getUrl() });
  watchIds_().forEach(function (id) {
    if (id !== user.id) sendDriveFile_(id, file.getId(), '🧾 ' + user.name + ' — ' + d.amount + ' دينار — ' + d.description);
  });
  clearState_(user.chatId);
  showMenu_(user.chatId, '🧾 انسجل الوصل: ' + d.amount.toLocaleString('en-US') + ' دينار\n' + escapeHtml_(d.description));
}

function showMine_(user) {
  const mine = listRequests_().filter(function (r) { return r.chat_id === String(user.chatId); }).slice(-5).reverse();
  if (!mine.length) return showMenu_(user.chatId, 'ما عندك طلبات بعد.');
  const lines = mine.map(function (r) {
    const what = r.type === FLOW_NAMES.ask ? String(r.notes || '').slice(0, 60) : (r.company || '') + ' ' + (r.number || '');
    return '• <b>' + r.id + '</b> ' + escapeHtml_(r.type + ' ' + what) +
      '\n   الحالة: ' + escapeHtml_(r.status) + (r.status_note ? ' — ' + escapeHtml_(r.status_note) : '');
  });
  showMenu_(user.chatId, '📋 آخر طلباتك:\n' + lines.join('\n'));
}

// ---------------------------------------------------------------------------
// موافقة المدير والطباعة
// ---------------------------------------------------------------------------

function handleManager_(user, action, id, message) {
  if (user.id !== prop_('MANAGER_ID')) return send_(user.chatId, '⛔ الموافقة للمدير بس.');
  const found = findRequest_(id);
  if (!found) return send_(user.chatId, 'الطلب ' + escapeHtml_(id) + ' مو موجود.');
  const req = found.req;

  if (action === 'ok') {
    edit_(user.chatId, message.message_id, '✅ وافقت على ' + id + '، جاري الإرسال للطابعة…');
    const printed = printRequest_(req);
    if (printed.ok) {
      updateStatus_(id, STATUS.PRINTED, printed.count + ' ملف انرسل للطابعة');
      send_(user.chatId, '🖨️ انرسل ' + printed.count + ' ملف للطابعة.');
      send_(req.chat_id, '🖨️ المدير وافق على ' + id + ' وانرسل للطباعة.');
    } else {
      updateStatus_(id, STATUS.APPROVED, printed.error);
      send_(user.chatId, '✅ انسجلت الموافقة، بس ما انطبع: ' + escapeHtml_(printed.error));
      send_(req.chat_id, '✅ المدير وافق على ' + id + '. ' + escapeHtml_(printed.error));
    }
    return;
  }
  if (action === 'no') {
    setState_(user.chatId, { flow: 'reject', step: 0, data: { id: id }, files: [] });
    return send_(user.chatId, '✏️ شنو الملاحظة على ' + id + '؟ اكتبها وتوصل لـ Claude ومقدم الطلب.');
  }
}

function finishReject_(user, state, text) {
  const id = state.data.id;
  const req = updateStatus_(id, STATUS.REJECTED, text || 'بدون ملاحظة');
  clearState_(user.chatId);
  send_(user.chatId, '↩️ رجّعت ' + id + ' للتعديل.');
  send_(req.chat_id, '↩️ المدير رجّع ' + id + ' للتعديل:\n' + escapeHtml_(text));
}

/** يرسل ملفات PDF من مجلد النتائج لإيميل طابعة Epson Connect. */
function printRequest_(req) {
  const printer = prop_('PRINTER_EMAIL');
  if (!printer) return { ok: false, error: 'إيميل الطابعة مو مضبوط بعد' };
  const files = DriveApp.getFolderById(req.results_folder_id).getFilesByType(MimeType.PDF);
  const blobs = [];
  let size = 0;
  while (files.hasNext()) {
    const f = files.next();
    size += f.getSize();
    blobs.push(f.getBlob());
  }
  if (!blobs.length) return { ok: false, error: 'ماكو ملفات PDF بمجلد النتائج' };
  if (size > 20 * 1024 * 1024) return { ok: false, error: 'حجم الملفات أكبر من 20 ميغا (حد Epson)' };
  MailApp.sendEmail(printer, 'Print ' + req.id, 'Aqsa Al-Furat bot print job ' + req.id, { attachments: blobs.slice(0, 10) });
  return { ok: true, count: Math.min(blobs.length, 10) };
}

// ===== Search.gs =====
/**
 * البحث بأرشيف الشركة: الموظف يكتب كلمة، والبوت يدوّر بأسماء الملفات (ونصّها إذا مقروء)
 * جوّه مجلد الأرشيف ومجلداته الفرعية، ويرسل الملف اللي يختاره.
 */

const SEARCH_LIMIT = 8;

/** معرّفات كل المجلدات تحت الأرشيف (تنحفظ 6 ساعات حتى البحث يكون سريع). */
function archiveFolderIds_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('archive_folders');
  if (hit) return JSON.parse(hit);
  const ids = [ARCHIVE_FOLDER_ID];
  for (let i = 0; i < ids.length && ids.length < 3000; i++) {
    const it = DriveApp.getFolderById(ids[i]).getFolders();
    while (it.hasNext()) ids.push(it.next().getId());
  }
  try { cache.put('archive_folders', JSON.stringify(ids), 21600); } catch (e) { /* أكبر من حد الكاش */ }
  return ids;
}

function inArchive_(file, folderSet) {
  const it = file.getParents();
  while (it.hasNext()) if (folderSet[it.next().getId()]) return true;
  return false;
}

function searchArchive_(text) {
  const words = text.split(/\s+/).filter(function (w) { return w.length > 1; }).slice(0, 5);
  if (!words.length) return [];
  const q = words.map(function (w) {
    const v = w.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return "(title contains '" + v + "' or fullText contains '" + v + "')";
  }).join(' and ') + ' and trashed = false';

  const folderSet = {};
  archiveFolderIds_().forEach(function (id) { folderSet[id] = true; });
  const out = [];
  const it = DriveApp.searchFiles(q);
  let seen = 0;
  while (it.hasNext() && out.length < SEARCH_LIMIT && seen < 200) {
    const f = it.next();
    seen++;
    if (!inArchive_(f, folderSet)) continue;
    const parent = f.getParents();
    out.push({ id: f.getId(), name: f.getName(), folder: parent.hasNext() ? parent.next().getName() : '', size: f.getSize() });
  }
  // الأسماء اللي بيها كل الكلمات تطلع أول
  return out.sort(function (a, b) { return titleScore_(b.name, words) - titleScore_(a.name, words); });
}

function titleScore_(name, words) {
  return words.filter(function (w) { return name.indexOf(w) >= 0; }).length;
}

function runSearch_(user, text) {
  const found = searchArchive_(text);
  const again = [[btn_('🔍 بحث ثاني', 'menu:search'), btn_('🙋 اطلبه من Claude', 'loose:ask')]];
  // نبقى بوضع البحث (كل كلمة جديدة بحث جديد)، ونحفظ النص حتى زر "اطلبه من Claude" يرسله طلب
  setState_(user.chatId, { flow: 'search', step: 0, data: { text: 'دوّرلي على: ' + text }, files: [] });
  if (!found.length) {
    return send_(user.chatId, '🔍 ما لكيت شي بـ «' + escapeHtml_(text) + '».\nجرّب كلمة ثانية، أو اطلبه من Claude.', again);
  }
  const lines = found.map(function (f, i) {
    return (i + 1) + '. ' + escapeHtml_(f.name) + (f.folder ? '\n    📁 ' + escapeHtml_(f.folder) : '');
  });
  const buttons = rows_(found.map(function (f, i) { return btn_('📄 ' + (i + 1), 'sf:' + f.id); }), 4);
  send_(user.chatId, '🔍 لكيت ' + found.length + (found.length === SEARCH_LIMIT ? '+' : '') + ' ملف:\n' + lines.join('\n') +
    '\n\nدوس رقم الملف حتى أدزه.', buttons.concat(again));
}

/** يرسل ملف من نتائج البحث (بس إذا هو داخل الأرشيف). */
function sendFoundFile_(user, fileId) {
  let file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { return send_(user.chatId, 'الملف مو موجود.'); }
  const folderSet = {};
  archiveFolderIds_().forEach(function (id) { folderSet[id] = true; });
  if (!inArchive_(file, folderSet)) return send_(user.chatId, '⛔ هذا الملف مو بالأرشيف.');
  if (file.getSize() > 45 * 1024 * 1024) {
    return send_(user.chatId, '📄 ' + escapeHtml_(file.getName()) + ' أكبر من حد تلغرام، افتحه من هنا:\n' + file.getUrl());
  }
  const res = sendDriveFile_(user.chatId, fileId, file.getName());
  if (!res.ok) send_(user.chatId, '📄 ما كدرت أدزه كملف، افتحه من هنا:\n' + file.getUrl());
}

// ===== Tenders.gs =====
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
    return startFlow_(user, 'ask', {
      base: 'جهّز حزمة مناقصة: ' + [t.title, t.entity, t.number ? 'رقم ' + t.number : '', t.closing ? 'الغلق ' + t.closing : '']
        .filter(Boolean).join(' — '),
      ref: t.link || ''
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

// ===== Api.gs =====
/**
 * الأوامر اللي يستعملها Claude (عن طريق bridge.py) — كلها تحتاج API_KEY.
 *
 *   list     {status?}                       → الطلبات (افتراضياً الجديدة)
 *   files    {id}                            → ملفات مجلد "مرفقات" للطلب
 *   update   {id, status, note?, notify?}    → يغيّر الحالة، ويبلّغ مقدم الطلب إذا notify
 *   upload   {id, name, mime, b64}           → يحفظ ملف نتيجة بمجلد "النتائج"
 *   deliver  {id, message, to_manager?}      → يرسل ملفات النتائج لمقدم الطلب، وللمدير بأزرار الطباعة
 *   notify   {target, text}                  → رسالة: "manager" أو "all" أو chat_id
 *   tenders_sync {tenders, brief?, push?}    → يحدّث قائمة المناقصات اليومية، وpush = "manager" أو "all" يرسل النشرة
 *   tenders_list {}                          → قائمة المناقصات بالجدول
 */
function handleApi_(d) {
  switch (d.action) {
    case 'list':
      return { requests: listRequests_(d.status === undefined ? STATUS.NEW : d.status) };

    case 'files': {
      const req = mustFind_(d.id);
      const folder = DriveApp.getFolderById(req.folder_id).getFoldersByName('مرفقات').next();
      const out = [];
      const it = folder.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        out.push({ id: f.getId(), name: f.getName(), mime: f.getMimeType(), size: f.getSize(), url: f.getUrl() });
      }
      return { request: req, files: out };
    }

    case 'update': {
      const req = updateStatus_(d.id, d.status, d.note);
      if (d.notify) send_(req.chat_id, 'ℹ️ ' + d.id + ': ' + escapeHtml_(d.status) + (d.note ? '\n' + escapeHtml_(d.note) : ''));
      return { request: req };
    }

    case 'upload': {
      const req = mustFind_(d.id);
      const blob = Utilities.newBlob(Utilities.base64Decode(d.b64), d.mime || 'application/octet-stream', d.name);
      const file = DriveApp.getFolderById(req.results_folder_id).createFile(blob);
      return { file_id: file.getId(), url: file.getUrl() };
    }

    case 'deliver': {
      const req = mustFind_(d.id);
      const it = DriveApp.getFolderById(req.results_folder_id).getFiles();
      const ids = [];
      while (it.hasNext()) ids.push(it.next().getId());
      if (!ids.length) throw new Error('ماكو ملفات بمجلد النتائج');

      send_(req.chat_id, '📦 <b>' + req.id + '</b> جاهز\n' + escapeHtml_(d.message || ''));
      ids.forEach(function (id) { sendDriveFile_(req.chat_id, id); });

      const mgr = prop_('MANAGER_ID');
      if (d.to_manager && mgr) {
        if (mgr !== req.chat_id) ids.forEach(function (id) { sendDriveFile_(mgr, id); });
        send_(mgr, '👆 <b>' + req.id + '</b> ' + escapeHtml_(req.type + ' ' + (req.company || '') + ' ' + (req.number || '')) +
          '\n' + escapeHtml_(d.message || '') + '\nإذا عاجبك دوس اطبعه.',
          [[btn_('✅ اطبعه', 'mgr:ok:' + req.id), btn_('↩️ رجّعه للتعديل', 'mgr:no:' + req.id)]]);
        updateStatus_(req.id, STATUS.WAITING_MANAGER, '');
      } else {
        updateStatus_(req.id, STATUS.READY, '');
      }
      return { sent: ids.length };
    }

    case 'notify': {
      let targets;
      if (d.target === 'manager') targets = [prop_('MANAGER_ID')];
      else if (d.target === 'all') targets = allowedIds_().concat([prop_('MANAGER_ID')]);
      else targets = [String(d.target)];
      targets = targets.filter(function (t, i, a) { return t && a.indexOf(t) === i; });
      targets.forEach(function (t) { send_(t, d.text); });
      return { sent: targets.length };
    }

    case 'tenders_sync': {
      const res = syncTenders_(d.tenders || []);
      if (d.brief) setProp_('LAST_BRIEF', JSON.stringify(d.brief));
      if (d.push) res.pushed = pushBrief_(d.push);
      return res;
    }

    case 'tenders_list':
      return { tenders: listTenders_() };

    default:
      throw new Error('أمر غير معروف: ' + d.action);
  }
}

function mustFind_(id) {
  const found = findRequest_(id);
  if (!found) throw new Error('الطلب غير موجود: ' + id);
  return found.req;
}

// ===== Setup.gs =====
/**
 * دوال التشغيل لأول مرة. شغّلها من محرر Apps Script بالترتيب:
 *   1) setup()        — يسوي مجلد الطلبات والجدول وكلمات السر
 *   2) (انشر السكربت كـ Web app)
 *   3) setWebhook()   — يربط تلغرام برابط السكربت
 *   4) showConfig()   — يطبع الرابط ومفتاح API حتى تحطهم لـ Claude
 */

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TELEGRAM_TOKEN')) throw new Error('حط TELEGRAM_TOKEN بـ Script Properties أول');

  if (!props.getProperty('TG_SECRET')) props.setProperty('TG_SECRET', Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));

  let root;
  if (props.getProperty('ROOT_FOLDER_ID')) {
    root = DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID'));
  } else {
    root = DriveApp.getFolderById(ARCHIVE_FOLDER_ID).createFolder('09_طلبات_البوت');
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }
  ['الطلبات', 'الوصولات', 'مؤقت'].forEach(function (n) { childFolder_(root, n); });

  if (!props.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create('طابور بوت أقصى الفرات');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    const req = ss.getSheets()[0].setName('الطلبات');
    req.appendRow(REQUEST_HEADERS);
    req.setFrozenRows(1);
    req.setRightToLeft(true);
    const rec = ss.insertSheet('الوصولات');
    rec.appendRow(RECEIPT_HEADERS);
    rec.setFrozenRows(1);
    rec.setRightToLeft(true);
    props.setProperty('SHEET_ID', ss.getId());
  }
  tendersSheet_();
  console.log('تم. المجلد: ' + root.getUrl());
}

function webAppUrl_() {
  return prop_('WEBAPP_URL') || ScriptApp.getService().getUrl();
}

function setWebhook() {
  const url = webAppUrl_();
  if (!url) throw new Error('انشر السكربت كـ Web app أول، أو حط رابطه بـ WEBAPP_URL');
  const res = tg_('setWebhook', {
    url: url + '?tg=' + prop_('TG_SECRET'),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
  console.log(JSON.stringify(res));
  tg_('setMyCommands', {
    commands: [
      { command: 'start', description: 'القائمة الرئيسية' },
      { command: 'cancel', description: 'إلغاء الطلب الحالي' },
      { command: 'myid', description: 'معرّفي بالتلغرام' }
    ]
  });
}

function deleteWebhook() {
  console.log(JSON.stringify(tg_('deleteWebhook', {})));
}

function webhookInfo() {
  console.log(JSON.stringify(tg_('getWebhookInfo', {})));
}

/** يطبع المعلومات اللي يحتاجها Claude. لا تنشرها بأي مكان عام. */
function showConfig() {
  console.log('BOT_URL=' + webAppUrl_());
  console.log('BOT_KEY=' + prop_('API_KEY'));
  console.log('مجلد الطلبات: https://drive.google.com/drive/folders/' + prop_('ROOT_FOLDER_ID'));
  console.log('الجدول: https://docs.google.com/spreadsheets/d/' + prop_('SHEET_ID'));
}

/** ينظف ملفات "مؤقت" الأقدم من يومين (طلبات انقطعت بالنص). شغّلها بمشغّل يومي. */
function cleanTemp() {
  const limit = Date.now() - 2 * 24 * 3600 * 1000;
  const it = childFolder_(rootFolder_(), 'مؤقت').getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getDateCreated().getTime() < limit) f.setTrashed(true);
  }
}

// ===== Poll.gs =====
/**
 * وضع السحب: البوت يسحب الرسائل من تلغرام كل دقيقة بدل الـ webhook.
 * السبب: رابط Apps Script يرد على تلغرام بتحويل 302، وتلغرام يعتبره فشل ويوقف التسليم.
 *
 *   startPolling()  — يلغي الـ webhook ويشغّل السحب كل دقيقة (شغّلها مرة وحدة)
 *   stopPolling()   — يوقف السحب
 */

function startPolling() {
  tg_('deleteWebhook', { drop_pending_updates: false });
  stopPolling();
  ScriptApp.newTrigger('pollUpdates').timeBased().everyMinutes(1).create();
  pollUpdates();
  console.log('السحب اشتغل: البوت يفحص الرسائل كل دقيقة.');
}

function stopPolling() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollUpdates') ScriptApp.deleteTrigger(t);
  });
}

function pollUpdates() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // سحب ثاني شغّال هسة
  try {
    // سحب سريع مرة وحدة بالدقيقة (بدون انتظار)، حتى ما نتجاوز حد Google اليومي لوقت المشغّلات
    const offset = Number(prop_('TG_OFFSET') || '0');
    const res = tg_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    if (!res.ok) return;
    res.result.forEach(function (u) {
      setProp_('TG_OFFSET', u.update_id + 1);
      if (isDuplicate_(u.update_id)) return;
      try {
        handleUpdate_(u);
      } catch (err) {
        console.error(err);
        const chatId = (u.message && u.message.chat.id) || (u.callback_query && u.callback_query.message.chat.id);
        if (chatId) send_(chatId, '⚠️ صار خطأ: ' + escapeHtml_(err.message || err) + '\nجرّب مرة ثانية أو اكتب /start');
      }
    });
  } finally {
    lock.releaseLock();
  }
}

// ===== Worker.gs =====
/**
 * ربط تلغرام بوسيط Cloudflare (رد فوري بدل السحب كل دقيقة).
 *
 *   useWorker()  — يوقف السحب (إذا كان شغّال) ويوجّه تلغرام للوسيط.
 *                  قبلها حط رابط الوسيط بـ Script Properties باسم WORKER_URL.
 */
function useWorker() {
  const url = prop_('WORKER_URL');
  if (!url) throw new Error('حط رابط الـ Worker بـ Script Properties باسم WORKER_URL');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollUpdates') ScriptApp.deleteTrigger(t);
  });
  const res = tg_('setWebhook', {
    url: url,
    secret_token: prop_('TG_SECRET'),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false
  });
  console.log(JSON.stringify(res));
  console.log('شغّل webhookInfo بعد دقيقة وتأكد إن last_error_message ما موجود.');
}
