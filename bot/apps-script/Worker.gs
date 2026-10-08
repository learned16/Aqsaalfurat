/**
 * ربط تلغرام بوسيط Cloudflare (رد فوري بدل السحب كل دقيقة).
 *
 *   useWorker()  — يوقف السحب (إذا كان شغّال) ويوجّه تلغرام للوسيط.
 *                  قبلها حط رابط الوسيط بـ Script Properties باسم WORKER_URL.
 */
function useWorker() {
  const url = prop_('WORKER_URL');
  if (!url) throw new Error('حط رابط الـ Worker بـ Script Properties باسم WORKER_URL');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollUpdates') ScriptApp.deleteTrigger(t);
  });
  const res = tg_('setWebhook', {
    url: url,
    secret_token: prop_('TG_SECRET'),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false
  });
  console.log(JSON.stringify(res));
  console.log('شغّل webhookInfo بعد دقيقة وتأكد إن last_error_message ما موجود.');
}
