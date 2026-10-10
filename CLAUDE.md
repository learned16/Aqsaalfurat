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
- الكود الكامل بملف واحد: `bot/single/Code.gs` (يتولّد من `bot/apps-script/*.gs` بترتيب Config, Telegram, Storage, Bot, Search, Tenders, Admin, Api, Setup, Poll, Worker). عدّل الملفات الأصلية ثم أعد التوليد بـ `python3 bot/build.py`.
- المستخدم يلصق الكود يدوياً بـ Apps Script وبعدها Deploy ← Manage deployments ← New version. أي تعديل بالكود ما يشتغل لحد ما يسوي هذا. اسأله إذا حدّث.
- القائمة: اطلب شي (طلب حر + ملفات)، بحث بالأرشيف، تصفح الأرشيف، مناقصات اليوم، اعتذار، وصل، طلباتي. صاحب البوت (OWNER_ID) عنده 📥 كل الطلبات و👑 الإدارة (/add /remove /manager /watch /unwatch /say /admin). المراقبين (WATCH_IDS) يوصلهم نسخة من كل طلب.
- الطلبات تنكتب بجدول «طابور بوت أقصى الفرات» (مجلد 09_طلبات_البوت بالأرشيف).
- المكتب الافتراضي: https://aqsa-bot.companyaqsaalfurat.workers.dev/office (الوسيط اسمه aqsa-bot، منشور وشغّال 2026-10-09). الملف `bot/cloudflare/office.html`، أوامره تروح رسالة تلغرام لصاحب البوت عبر `/office/cmd` (متغيرات الوسيط TG_TOKEN, OWNER_ID, OFFICE_PIN). المستخدم يلصق `bot/single/worker.js` (يتولّد بـ `python3 bot/cloudflare/build.py`). برنامج اللابتوب (ويندوز) بـ `bot/laptop` (install.cmd): يسأل `/office/poll` كل 5 ثواني (طابور KV باسم OFFICE_KV)، ويطبع مجلد «للطباعة». ما منصّب بعد.
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
- مهمة طلبات البوت كل ساعة (8 الصبح لـ 8 بالليل بغداد): trig_0161m3yADoHD9iKTzKWLiVGW. هي ومهمة الدرايف الأسبوعية بدون موصّل Google Drive لحد ما المستخدم يربطه من claude.ai.
- الطابعة: انترك موضوعها (المحل عدّل برمجتها وما ترتبط بـ Epson Connect). مو مسوّى: ضبط MANAGER_ID للمدير الحقيقي (/manager).
- تسمية ملفات الدرايف (2026-10-08): بمسافات بدون underscore حتى يلكاها بحث البوت، مثل «LMD-16 دعوة 16 - 6 عرض تجاري (228) - أقصى الفرات». انغيّر نحو 200 اسم.
- البحث الأذكى (مناقصة/دعوة 16 = LMD-16، والبحث بأسماء المجلدات) وزر 📂 تصفح الأرشيف: بالكود، ينتظرون المستخدم يلصق Code.gs ويسوي New version.
- آخر تعديلين بالكود (نص التواريخ والأرقام بجدول المناقصات، وخروج البوت من وضع البحث بعد كل بحث) ينتظرون تحديث المستخدم لـ Code.gs وإعادة النشر.
- مهمة روتين الصبح القديمة: trig_01Mf5hTZcpKUJN8vQ5fmg9Sd. مهمة تنظيف الدرايف الأسبوعية (الخميس) موجودة.
- أرقام الرسائل الصادرة: التالي 232.
- جدول الانتهاءات (1Uvs1j6DMTUxpjAlwTDsOz2Pm8y4he_nObqXy2s7UcDM) ناقصه كفالة 18478 (5,100,000، تنتهي 2027/04/01).
- ننصح المستخدم يغيّر رمز البوت والمفاتيح لأنها انكشفت بالمحادثة.

## برنامج اللابتوب ومصنع المناقصات (2026-10-10)
- `bot/laptop/`: agent.ps1 (البرنامج)، install.ps1، و`factory/` (مصنع المناقصات بـ Python). ما منصّب بعد على لابتوب الشركة.
- المصنع: `factory.py build طلب.xlsx` يبني الحزمة فوك كتاب سابق للشركة (`نموذج_الكتاب` بالشركات.json)، بصياغات متنوعة (wording.py)، ويرقّم من `الرقم_التالي`، ويحفظ بالأرشيف. بياناته بمجلد «مصنع المناقصات» بالدرايف. **الرقم الصادر صار مصدره الشركات.json** (يبدي 232).
- جهة جديدة: سوّي وصفتها `الجهات/<الجهة>.json` (انسخ عام.json) وحطها بـ `bridge.py pc put`. القسم الرابع الخاص بالجهة يتعبّى ويدخل بحقل «ملف القسم الرابع».
- إيد Claude (مكتبة أوامر): 🟢 `python3 bridge.py pc roots|ls|find|get|put|mkdir|copy|pdf|print|tender|check|docs|status|printers|log|zip|office`، و🟡 `install|default_printer|clear_queue|close_word|screenshot|wake_time|open_url|update` توصل لصاحب البوت بتلغرام وما تتنفذ إلا يوافق. يحتاج `PC_KEY` بالبيئة وبالوسيط. ماكو تشغيل أوامر عشوائية (نظام الحماية رفضه، لا تحاول تبنيه)؛ أي شغلة جديدة تنضاف أمر ثابت بالمكتبة.
- office (Office وPDF بلا فتح برنامج، `factory/office.py`، 21 أمر): Excel `xlsx_sheets|xlsx_read|xlsx_find|xlsx_set|xlsx_append|xlsx_new|xlsx_add_sheet`، Word `docx_read|docx_tables|docx_replace|docx_new|docx_append`، PowerPoint `pptx_read|pptx_replace|pptx_new|pptx_add`، PDF `pdf_info|pdf_text|pdf_merge|pdf_split|pdf_rotate`. الاستخدام: `bridge.py pc office <أمر> [مسار] [--json '{...}']`. agent.ps1 يتأكد من كل حقل مسار (path, out, out_dir, paths) والكتابة تحفظ نسخة قديمة. يحتاج python-pptx (انضاف لـ install.ps1).
- أمر `pdf` (تحويل بالبرنامج الحقيقي) صار يشمل Word وExcel وPowerPoint عبر COM، مو Word بس.
- Drive/Docs/Sheets/Slides/Canva: موصّلات الجلسة تكفي (متحقق منها 2026-10-10)، ما ينبنى إلهن شي باللابتوب. ملفات Word/Excel/PDF/PPTX بالجلسة: مهارات docx/xlsx/pdf/pptx.
- install صار قائمته أوسع (كلها ثابتة، بموافقة). open_url يفتح رابط بالمتصفح (بموافقة). ما بُني تحكم بكروم المسجّل دخوله ولا تشغيل كود حر (مرفوض، لا تحاول).
- البوت: 🖥️ المكتب للمدير (📦 مناقصة جديدة، 📄 نموذج الطلب، اطبع ملف، ⏰ المستمسكات، أوامر اللابتوب). الوسيط يمسك زر «🖨️ اطبع الحزمة» (pcpr:) بنفسه.
- وضع 2026-10-10: الوسيط الجديد منشور (فيه /pc و PC_KEY)، والمستخدم صلّح البوت ولصق Code.gs الجديد. اللابتوب ما منصّب بعد (ملف التنصيب AqsaOffice-laptop.zip عنده).
- متغيرات بيئة الجلسة انصلحت (BOT_KEY، BOT_URL، PC_KEY كل واحد بسطر). بأول جلسة جديدة: تحقق إن BOT_URL ينتهي بـ /exec وإن PC_KEY يقبله الوسيط (`bridge.py pc roots` يرجع 403 إذا ما يطابق).
- التحديث عن بعد (2026-10-10): المهمة المجدولة تشغّل `launcher.ps1` وهو يشغّل agent.ps1. للتحديث: عدّل `bot/laptop`، زيد `VERSION`، و`python3 bridge.py pc update --notes "..."` (يحتاج `UPDATE_KEY` بالبيئة، نفس رمز التحديث اللي انكتب وقت التنصيب). أمر `update` حساس بالوسيط (موافقة صاحب البوت). اللابتوب يتأكد من HMAC والبصمة ويفحص الكود، يحفظ القديم بـ versions\، والـ launcher يرجّعه إذا الجديد وكف 3 مرات. launcher.ps1 وinstall.ps1 ما يتحدثون عن بعد. حزمة التنصيب: `python3 bot/laptop/package.py`. النسخة الأولى 1.0. الوسيط الجديد (بيه update) لازم ينلصق بـ Cloudflare.
- PC_KEY وBOT_KEY انكتبوا بالمحادثة: ذكّر المستخدم يغيّرهم (PC_KEY بالوسيط والبيئة سوه، وBOT_KEY = API_KEY بـ Script Properties).
