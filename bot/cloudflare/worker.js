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
 *   OFFICE_KV   ربط KV namespace (Bindings) — طابور أوامر برنامج اللابتوب
 *
 * برنامج اللابتوب (bot/laptop) يسأل كل كم ثانية:
 *   GET  /office/poll    يرجّع الأوامر الجديدة ويفرّغ الطابور (هيدر X-Office-Pin)
 *   POST /office/done    نتيجة أمر، تنرسل لصاحب البوت بتلغرام
 *   GET  /office/status  آخر مرة اللابتوب سأل (للمكتب حتى يبين متصل لو لا)
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
  sleep: '🌙 نوّم اللابتوب',
  lock: '🔒 اقفل الشاشة',
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
    if (url.pathname === '/office/cmd') return officeCommand(request, env);
    if (url.pathname === '/office/poll') return officePoll(request, env, url);
    if (url.pathname === '/office/done') return officeDone(request, env);
    if (url.pathname === '/office/status') return officeStatus(request, env);
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
  // الأمر يروح لطابور اللابتوب (إذا KV مربوط) ورسالة تلغرام بنفس الوقت
  if (env.OFFICE_KV && data.cmd !== 'wake') {
    const q = JSON.parse((await env.OFFICE_KV.get('queue')) || '[]');
    q.push({ id: Date.now().toString(36), cmd: data.cmd, text: data.cmd === 'text' ? String(data.text || '').slice(0, 300) : '' });
    await env.OFFICE_KV.put('queue', JSON.stringify(q.slice(-20)));
  }
  const ok = await tellOwner(env, '🖥️ المكتب الافتراضي\n' + title + extra + '\n🕒 ' + time);
  return new Response(ok ? 'ok' : 'telegram error', { status: ok ? 200 : 502 });
}

function pinOk(request, env) {
  return !!env.OFFICE_PIN && request.headers.get('X-Office-Pin') === env.OFFICE_PIN;
}

async function tellOwner(env, text) {
  const res = await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.OWNER_ID, text })
  });
  return res.ok;
}

const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function officePoll(request, env, url) {
  if (!pinOk(request, env)) return new Response('forbidden', { status: 403 });
  if (!env.OFFICE_KV) return new Response('OFFICE_KV not bound', { status: 503 });
  // الكتابة بـ KV محدودة (1000 باليوم ببلاش)، فنكتب بس إذا اكو أوامر أو نبضة (كل 3 دقايق)
  const raw = await env.OFFICE_KV.get('queue');
  const cmds = JSON.parse(raw || '[]');
  if (cmds.length) await env.OFFICE_KV.put('queue', '[]');
  if (url.searchParams.get('beat') === '1') await env.OFFICE_KV.put('seen', String(Date.now()));
  return json({ cmds });
}

async function officeDone(request, env) {
  if (request.method !== 'POST' || !pinOk(request, env)) return new Response('forbidden', { status: 403 });
  let data;
  try { data = await request.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
  const text = String((data && data.text) || '').slice(0, 500);
  if (!text) return new Response('empty', { status: 400 });
  const ok = await tellOwner(env, '💻 اللابتوب\n' + text);
  return new Response(ok ? 'ok' : 'telegram error', { status: ok ? 200 : 502 });
}

async function officeStatus(request, env) {
  if (!pinOk(request, env)) return new Response('forbidden', { status: 403 });
  const seen = env.OFFICE_KV ? Number((await env.OFFICE_KV.get('seen')) || 0) : 0;
  return json({ seen, now: Date.now(), kv: !!env.OFFICE_KV });
}
