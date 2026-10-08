/**
 * وسيط Cloudflare لبوت أقصى الفرات.
 *
 * تلغرام يرسل الرسالة هنا، فنرد عليه فوراً بـ 200 (حتى ما يشوف تحويل 302 مال Google)،
 * ونحوّل نفس الرسالة لسكربت Apps Script بالخلفية.
 *
 * متغيرات الـ Worker (Settings → Variables and Secrets):
 *   GAS_URL    رابط الـ Web app مال Apps Script (ينتهي بـ /exec)
 *   TG_SECRET  نفس قيمة TG_SECRET بـ Script Properties (نوعه Secret)
 */
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Aqsa bot relay is running', { status: 200 });
    }
    // تلغرام يرسل الرمز السري بهذا الهيدر (ينضبط بـ setWebhook)، فنرفض أي طلب ثاني
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TG_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const body = await request.text();
    const target = env.GAS_URL + (env.GAS_URL.includes('?') ? '&' : '?') + 'tg=' + encodeURIComponent(env.TG_SECRET);
    // Apps Script ينفّذ doPost قبل ما يرد بالتحويل، فما نحتاج نتبع التحويل
    ctx.waitUntil(fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      redirect: 'manual'
    }));
    return new Response('ok', { status: 200 });
  }
};
