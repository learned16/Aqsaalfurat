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
  if (allowedIds_().indexOf(userId) < 0 && userId !== prop_('MANAGER_ID')) {
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
  if (!state) {
    showMenu_(chatId, 'اختار من القائمة 👇');
    return;
  }
  handleInput_(user, state, msg);
}

function showMenu_(chatId, text) {
  send_(chatId, text, [
    [btn_('📑 إنشاء مناقصة', 'menu:tender'), btn_('📝 اعتذار', 'menu:apology')],
    [btn_('📊 مناقصات اليوم', 'menu:tenders')],
    [btn_('🧾 تسجيل وصل', 'menu:receipt'), btn_('📋 طلباتي', 'menu:mine')]
  ]);
}

// ---------------------------------------------------------------------------
// الخطوات
// ---------------------------------------------------------------------------

const FLOWS = {
  tender: ['company', 'number', 'entity', 'closing', 'price', 'files', 'notes', 'confirm'],
  apology: ['company', 'number', 'entity', 'reason', 'notes', 'confirm'],
  receipt: ['photo', 'amount', 'description']
};

const FLOW_NAMES = { tender: 'مناقصة', apology: 'اعتذار', receipt: 'وصل' };

const ENTITIES = ['كهرباء الوسط', 'غاز الشمال', 'نفط الشمال', 'مصفى الشمال', 'أخرى (أكتبها)'];

function startFlow_(user, flow, prefill) {
  const state = { flow: flow, step: 0, data: prefill || {}, files: [] };
  setState_(user.chatId, state);
  ask_(user, state);
}

// خطوات تنعبر إذا جوابها موجود من قبل (مثلاً من مناقصة بنشرة اليوم)
const PREFILLABLE = ['number', 'entity', 'closing'];

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
  if (PREFILLABLE.indexOf(step) >= 0 && state.data[step]) return next_(user, state);
  switch (step) {
    case 'company':
      send_(c, '🏢 لأي شركة؟', rows_(COMPANIES.map(function (n, i) { return btn_(n, 'co:' + i); }), 2));
      break;
    case 'number':
      send_(c, '🔢 اكتب رقم الدعوة أو المناقصة (مثال: LMD-17/2026 أو 12/2026)');
      break;
    case 'entity':
      send_(c, '🏛️ الجهة المعلنة؟', rows_(ENTITIES.map(function (n, i) { return btn_(n, 'ent:' + i); }), 2));
      break;
    case 'closing':
      send_(c, '📅 موعد الغلق؟ (مثال: 2026/10/20 الساعة 10 صباحاً)');
      break;
    case 'price':
      send_(c, '💰 السعر؟ نسبة فوق الكلفة التخمينية، أو اكتب مبلغ ثابت بالدينار.', [
        [btn_('+10%', 'price:+10%'), btn_('+25%', 'price:+25%'), btn_('+30%', 'price:+30%'), btn_('+50%', 'price:+50%')],
        [btn_('حارث يحدد السعر', 'price:يحدده حارث')]
      ]);
      break;
    case 'files':
      send_(c, '📎 ارفع وثيقة الدعوة وأي مرفقات (PDF أو صور أو وورد). ترسلها وحدة وحدة، ومن تخلص دوس الزر.',
        [[btn_('✅ انتهيت من الرفع', 'files:done')]]);
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
  const lines = ['<b>ملخص طلب ' + FLOW_NAMES[state.flow] + '</b>'];
  if (d.company) lines.push('🏢 الشركة: ' + escapeHtml_(d.company));
  if (d.number) lines.push('🔢 الرقم: ' + escapeHtml_(d.number));
  if (d.entity) lines.push('🏛️ الجهة: ' + escapeHtml_(d.entity));
  if (d.closing) lines.push('📅 الغلق: ' + escapeHtml_(d.closing));
  if (d.price) lines.push('💰 السعر: ' + escapeHtml_(d.price));
  if (d.reason) lines.push('❓ السبب: ' + escapeHtml_(d.reason));
  if (d.ref) lines.push('🔗 من النشرة: ' + escapeHtml_(d.ref));
  if (state.files.length) lines.push('📎 المرفقات: ' + state.files.length + ' ملف');
  lines.push('📝 ملاحظات: ' + escapeHtml_(d.notes || 'لا يوجد'));
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
    return startFlow_(user, value);
  }
  if (kind === 'mgr') return handleManager_(user, parts[1], parts.slice(2).join(':'), message);
  if (kind === 'td') return handleTenderButton_(user, parts[1], parts.slice(2).join(':'), message);

  const state = getState_(user.chatId);
  if (!state) return showMenu_(user.chatId, 'الجلسة انتهت، ابدي من جديد 👇');
  const step = stepName_(state);

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
  if (kind === 'price' && step === 'price') {
    state.data.price = value;
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
    if (!state.files.length) return send_(user.chatId, '⚠️ ما رفعت ولا ملف. ارفع وثيقة الدعوة على الأقل.');
    return next_(user, state);
  }
  if (kind === 'notes' && value === 'none' && step === 'notes') {
    state.data.notes = '';
    return next_(user, state);
  }
  if (kind === 'confirm' && step === 'confirm') {
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

  if (step === 'files' || step === 'photo') {
    if (!fileRef) return send_(user.chatId, '📎 أرسل ملف أو صورة، أو دوس الزر إذا خلصت.');
    const blob = downloadTelegramFile_(fileRef.id, fileRef.name);
    const file = childFolder_(rootFolder_(), 'مؤقت').createFile(blob);
    state.files.push(file.getId());
    if (step === 'photo') return next_(user, state);
    setState_(user.chatId, state);
    return send_(user.chatId, '✅ استلمت: ' + escapeHtml_(file.getName()) + '\nارفع غيره، أو دوس الزر إذا خلصت.',
      [[btn_('✅ انتهيت من الرفع', 'files:done')]]);
  }

  if (!text) return send_(user.chatId, 'اكتب جواب، أو /cancel للإلغاء.');

  if (state.awaitText) {
    delete state.awaitText;
    if (step === 'entity') state.data.entity = text;
    if (step === 'reason') state.data.reason = text;
    return next_(user, state);
  }

  switch (step) {
    case 'company':
      state.data.company = text;
      return next_(user, state);
    case 'number':
      state.data.number = text;
      return next_(user, state);
    case 'entity':
      state.data.entity = text;
      return next_(user, state);
    case 'closing':
      state.data.closing = text;
      return next_(user, state);
    case 'price':
      state.data.price = text;
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
    price: d.price, reason: d.reason, notes: [d.notes, d.ref].filter(Boolean).join(' | ')
  };
  const f = createRequestFolders_(req);
  state.files.forEach(function (id) { DriveApp.getFileById(id).moveTo(f.attachments); });
  req.folder_id = f.folder.getId();
  req.results_folder_id = f.results.getId();
  appendRequest_(req);
  clearState_(user.chatId);

  send_(user.chatId, '✅ انرسل الطلب <b>' + req.id + '</b>\nClaude يشتغل عليه، والملفات توصلك هنا من تجهز (عادة خلال ساعة).');
  const mgr = prop_('MANAGER_ID');
  if (mgr && mgr !== user.id) {
    send_(mgr, '📥 طلب جديد ' + req.id + ' من ' + escapeHtml_(user.name) + '\n' + summary_(state));
  }
}

function saveReceipt_(user, state) {
  const file = DriveApp.getFileById(state.files[0]);
  const d = state.data;
  const ext = (file.getName().match(/\.[A-Za-z0-9]+$/) || ['.jpg'])[0];
  file.moveTo(receiptsFolder_());
  file.setName(Utilities.formatDate(new Date(), 'Asia/Baghdad', 'yyyy-MM-dd') + '_' + d.amount + '_' +
    d.description.slice(0, 40).replace(/[\/\\]/g, '-') + ext);
  appendReceipt_({ requester: user.name, amount: d.amount, description: d.description, url: file.getUrl() });
  clearState_(user.chatId);
  showMenu_(user.chatId, '🧾 انسجل الوصل: ' + d.amount.toLocaleString('en-US') + ' دينار\n' + escapeHtml_(d.description));
}

function showMine_(user) {
  const mine = listRequests_().filter(function (r) { return r.chat_id === String(user.chatId); }).slice(-5).reverse();
  if (!mine.length) return showMenu_(user.chatId, 'ما عندك طلبات بعد.');
  const lines = mine.map(function (r) {
    return '• <b>' + r.id + '</b> ' + escapeHtml_(r.type + ' ' + (r.company || '') + ' ' + (r.number || '')) +
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
