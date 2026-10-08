/**
 * بوت أقصى الفرات — الإعدادات
 *
 * كل القيم السرية تنحفظ بـ Script Properties (مو بالكود):
 *   TELEGRAM_TOKEN   رمز البوت من @BotFather
 *   TG_SECRET        كلمة سر عشوائية تنحط برابط الـ webhook حتى ما أحد غير تلغرام يرسل للسكربت
 *   API_KEY          كلمة سر عشوائية يستعملها Claude حتى يقرا الطابور ويرفع النتائج
 *   ALLOWED_IDS      معرّفات التلغرام المسموح إلها، مفصولة بفارزة (مثال: 11111111,22222222)
 *   MANAGER_ID       معرّف تلغرام المدير (يستلم أزرار الموافقة والطباعة)
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

function allowedIds_() {
  return prop_('ALLOWED_IDS').split(',').map(function (s) { return s.trim(); }).filter(String);
}
