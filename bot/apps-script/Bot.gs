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
