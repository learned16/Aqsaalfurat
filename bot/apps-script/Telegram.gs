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
