/**
 * ربط البوت باللابتوب: المدير يتحكم بكلشي من البوت بدون ما يفتح موقع أو برنامج.
 *
 * البوت يدز الأمر لوسيط Cloudflare (WORKER_URL، هيدر X-Bot-Secret = TG_SECRET)،
 * والوسيط يحطه بطابور برنامج اللابتوب (bot/laptop)، واللابتوب يرد بالنتيجة لنفس الشخص.
 *
 *   🖥️ المكتب          حالة اللابتوب وأزرار: اطبع ملف، صفحة تجربة، رسالة على الشاشة، اقفل، نوّم، إعادة تشغيل، طفّي
 *   🖨️ اطبع (بأي ملف)  زر تحت ملفات الأرشيف وملفات الطلبات الجاهزة
 *   ✅ اطبعه (طلب)      موافقة المدير تدز ملفات النتائج للابتوب وتنطبع
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
  const kb = [[btn_('📄 اطبع ملف', 'off:file')]]
    .concat(rows_(Object.keys(OFFICE_BUTTONS).map(function (k) { return btn_(OFFICE_BUTTONS[k], 'off:' + k); }), 2));
  kb.push([btn_('🔄 تحديث', 'menu:office'), btn_('🏠 القائمة', 'off:home')]);
  send_(user.chatId, '🖥️ <b>المكتب</b>\n' + laptopLine_(st) +
    '\n\n• اطبع أي ملف: دوس «اطبع ملف» ودزه، أو دوس 🖨️ تحت أي ملف بالأرشيف.\n• الطلبات الجاهزة تنطبع لمّا توافق عليها.', kb);
}

function handleOfficeButton_(user, action) {
  if (!isManager_(user.id)) return send_(user.chatId, '⛔ المكتب للمدير بس.');
  if (action === 'home') { clearState_(user.chatId); return showMenu_(user.chatId, 'شنو تحتاج؟'); }
  if (action === 'file') {
    setState_(user.chatId, { flow: 'print', step: 0, data: {}, files: [] });
    return send_(user.chatId, '📄 دزلي الملف (PDF أو Word أو صورة) وينطبع بالمكتب.\nتكدر تدز أكثر من ملف. من تخلص دوس /start',
      [[btn_('❌ إلغاء', 'off:home')]]);
  }
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
