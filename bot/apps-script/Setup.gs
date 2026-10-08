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
