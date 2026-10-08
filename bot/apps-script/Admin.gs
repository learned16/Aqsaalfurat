/**
 * لوحة صاحب البوت (OWNER_ID): أوامر تنكتب بالبوت مباشرة.
 *
 *   /admin            اللوحة: الموظفين والمدير والمراقبين والطابور
 *   /add 123          يضيف موظف
 *   /remove 123       يشيل موظف (ومن المراقبين إذا موجود)
 *   /manager 123      يغيّر المدير
 *   /watch 123        يضيف مراقب      /unwatch 123   يشيله
 *   /say نص           رسالة لكل الموظفين والمدير
 */

function setIdList_(name, ids) {
  setProp_(name, ids.filter(function (t, i, a) { return t && a.indexOf(t) === i; }).join(','));
}

function showAdmin_(user) {
  if (!isOwner_(user.id)) return showMenu_(user.chatId, '⛔ هذا لصاحب البوت بس.');
  const counts = {};
  listRequests_('').forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
  const queue = Object.keys(counts).map(function (k) { return k + ': ' + counts[k]; }).join(' · ') || 'فارغ';
  const staff = allowedIds_();
  showMenu_(user.chatId, [
    '👑 <b>لوحة صاحب البوت</b>',
    '👔 المدير: <code>' + escapeHtml_(prop_('MANAGER_ID') || 'غير محدد') + '</code>',
    '👥 الموظفين (' + staff.length + '): ' + (staff.map(function (s) { return '<code>' + s + '</code>'; }).join('، ') || 'لا يوجد'),
    '👁️ المراقبين: ' + (idList_('WATCH_IDS').map(function (s) { return '<code>' + s + '</code>'; }).join('، ') || 'بس إنت'),
    '📋 الطابور: ' + escapeHtml_(queue),
    '',
    '<b>الأوامر:</b>',
    '/add 123 — إضافة موظف',
    '/remove 123 — شيل موظف',
    '/manager 123 — تغيير المدير',
    '/watch 123 · /unwatch 123 — المراقبين',
    '/say نص — رسالة للكل'
  ].join('\n'));
}

/** يرجّع true إذا الرسالة أمر من أوامر صاحب البوت وانعالجت. */
function handleOwnerCommand_(user, text) {
  const m = text.match(/^\/(admin|add|remove|manager|watch|unwatch|say)(?:@\w+)?(?:\s+([\s\S]+))?$/);
  if (!m) return false;
  const cmd = m[1];
  const arg = (m[2] || '').trim();
  const id = arg.replace(/[^\d-]/g, '');

  if (cmd === 'admin') { showAdmin_(user); return true; }
  if (cmd === 'say') {
    if (!arg) { send_(user.chatId, 'اكتب الرسالة بعد الأمر: /say النص'); return true; }
    const targets = allowedIds_().concat([prop_('MANAGER_ID')])
      .filter(function (t, i, a) { return t && t !== user.id && a.indexOf(t) === i; });
    targets.forEach(function (t) { send_(t, '📢 ' + escapeHtml_(arg)); });
    send_(user.chatId, '📢 انرسلت لـ ' + targets.length + ' شخص.');
    return true;
  }
  if (!id) { send_(user.chatId, 'اكتب المعرّف بعد الأمر، مثال: /' + cmd + ' 123456789'); return true; }
  if (id === user.id) { send_(user.chatId, 'هذا معرّفك إنت، صلاحيتك أعلى من الكل أصلاً 👑'); return true; }

  switch (cmd) {
    case 'add':
      setIdList_('ALLOWED_IDS', allowedIds_().concat([id]));
      send_(user.chatId, '✅ انضاف الموظف <code>' + id + '</code>');
      send_(id, '✅ صار عندك وصول لبوت أقصى الفرات. اكتب /start');
      break;
    case 'remove':
      setIdList_('ALLOWED_IDS', allowedIds_().filter(function (x) { return x !== id; }));
      setIdList_('WATCH_IDS', idList_('WATCH_IDS').filter(function (x) { return x !== id; }));
      clearState_(id);
      send_(user.chatId, '🗑️ انشال <code>' + id + '</code>' +
        (id === prop_('MANAGER_ID') ? '\n⚠️ هذا المدير، وبعده مدير. غيّره بـ /manager' : ''));
      break;
    case 'manager':
      setProp_('MANAGER_ID', id);
      send_(user.chatId, '👔 صار المدير <code>' + id + '</code>');
      send_(id, '👔 صرت مدير ببوت أقصى الفرات: توصلك الطلبات وأزرار الطباعة. اكتب /start');
      break;
    case 'watch':
      setIdList_('WATCH_IDS', idList_('WATCH_IDS').concat([id]));
      send_(user.chatId, '👁️ صار مراقب <code>' + id + '</code>');
      break;
    case 'unwatch':
      setIdList_('WATCH_IDS', idList_('WATCH_IDS').filter(function (x) { return x !== id; }));
      send_(user.chatId, '👁️ انشال من المراقبين <code>' + id + '</code>');
      break;
  }
  return true;
}
