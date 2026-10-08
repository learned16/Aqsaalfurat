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
