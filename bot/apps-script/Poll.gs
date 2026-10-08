/**
 * وضع السحب: البوت يسحب الرسائل من تلغرام كل دقيقة بدل الـ webhook.
 * السبب: رابط Apps Script يرد على تلغرام بتحويل 302، وتلغرام يعتبره فشل ويوقف التسليم.
 *
 *   startPolling()  — يلغي الـ webhook ويشغّل السحب كل دقيقة (شغّلها مرة وحدة)
 *   stopPolling()   — يوقف السحب
 */

function startPolling() {
  tg_('deleteWebhook', { drop_pending_updates: false });
  stopPolling();
  ScriptApp.newTrigger('pollUpdates').timeBased().everyMinutes(1).create();
  pollUpdates();
  console.log('السحب اشتغل: البوت يفحص الرسائل كل دقيقة.');
}

function stopPolling() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollUpdates') ScriptApp.deleteTrigger(t);
  });
}

function pollUpdates() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // سحب ثاني شغّال هسة
  try {
    // سحب سريع مرة وحدة بالدقيقة (بدون انتظار)، حتى ما نتجاوز حد Google اليومي لوقت المشغّلات
    const offset = Number(prop_('TG_OFFSET') || '0');
    const res = tg_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    if (!res.ok) return;
    res.result.forEach(function (u) {
      setProp_('TG_OFFSET', u.update_id + 1);
      if (isDuplicate_(u.update_id)) return;
      try {
        handleUpdate_(u);
      } catch (err) {
        console.error(err);
        const chatId = (u.message && u.message.chat.id) || (u.callback_query && u.callback_query.message.chat.id);
        if (chatId) send_(chatId, '⚠️ صار خطأ: ' + escapeHtml_(err.message || err) + '\nجرّب مرة ثانية أو اكتب /start');
      }
    });
  } finally {
    lock.releaseLock();
  }
}
