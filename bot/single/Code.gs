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
 *   OWNER_ID         معرّف صاحب البوت: أعلى صلاحية (كل شي يشوفه المدير والمراقب، ويوافق ويطبع،
 *                    ويضيف ويشيل الموظفين ويغيّر المدير من البوت). ما يتغير إلا من Script Properties.
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

/** المراقبين، وصاحب البوت دائماً وياهم. */
function watchIds_() {
  const ids = idList_('WATCH_IDS');
  const owner = prop_('OWNER_ID');
  if (owner && ids.indexOf(owner) < 0) ids.unshift(owner);
  return ids;
}

function isOwner_(id) {
  return !!prop_('OWNER_ID') && String(id) === prop_('OWNER_ID');
}

/** المدير أو صاحب البوت (الموافقة والطباعة). */
function isManager_(id) {
  id = String(id);
  return id === prop_('MANAGER_ID') || isOwner_(id);
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
  if (msg && isOwner_(userId) && handleOwnerCommand_(user, (msg.text || '').trim())) return;

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
    [btn_('📂 تصفح الأرشيف', 'menu:browse'), btn_('📊 مناقصات اليوم', 'menu:tenders')],
    [btn_('📝 اعتذار', 'menu:apology'), btn_('🧾 تسجيل وصل', 'menu:receipt')],
    [btn_('📋 طلباتي', 'menu:mine')]
  ];
  if (isManager_(chatId)) kb.unshift([btn_('🖥️ المكتب (طباعة واللابتوب)', 'menu:office')]);
  if (isOwner_(chatId)) kb.push([btn_('📥 كل الطلبات', 'menu:all'), btn_('👑 الإدارة', 'menu:admin')]);
  else if (canSeeAll_(chatId)) kb.push([btn_('📥 كل الطلبات', 'menu:all')]);
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
      send_(c, '🔍 اكتب اسم الملف أو كلمة منه (مثال: دعوة 16، هوية الغرفة، كفالة 18478).\nإذا تريد ترسل طلب لـ Claude مو بحث، دوس /start وبعدين «اطلب شي».');
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
    if (value === 'admin') return showAdmin_(user);
    if (value === 'office') return showOffice_(user);
    if (value === 'browse') {
      clearState_(user.chatId);
      return browseFolder_(user, ARCHIVE_FOLDER_ID);
    }
    return startFlow_(user, value);
  }
  if (kind === 'mgr') return handleManager_(user, parts[1], parts.slice(2).join(':'), message);
  if (kind === 'td') return handleTenderButton_(user, parts[1], parts.slice(2).join(':'), message);
  if (kind === 'sf') return sendFoundFile_(user, value);
  if (kind === 'off') return handleOfficeButton_(user, value);
  if (kind === 'pf') return printArchiveFile_(user, value);
  if (kind === 'fd') return browseFolder_(user, value);
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
  if (state.flow === 'print' || state.flow === 'screen' || state.flow === 'tender') return handleOfficeInput_(user, state, msg);

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
  if (!isManager_(user.id)) return send_(user.chatId, '⛔ الموافقة للمدير بس.');
  const found = findRequest_(id);
  if (!found) return send_(user.chatId, 'الطلب ' + escapeHtml_(id) + ' مو موجود.');
  const req = found.req;

  if (action === 'ok') {
    edit_(user.chatId, message.message_id, '✅ وافقت على ' + id + '، جاري الإرسال للطابعة…');
    // الطباعة باللابتوب أول، وإيميل الطابعة إذا الوسيط مو مضبوط
    const printed = workerBase_() ? printRequestOnLaptop_(user, req) : printRequest_(req);
    if (printed.ok) {
      updateStatus_(id, STATUS.PRINTED, printed.count + ' ملف انرسل للطابعة');
      send_(user.chatId, '🖨️ انرسل ' + printed.count + ' ملف للطابعة بالمكتب.');
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
 * وبأسماء المجلدات جوّه مجلد الأرشيف، ويرسل الملف اللي يختاره.
 * وزر «تصفح الأرشيف» يفتح المجلدات بالأزرار بدون كتابة.
 */

const SEARCH_LIMIT = 8;
const BROWSE_FILE_LIMIT = 30;
// كلمات عامة ما تفرق بالبحث بالمجلدات، وتتبدل وحدة بالثانية بالبحث بالملفات
const GENERIC_WORDS = ['دعوة', 'دعوه', 'مناقصة', 'مناقصه', 'ملف', 'ملفات'];
// مجلدات ما تطلع بالتصفح (فحص، مو للشركة، قديم، طابور البوت)
const BROWSE_HIDDEN = /^(97|98|99|09)_/;

/** كل المجلدات تحت الأرشيف مع أسمائها وآبائها (تنحفظ 6 ساعات حتى البحث يكون سريع). */
function archiveFolders_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('archive_folders2');
  if (hit) return JSON.parse(hit);
  const list = [{ id: ARCHIVE_FOLDER_ID, name: '', parent: '' }];
  for (let i = 0; i < list.length && list.length < 3000; i++) {
    const it = DriveApp.getFolderById(list[i].id).getFolders();
    while (it.hasNext()) {
      const f = it.next();
      list.push({ id: f.getId(), name: f.getName(), parent: list[i].id });
    }
  }
  try { cache.put('archive_folders2', JSON.stringify(list), 21600); } catch (e) { /* أكبر من حد الكاش */ }
  return list;
}

function archiveFolderIds_() {
  return archiveFolders_().map(function (f) { return f.id; });
}

function inArchive_(file, folderSet) {
  const it = file.getParents();
  while (it.hasNext()) if (folderSet[it.next().getId()]) return true;
  return false;
}

/** يوحّد الكتابة: أرقام هندية، همزات، تاء مربوطة، و_ تصير مسافة. */
function normalize_(s) {
  return String(s || '')
    .replace(/[٠-٩]/g, function (ch) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(ch); })
    .replace(/_/g, ' ')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .toLowerCase();
}

function searchWords_(text) {
  return String(text || '')
    .replace(/[٠-٩]/g, function (ch) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(ch); })
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(function (w) { return w.length > 1 || /^\d$/.test(w); })
    .slice(0, 5);
}

/**
 * صيغ البحث: الكلمات نفسها، وبعدها «مناقصة» بدل «دعوة» وبالعكس،
 * وبعدها «LMD-16» بدل «دعوة 16» (أسماء دعوات كهرباء الوسط).
 */
function searchVariants_(words) {
  const variants = [words];
  const isGeneric = function (w) { return GENERIC_WORDS.indexOf(w) >= 0; };
  if (words.some(isGeneric)) {
    variants.push(words.map(function (w) {
      if (w === 'مناقصة' || w === 'مناقصه') return 'دعوة';
      if (w === 'دعوة' || w === 'دعوه') return 'مناقصة';
      return w;
    }));
    const num = words.filter(function (w) { return /^\d{1,3}$/.test(w); })[0];
    if (num) {
      const lmd = 'LMD-' + (num.length === 1 ? '0' + num : num);
      variants.push([lmd].concat(words.filter(function (w) { return w !== num && !isGeneric(w); })));
    }
  }
  return variants;
}

function driveQuery_(words) {
  return words.map(function (w) {
    const v = w.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return "(title contains '" + v + "' or fullText contains '" + v + "')";
  }).join(' and ') + ' and trashed = false';
}

/** المجلدات اللي اسمها فيه كل الكلمات (بعد التوحيد). الأرقام لازم تكون رقم كامل مو جزء من رقم. */
function searchFolders_(words, folders) {
  const keys = words.filter(function (w) { return GENERIC_WORDS.indexOf(w) < 0; }).map(normalize_);
  if (!keys.length) return [];
  return folders.filter(function (f) {
    if (!f.name || BROWSE_HIDDEN.test(f.name)) return false;
    const name = normalize_(f.name);
    return keys.every(function (k) {
      if (/^\d+$/.test(k)) return new RegExp('(^|\\D)0*' + k + '(\\D|$)').test(name);
      return name.indexOf(k) >= 0;
    });
  }).slice(0, 4);
}

function searchArchive_(text) {
  const words = searchWords_(text);
  if (!words.length) return { files: [], folders: [] };

  const folders = archiveFolders_();
  const folderSet = {};
  const folderName = {};
  folders.forEach(function (f) { folderSet[f.id] = true; folderName[f.id] = f.name; });

  // كل صيغة تجيب لحد SEARCH_LIMIT، وبعدين الأسماء اللي بيها كل كلمات صيغة وحدة تطلع أول
  const variants = searchVariants_(words);
  const out = [];
  const seen = {};
  variants.forEach(function (variant) {
    const it = DriveApp.searchFiles(driveQuery_(variant));
    let n = 0, got = 0;
    while (it.hasNext() && got < SEARCH_LIMIT && n < 200) {
      const f = it.next();
      n++;
      if (seen[f.getId()] || !inArchive_(f, folderSet)) continue;
      seen[f.getId()] = true;
      got++;
      const parent = f.getParents();
      out.push({ id: f.getId(), name: f.getName(), folder: parent.hasNext() ? parent.next().getName() : '' });
    }
  });
  out.forEach(function (f) { f.score = titleScore_(f.name, variants); });
  out.sort(function (a, b) { return b.score - a.score; });
  return { files: out.slice(0, SEARCH_LIMIT), folders: searchFolders_(words, folders) };
}

/** 100 إذا الاسم بيه كل كلمات وحدة من الصيغ، وإلا عدد الكلمات اللي بيه. */
function titleScore_(name, variants) {
  const n = normalize_(name);
  return Math.max.apply(null, variants.map(function (v) {
    const hits = v.filter(function (w) { return n.indexOf(normalize_(w)) >= 0; }).length;
    return hits === v.length ? 100 : hits;
  }));
}

function runSearch_(user, text) {
  const found = searchArchive_(text);
  const again = [[btn_('🔍 بحث ثاني', 'menu:search'), btn_('📂 تصفح الأرشيف', 'menu:browse')],
    [btn_('🙋 اطلبه من Claude', 'loose:ask')]];
  // نحفظ النص حتى زر "اطلبه من Claude" يرسله طلب. بعد البحث ما نبقى بوضع البحث،
  // فأي رسالة جاية تنسأل: طلب لو بحث؟
  setState_(user.chatId, { flow: 'loose', step: 0, data: { text: text }, files: [] });
  if (!found.files.length && !found.folders.length) {
    return send_(user.chatId, '🔍 ما لكيت شي بـ «' + escapeHtml_(text) + '».\nجرّب كلمة ثانية، أو تصفح الأرشيف، أو اطلبه من Claude.', again);
  }
  const lines = [];
  if (found.folders.length) {
    lines.push('📂 مجلدات:');
    found.folders.forEach(function (f) { lines.push('• ' + escapeHtml_(f.name.replace(/_/g, ' '))); });
  }
  if (found.files.length) {
    lines.push((found.folders.length ? '\n' : '') + '📄 لكيت ' + found.files.length + (found.files.length === SEARCH_LIMIT ? '+' : '') + ' ملف:');
    found.files.forEach(function (f, i) {
      lines.push((i + 1) + '. ' + escapeHtml_(f.name) + (f.folder ? '\n    📁 ' + escapeHtml_(f.folder.replace(/_/g, ' ')) : ''));
    });
  }
  const folderButtons = found.folders.map(function (f) { return [btn_('📂 ' + shortName_(f.name), 'fd:' + f.id)]; });
  const fileButtons = rows_(found.files.map(function (f, i) { return btn_('📄 ' + (i + 1), 'sf:' + f.id); }), 4);
  send_(user.chatId, lines.join('\n') + '\n\nدوس رقم الملف حتى أدزه، أو المجلد حتى تشوف اللي بيه.',
    folderButtons.concat(fileButtons, again));
}

function shortName_(name) {
  const s = String(name).replace(/_/g, ' ');
  return s.length > 40 ? s.slice(0, 38) + '…' : s;
}

/** يعرض مجلد من الأرشيف: مجلداته الفرعية أزرار، وملفاته أزرار ترسل الملف. */
function browseFolder_(user, folderId) {
  const folders = archiveFolders_();
  const me = folders.filter(function (f) { return f.id === folderId; })[0];
  if (!me) return send_(user.chatId, '⛔ هذا المجلد مو بالأرشيف.');

  const subs = folders.filter(function (f) { return f.parent === folderId && !BROWSE_HIDDEN.test(f.name); })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
  const files = [];
  const it = DriveApp.getFolderById(folderId).getFiles();
  while (it.hasNext() && files.length < 200) {
    const f = it.next();
    files.push({ id: f.getId(), name: f.getName() });
  }
  files.sort(function (a, b) { return a.name.localeCompare(b.name); });
  const shown = files.slice(0, BROWSE_FILE_LIMIT);

  const title = me.name ? '📂 <b>' + escapeHtml_(me.name.replace(/_/g, ' ')) + '</b>' : '📂 <b>أرشيف الشركة</b>';
  const lines = [title];
  if (!subs.length && !files.length) lines.push('المجلد فارغ.');
  shown.forEach(function (f, i) { lines.push((i + 1) + '. ' + escapeHtml_(f.name)); });
  if (files.length > shown.length) lines.push('… و' + (files.length - shown.length) + ' ملف ثاني. دوّر عليهم بالبحث.');

  const kb = subs.map(function (f) { return [btn_('📂 ' + shortName_(f.name), 'fd:' + f.id)]; })
    .concat(rows_(shown.map(function (f, i) { return btn_('📄 ' + (i + 1), 'sf:' + f.id); }), 5));
  const nav = [];
  if (me.parent) nav.push(btn_('⬆️ رجوع', 'fd:' + me.parent));
  nav.push(btn_('🔍 بحث', 'menu:search'));
  kb.push(nav);
  // رسالة تلغرام حدها 4096 حرف
  let text = lines.join('\n');
  if (text.length > 4000) text = text.slice(0, 3990) + '\n…';
  send_(user.chatId, text, kb);
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
  const kb = isManager_(user.id) ? [[btn_('🖨️ اطبعه بالمكتب', 'pf:' + fileId)]] : null;
  const res = sendDriveFile_(user.chatId, fileId, file.getName(), kb);
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

/** الجدول يحوّل "1/2026" و"2026-10-20" لتواريخ تلقائياً، فنرجعها نص. */
function cellText_(v) {
  if (Object.prototype.toString.call(v) !== '[object Date]') return v;
  return Utilities.formatDate(v, 'Asia/Baghdad', 'yyyy-MM-dd');
}

function rowToTender_(r) {
  return {
    key: r[0], added: cellText_(r[1]), entity: r[2], title: r[3], number: r[4], gov: r[5], category: r[6],
    cost: r[7], closing: cellText_(r[8]), link: r[9], fit: r[10], notes: r[11], status: r[12], updated: r[13]
  };
}

/** أعمدة التاريخ والرقم تنكتب كنص حتى الجدول ما يحوّلها. */
function textColumns_(sh) {
  [2, 5, 9, 14].forEach(function (c) { sh.getRange(2, c, 2000, 1).setNumberFormat('@'); });
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
  textColumns_(sh);
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
      row[1] = cellText_(old[1]);                                  // تاريخ الإضافة الأصلي
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

// ===== Admin.gs =====
/**
 * لوحة صاحب البوت (OWNER_ID): أوامر تنكتب بالبوت مباشرة.
 *
 *   /admin            اللوحة: الموظفين والمدير والمراقبين والطابور
 *   /add 123          يضيف موظف
 *   /remove 123       يشيل موظف (ومن المراقبين إذا موجود)
 *   /manager 123      يغيّر المدير
 *   /watch 123        يضيف مراقب      /unwatch 123   يشيله
 *   /say نص           رسالة لكل الموظفين والمدير
 */

function setIdList_(name, ids) {
  setProp_(name, ids.filter(function (t, i, a) { return t && a.indexOf(t) === i; }).join(','));
}

function showAdmin_(user) {
  if (!isOwner_(user.id)) return showMenu_(user.chatId, '⛔ هذا لصاحب البوت بس.');
  const counts = {};
  listRequests_('').forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
  const queue = Object.keys(counts).map(function (k) { return k + ': ' + counts[k]; }).join(' · ') || 'فارغ';
  const staff = allowedIds_();
  showMenu_(user.chatId, [
    '👑 <b>لوحة صاحب البوت</b>',
    '👔 المدير: <code>' + escapeHtml_(prop_('MANAGER_ID') || 'غير محدد') + '</code>',
    '👥 الموظفين (' + staff.length + '): ' + (staff.map(function (s) { return '<code>' + s + '</code>'; }).join('، ') || 'لا يوجد'),
    '👁️ المراقبين: ' + (idList_('WATCH_IDS').map(function (s) { return '<code>' + s + '</code>'; }).join('، ') || 'بس إنت'),
    '📋 الطابور: ' + escapeHtml_(queue),
    '',
    '<b>الأوامر:</b>',
    '/add 123 — إضافة موظف',
    '/remove 123 — شيل موظف',
    '/manager 123 — تغيير المدير',
    '/watch 123 · /unwatch 123 — المراقبين',
    '/say نص — رسالة للكل'
  ].join('\n'));
}

/** يرجّع true إذا الرسالة أمر من أوامر صاحب البوت وانعالجت. */
function handleOwnerCommand_(user, text) {
  const m = text.match(/^\/(admin|add|remove|manager|watch|unwatch|say)(?:@\w+)?(?:\s+([\s\S]+))?$/);
  if (!m) return false;
  const cmd = m[1];
  const arg = (m[2] || '').trim();
  const id = arg.replace(/[^\d-]/g, '');

  if (cmd === 'admin') { showAdmin_(user); return true; }
  if (cmd === 'say') {
    if (!arg) { send_(user.chatId, 'اكتب الرسالة بعد الأمر: /say النص'); return true; }
    const targets = allowedIds_().concat([prop_('MANAGER_ID')])
      .filter(function (t, i, a) { return t && t !== user.id && a.indexOf(t) === i; });
    targets.forEach(function (t) { send_(t, '📢 ' + escapeHtml_(arg)); });
    send_(user.chatId, '📢 انرسلت لـ ' + targets.length + ' شخص.');
    return true;
  }
  if (!id) { send_(user.chatId, 'اكتب المعرّف بعد الأمر، مثال: /' + cmd + ' 123456789'); return true; }
  if (id === user.id) { send_(user.chatId, 'هذا معرّفك إنت، صلاحيتك أعلى من الكل أصلاً 👑'); return true; }

  switch (cmd) {
    case 'add':
      setIdList_('ALLOWED_IDS', allowedIds_().concat([id]));
      send_(user.chatId, '✅ انضاف الموظف <code>' + id + '</code>');
      send_(id, '✅ صار عندك وصول لبوت أقصى الفرات. اكتب /start');
      break;
    case 'remove':
      setIdList_('ALLOWED_IDS', allowedIds_().filter(function (x) { return x !== id; }));
      setIdList_('WATCH_IDS', idList_('WATCH_IDS').filter(function (x) { return x !== id; }));
      clearState_(id);
      send_(user.chatId, '🗑️ انشال <code>' + id + '</code>' +
        (id === prop_('MANAGER_ID') ? '\n⚠️ هذا المدير، وبعده مدير. غيّره بـ /manager' : ''));
      break;
    case 'manager':
      setProp_('MANAGER_ID', id);
      send_(user.chatId, '👔 صار المدير <code>' + id + '</code>');
      send_(id, '👔 صرت مدير ببوت أقصى الفرات: توصلك الطلبات وأزرار الطباعة. اكتب /start');
      break;
    case 'watch':
      setIdList_('WATCH_IDS', idList_('WATCH_IDS').concat([id]));
      send_(user.chatId, '👁️ صار مراقب <code>' + id + '</code>');
      break;
    case 'unwatch':
      setIdList_('WATCH_IDS', idList_('WATCH_IDS').filter(function (x) { return x !== id; }));
      send_(user.chatId, '👁️ انشال من المراقبين <code>' + id + '</code>');
      break;
  }
  return true;
}

// ===== Office.gs =====
/**
 * ربط البوت باللابتوب: المدير يتحكم بكلشي من البوت بدون ما يفتح موقع أو برنامج.
 *
 * البوت يدز الأمر لوسيط Cloudflare (WORKER_URL، هيدر X-Bot-Secret = TG_SECRET)،
 * والوسيط يحطه بطابور برنامج اللابتوب (bot/laptop)، واللابتوب يرد بالنتيجة لنفس الشخص.
 *
 *   🖥️ المكتب          حالة اللابتوب وأزرار: اطبع ملف، صفحة تجربة، رسالة على الشاشة، اقفل، نوّم، إعادة تشغيل، طفّي
 *   🖨️ اطبع (بأي ملف)  زر تحت ملفات الأرشيف وملفات الطلبات الجاهزة
 *   ✅ اطبعه (طلب)      موافقة المدير تدز ملفات النتائج للابتوب وتنطبع
 *   📦 مناقصة جديدة     يدز «طلب مناقصة.xlsx» معبّى، ومصنع المناقصات باللابتوب يبني الحزمة ويحفظها بالأرشيف
 *   📄 نموذج الطلب      يرسل نموذج الطلب الفارغ (من مجلد «مصنع المناقصات» بالدرايف)
 *   ⏰ المستمسكات       المستمسكات اللي تنتهي خلال 45 يوم
 *
 * المسموح: صاحب البوت والمدير (isManager_).
 */

const OFFICE_BUTTONS = {
  print: '🖨️ صفحة تجربة',
  text: '✍️ رسالة على الشاشة',
  lock: '🔒 اقفل الشاشة',
  sleep: '🌙 نوّم',
  restart: '🔄 إعادة تشغيل',
  shutdown: '⏻ طفّي'
};

// حد ملف الطباعة (KV بالوسيط حده 25 ميغا)
const PRINT_MAX_BYTES = 15 * 1024 * 1024;

function workerBase_() {
  return prop_('WORKER_URL').replace(/\/+$/, '');
}

function workerCall_(path, payload) {
  const base = workerBase_();
  if (!base) return { ok: false, error: 'رابط الوسيط (WORKER_URL) مو مضبوط' };
  const opts = { headers: { 'X-Bot-Secret': prop_('TG_SECRET') }, muteHttpExceptions: true };
  if (payload) {
    opts.method = 'post';
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(base + path, opts);
  let body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { /* مو JSON */ }
  if (res.getResponseCode() !== 200) {
    return { ok: false, error: body.error === 'OFFICE_KV not bound' ? 'الوسيط مو مربوط بـ KV' : 'الوسيط رجّع ' + res.getResponseCode() };
  }
  body.ok = true;
  return body;
}

/** «متصل» إذا اللابتوب سأل خلال 6 دقايق (يدز نبضة كل 3). */
function laptopLine_(st) {
  if (!st.ok) return '⚠️ ما كدرت أوصل للوسيط: ' + escapeHtml_(st.error);
  if (!st.seen) return '⚪ اللابتوب ما اتصل بعد (البرنامج مو منصّب؟)';
  const mins = Math.round((st.now - st.seen) / 60000);
  if (mins <= 6) return '🟢 اللابتوب شغّال ومتصل';
  const when = Utilities.formatDate(new Date(st.seen), 'Asia/Baghdad', 'yyyy-MM-dd HH:mm');
  return '🔴 اللابتوب مطفي أو نايم (آخر اتصال ' + when + ')\nالأوامر تنتظر وتتنفذ أول ما يشتغل.';
}

function showOffice_(user) {
  if (!isManager_(user.id)) return showMenu_(user.chatId, '⛔ المكتب للمدير بس.');
  const st = workerCall_('/office/status');
  const kb = [[btn_('📦 مناقصة جديدة', 'off:tender'), btn_('📄 نموذج الطلب', 'off:form')],
    [btn_('📄 اطبع ملف', 'off:file'), btn_('⏰ المستمسكات', 'off:docs')],
    [btn_('💻 حالة اللابتوب', 'off:status')]]
    .concat(rows_(Object.keys(OFFICE_BUTTONS).map(function (k) { return btn_(OFFICE_BUTTONS[k], 'off:' + k); }), 2));
  kb.push([btn_('🔄 تحديث', 'menu:office'), btn_('🏠 القائمة', 'off:home')]);
  send_(user.chatId, '🖥️ <b>المكتب</b>\n' + laptopLine_(st) +
    '\n\n• مناقصة: خذ «نموذج الطلب»، عبّيه، ودزه بـ«مناقصة جديدة». الحزمة تجهز بالأرشيف خلال دقايق.' +
    '\n• اطبع أي ملف: دوس «اطبع ملف» ودزه، أو دوس 🖨️ تحت أي ملف بالأرشيف.\n• الطلبات الجاهزة تنطبع لمّا توافق عليها.', kb);
}

function handleOfficeButton_(user, action) {
  if (!isManager_(user.id)) return send_(user.chatId, '⛔ المكتب للمدير بس.');
  if (action === 'home') { clearState_(user.chatId); return showMenu_(user.chatId, 'شنو تحتاج؟'); }
  if (action === 'file') {
    setState_(user.chatId, { flow: 'print', step: 0, data: {}, files: [] });
    return send_(user.chatId, '📄 دزلي الملف (PDF أو Word أو صورة) وينطبع بالمكتب.\nتكدر تدز أكثر من ملف. من تخلص دوس /start',
      [[btn_('❌ إلغاء', 'off:home')]]);
  }
  if (action === 'tender') {
    setState_(user.chatId, { flow: 'tender', step: 0, data: {}, files: [] });
    return send_(user.chatId, '📦 دزلي «طلب مناقصة.xlsx» معبّى (الشركة، الجهة، رقم الدعوة، والمواد بالأسعار).\n' +
      'المصنع باللابتوب يبني الحزمة كاملة ويحطها بالأرشيف ويدزلك الخلاصة.', [[btn_('📄 نموذج الطلب', 'off:form'), btn_('❌ إلغاء', 'off:home')]]);
  }
  if (action === 'form') return sendJobForm_(user);
  if (action === 'docs') return pushOffice_(user, { cmd: 'docs' }, '⏰ فحص المستمسكات');
  if (action === 'status') return pushOffice_(user, { cmd: 'status' }, '💻 حالة اللابتوب');
  if (action === 'text') {
    setState_(user.chatId, { flow: 'screen', step: 0, data: {}, files: [] });
    return send_(user.chatId, '✍️ اكتب الرسالة اللي تطلع على شاشة اللابتوب:', [[btn_('❌ إلغاء', 'off:home')]]);
  }
  if (action === 'shutdown' || action === 'restart') {
    return send_(user.chatId, (action === 'shutdown' ? '⏻ أكيد تطفي اللابتوب؟\nبعدها ما يشتغل إلا بزر التشغيل. «نوّم» أحسن.' : '🔄 أكيد تعيد تشغيل اللابتوب؟'),
      [[btn_('نعم', 'off:' + action + '!'), btn_('لا', 'menu:office')]]);
  }
  const cmd = action.replace(/!$/, '');
  if (!OFFICE_BUTTONS[cmd]) return;
  pushOffice_(user, { cmd: cmd }, OFFICE_BUTTONS[cmd]);
}

/** يدز أمر للابتوب ويبلّغ المستخدم إنه انرسل (النتيجة توصله من اللابتوب). */
function pushOffice_(user, payload, label) {
  payload.chat = String(user.chatId);
  const res = workerCall_('/office/push', payload);
  if (!res.ok) return send_(user.chatId, '⚠️ ما انرسل «' + escapeHtml_(label) + '»: ' + escapeHtml_(res.error));
  const online = res.seen && res.now - res.seen <= 6 * 60000;
  send_(user.chatId, '📤 انرسل للابتوب: ' + escapeHtml_(label) +
    (online ? '\nتوصلك النتيجة خلال ثواني.' : '\n🔴 اللابتوب مطفي أو نايم، ينفّذه أول ما يشتغل.'));
  if (!isOwner_(user.id)) watchLog_(user, '🖥️ ' + escapeHtml_(label));
}

/** يدز ملف (Blob) للابتوب حتى ينطبع. */
function printBlob_(user, blob) {
  const name = blob.getName() || 'ملف';
  const bytes = blob.getBytes();
  if (bytes.length > PRINT_MAX_BYTES) return send_(user.chatId, '⚠️ ' + escapeHtml_(name) + ' أكبر من 15 ميغا، ما يندز للطباعة من البوت.');
  pushOffice_(user, { cmd: 'printfile', name: name, b64: Utilities.base64Encode(bytes) }, '🖨️ ' + name);
}

/** ملف من الدرايف: ملفات Google (Docs/Sheets) تتحول PDF. */
function driveFileBlob_(file) {
  const mime = file.getMimeType();
  if (mime.indexOf('application/vnd.google-apps') === 0) {
    const blob = file.getAs(MimeType.PDF);
    blob.setName(file.getName() + '.pdf');
    return blob;
  }
  return file.getBlob();
}

/** زر 🖨️ تحت ملف بالأرشيف (pf:<id>). */
function printArchiveFile_(user, fileId) {
  if (!isManager_(user.id)) return send_(user.chatId, '⛔ الطباعة للمدير بس.');
  let file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { return send_(user.chatId, 'الملف مو موجود.'); }
  const folderSet = {};
  archiveFolderIds_().forEach(function (id) { folderSet[id] = true; });
  if (!inArchive_(file, folderSet) && !inRequests_(file)) return send_(user.chatId, '⛔ هذا الملف مو بالأرشيف.');
  printBlob_(user, driveFileBlob_(file));
}

/** ملف داخل مجلد طلبات البوت؟ (ملفات النتائج) */
function inRequests_(file) {
  const root = rootFolder_().getId();
  let parents = file.getParents();
  for (let depth = 0; depth < 4 && parents.hasNext(); depth++) {
    const p = parents.next();
    if (p.getId() === root) return true;
    parents = p.getParents();
  }
  return false;
}

/** رسائل المستخدم وهو بخطوة «اطبع ملف» أو «رسالة على الشاشة». */
function handleOfficeInput_(user, state, msg) {
  if (!isManager_(user.id)) { clearState_(user.chatId); return; }
  const text = (msg.text || '').trim();
  if (state.flow === 'screen') {
    if (!text) return send_(user.chatId, 'اكتب الرسالة نص، أو دوس إلغاء.');
    clearState_(user.chatId);
    return pushOffice_(user, { cmd: 'text', text: text.slice(0, 300) }, '✍️ ' + text.slice(0, 60));
  }
  if (state.flow === 'tender') {
    const doc = msg.document;
    if (!doc || !/\.(xlsx|json)$/i.test(doc.file_name || '')) {
      return send_(user.chatId, '📦 دز ملف الطلب (xlsx)، أو دوس إلغاء.', [[btn_('❌ إلغاء', 'off:home')]]);
    }
    clearState_(user.chatId);
    const blob = downloadTelegramFile_(doc.file_id, doc.file_name);
    return pushOffice_(user, { cmd: 'tender', name: doc.file_name, b64: Utilities.base64Encode(blob.getBytes()) },
      '📦 مناقصة: ' + doc.file_name);
  }
  const ref = msg.document ? { id: msg.document.file_id, name: msg.document.file_name } :
    msg.photo ? { id: msg.photo[msg.photo.length - 1].file_id, name: 'صورة_' + Date.now() + '.jpg' } : null;
  if (!ref) return send_(user.chatId, '📄 دز ملف أو صورة حتى ينطبع، أو /start للقائمة.');
  printBlob_(user, downloadTelegramFile_(ref.id, ref.name));
}

/** ملفات نتائج الطلب للابتوب (موافقة المدير). PDF أول، وإذا ماكو PDF كل الملفات. */
function printRequestOnLaptop_(user, req) {
  if (!workerBase_()) return { ok: false, error: 'رابط الوسيط مو مضبوط' };
  const all = [];
  const it = DriveApp.getFolderById(req.results_folder_id).getFiles();
  while (it.hasNext()) all.push(it.next());
  const pdfs = all.filter(function (f) { return f.getMimeType() === MimeType.PDF; });
  const files = pdfs.length ? pdfs : all;
  if (!files.length) return { ok: false, error: 'ماكو ملفات بمجلد النتائج' };
  files.forEach(function (f) { printBlob_(user, driveFileBlob_(f)); });
  return { ok: true, count: files.length };
}

/** نموذج «طلب مناقصة.xlsx» الفارغ من مجلد «مصنع المناقصات» بالدرايف (يسويه برنامج اللابتوب). */
function sendJobForm_(user) {
  if (!isManager_(user.id)) return;
  const it = DriveApp.getFilesByName('طلب مناقصة.xlsx');
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    const res = sendDriveFile_(user.chatId, f.getId(), '📄 نموذج طلب مناقصة: عبّي ورقة «البيانات» وورقة «المواد»، ودزه بـ«📦 مناقصة جديدة».');
    if (res.ok) return;
  }
  send_(user.chatId, '⚠️ ما لكيت «طلب مناقصة.xlsx» بالدرايف. ينسوّى لمّا ينتصب برنامج اللابتوب (مجلد «مصنع المناقصات»).');
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
        // صاحب البوت يستلم نفس الملفات والأزرار
        const owner = prop_('OWNER_ID');
        if (owner && owner !== mgr && owner !== req.chat_id) {
          ids.forEach(function (id) { sendDriveFile_(owner, id); });
          send_(owner, '👑 نسخة لك: <b>' + req.id + '</b> بانتظار موافقة المدير.\n' + escapeHtml_(d.message || ''),
            [[btn_('✅ اطبعه', 'mgr:ok:' + req.id), btn_('↩️ رجّعه للتعديل', 'mgr:no:' + req.id)]]);
        }
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
