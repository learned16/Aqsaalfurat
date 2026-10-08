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
