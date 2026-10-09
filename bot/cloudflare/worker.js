/**
 * وسيط Cloudflare لبوت أقصى الفرات.
 *
 * تلغرام يرسل الرسالة هنا، فنرد عليه فوراً بـ 200 (حتى ما يشوف تحويل 302 مال Google)،
 * ونحوّل نفس الرسالة لسكربت Apps Script بالخلفية.
 *
 * وبنفس الوسيط المكتب الافتراضي:
 *   GET  /office      صفحة المكتب (من office.html)
 *   POST /office/cmd  أمر من المكتب، ينرسل رسالة لصاحب البوت بتلغرام
 *
 * متغيرات الـ Worker (Settings → Variables and Secrets):
 *   GAS_URL     رابط الـ Web app مال Apps Script (ينتهي بـ /exec)
 *   TG_SECRET   نفس قيمة TG_SECRET بـ Script Properties (نوعه Secret)
 *   TG_TOKEN    رمز البوت، نفس TELEGRAM_TOKEN (نوعه Secret) — للمكتب بس
 *   OWNER_ID    رقم صاحب البوت بتلغرام — للمكتب بس
 *   OFFICE_PIN  رمز يكتبه حارث بالمكتب أول مرة (نوعه Secret) — للمكتب بس
 *
 * لا تلصق هذا الملف بـ Cloudflare مباشرة: الصق bot/single/worker.js
 * (يتولّد بـ python3 bot/cloudflare/build.py ويكون بيه المكتب).
 */
const OFFICE_HTML = '/*OFFICE_HTML*/';

const OFFICE_CMDS = {
  print: '🖨️ اطبع صفحة تجربة',
  shutdown: '⏻ طفّي اللابتوب',
  restart: '🔄 إعادة تشغيل اللابتوب',
  wake: '💡 شغّل اللابتوب',
  text: '✍️ أمر مكتوب'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/office' || url.pathname === '/office/') {
      return new Response(OFFICE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }
      });
    }
    if (url.pathname === '/office/cmd') {
      return officeCommand(request, env);
    }
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

async function officeCommand(request, env) {
  if (request.method !== 'POST') return new Response('method', { status: 405 });
  if (!env.OFFICE_PIN || !env.TG_TOKEN || !env.OWNER_ID) return new Response('office not configured', { status: 503 });
  let data;
  try { data = await request.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
  if (!data || typeof data.pin !== 'string' || data.pin !== env.OFFICE_PIN) {
    return new Response('forbidden', { status: 403 });
  }
  const title = OFFICE_CMDS[data.cmd];
  if (!title) return new Response('unknown command', { status: 400 });
  const extra = typeof data.text === 'string' && data.cmd === 'text' ? '\n' + data.text.slice(0, 300) : '';
  const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit' });
  const res = await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.OWNER_ID, text: '🖥️ المكتب الافتراضي\n' + title + extra + '\n🕒 ' + time })
  });
  return new Response(res.ok ? 'ok' : 'telegram error', { status: res.ok ? 200 : 502 });
}
