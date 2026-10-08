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
