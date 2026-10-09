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
