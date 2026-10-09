# شركة أقصى الفرات — ملاحظات لأي جلسة جديدة

المستخدم: حارث، يتكلم عراقي. يدير ملفات المناقصات لشركة أقصى الفرات (كركوك، مقاولات درجة خامسة، المدير حسين حمود عبد، حساب الشركة companyaqsaalfurat@gmail.com). ردّ عليه بالعراقي، قصير وواضح، وخطوة خطوة إذا يطلب تنصيب.

## قواعد ثابتة
- لا تطلب منه يلصق رموز أو مفاتيح بالمحادثة. الأسرار تنحط بـ Script Properties أو بمتغيرات بيئة الجلسة.
- لا تطبع BOT_KEY ولا رمز تلغرام بأي رد أو commit.
- ما ينحذف أصل ولا شي يروح للمحذوفات بدون طلبه.
- الرسائل الخارجة (بوت، إيميل) للمدير أو لمقدم الطلب بس. لا تقدّم عطاءات ولا تسجّل بمواقع ولا ترسل إيميلات.
- لا تكتب اسم نموذج بالـ commits.

## البوت (مجلد bot/)
بوت تلغرام على Google Apps Script (حساب الشركة)، يمر عبر وسيط Cloudflare (`bot/cloudflare/worker.js`) حتى يرد فوراً.
- الكود الكامل بملف واحد: `bot/single/Code.gs` (يتولّد من `bot/apps-script/*.gs` بترتيب Config, Telegram, Storage, Bot, Search, Tenders, Admin, Api, Setup, Poll, Worker). عدّل الملفات الأصلية ثم أعد التوليد.
- المستخدم يلصق الكود يدوياً بـ Apps Script وبعدها Deploy ← Manage deployments ← New version. أي تعديل بالكود ما يشتغل لحد ما يسوي هذا. اسأله إذا حدّث.
- القائمة: اطلب شي (طلب حر + ملفات)، بحث بالأرشيف، مناقصات اليوم، اعتذار، وصل، طلباتي. صاحب البوت (OWNER_ID) عنده 📥 كل الطلبات و👑 الإدارة (/add /remove /manager /watch /unwatch /say /admin). المراقبين (WATCH_IDS) يوصلهم نسخة من كل طلب.
- الطلبات تنكتب بجدول «طابور بوت أقصى الفرات» (مجلد 09_طلبات_البوت بالأرشيف).
- المكتب الافتراضي: `bot/cloudflare/office.html` على الوسيط بمسار `/office`، أوامره تروح رسالة تلغرام لصاحب البوت عبر `/office/cmd` (متغيرات الوسيط TG_TOKEN, OWNER_ID, OFFICE_PIN). المستخدم يلصق `bot/single/worker.js` (يتولّد بـ `python3 bot/cloudflare/build.py`). برنامج اللابتوب اللي ينفّذ الأوامر مو مسوّى بعد.
- Script Properties: TELEGRAM_TOKEN, TG_SECRET, API_KEY, ALLOWED_IDS, OWNER_ID, MANAGER_ID, WATCH_IDS, PRINTER_EMAIL, WORKER_URL, LAST_BRIEF.
- الأرشيف (مجلد البحث): `18ypIMmqpsXTlMFNFN0LtX64V0ipAUXSY`.

## كيف تشتغل مع البوت من الجلسة
بيئة الجلسة لازم فيها `BOT_URL` و`BOT_KEY` والشبكة Full. تحقق بـ `env | grep -c BOT_`.
```bash
cd bot
python3 bridge.py list                       # الطلبات الجديدة (يعيد المحاولة إذا Apps Script رجع HTML)
python3 bridge.py files R261008-001          # مرفقات الطلب
python3 bridge.py update <id> "قيد العمل" --notify
python3 bridge.py upload <id> out/*.pdf out/*.docx
python3 bridge.py deliver <id> --manager --msg "..."
python3 bridge.py notify manager "نص"
python3 bridge.py tenders today.json --push manager
python3 bridge.py tenders-list
```
معالجة طلب: اقرأ الطلب (النص بعمود ملاحظات) ← جهّزه بمهارة `aqsa-tender-package` (أو مهارة الاعتذارات `company-apology-letters`) ← upload ← deliver. الطلب الحر ممكن يكون أي شي (كتاب، ملف من الأرشيف، بحث).

## الرصد اليومي للمناقصات
المصدر الأساسي: منصة الإعلانات الموحدة **itp.iq** (واجهة `api.itp.iq/api/bus/tenders/get` بـ POST مع page وcount، بدون تسجيل دخول، فيها آلاف الإعلانات، الإعلانات PDF مصوّرة وتنقرأ كصور). مواقع الأنبار (anbar.iq) وبعض المحافظات تشتغل. مواقع وزارة النفط والكهرباء وkirkuk.gov.iq غالباً مغلقة (403 أو انقطاع).
المحافظات: بغداد، الأنبار، نينوى، كركوك، صلاح الدين. إنشائي أولاً، وكركوك كل شي مفيد. الدرجة الخامسة: تأكد من سقف الكلفة قبل ما تكتب «مؤهل».
JSON للمزامنة: `{brief:{date,body}, tenders:[{key,title,entity,number,gov,category,cost,closing(YYYY-MM-DD),link,fit,notes}]}`.

## وضع الأمور (2026-10-08)
- البوت يشتغل ويستلم طلبات، وانرسلت نشرة اليوم (20 مناقصة) ومناقصات غاز الشمال للمدير.
- مو مسوّى: مهمة كل ساعة لمعالجة طلبات البوت (تحتاج connectors من إعدادات المهام)، تسجيل طابعة Epson وPRINTER_EMAIL، ضبط MANAGER_ID للمدير الحقيقي (/manager).
- آخر تعديلين بالكود (نص التواريخ والأرقام بجدول المناقصات، وخروج البوت من وضع البحث بعد كل بحث) ينتظرون تحديث المستخدم لـ Code.gs وإعادة النشر.
- مهمة روتين الصبح القديمة: trig_01Mf5hTZcpKUJN8vQ5fmg9Sd. مهمة تنظيف الدرايف الأسبوعية (الخميس) موجودة.
- أرقام الرسائل الصادرة: التالي 232.
- جدول الانتهاءات (1Uvs1j6DMTUxpjAlwTDsOz2Pm8y4he_nObqXy2s7UcDM) ناقصه كفالة 18478 (5,100,000، تنتهي 2027/04/01).
- ننصح المستخدم يغيّر رمز البوت والمفاتيح لأنها انكشفت بالمحادثة.
