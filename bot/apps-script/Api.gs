/**
 * الأوامر اللي يستعملها Claude (عن طريق bridge.py) — كلها تحتاج API_KEY.
 *
 *   list     {status?}                       → الطلبات (افتراضياً الجديدة)
 *   files    {id}                            → ملفات مجلد "مرفقات" للطلب
 *   update   {id, status, note?, notify?}    → يغيّر الحالة، ويبلّغ مقدم الطلب إذا notify
 *   upload   {id, name, mime, b64}           → يحفظ ملف نتيجة بمجلد "النتائج"
 *   deliver  {id, message, to_manager?}      → يرسل ملفات النتائج لمقدم الطلب، وللمدير بأزرار الطباعة
 *   notify   {target, text}                  → رسالة: "manager" أو "all" أو chat_id
 *   tenders_sync {tenders, brief?, push?}    → يحدّث قائمة المناقصات اليومية، وpush = "manager" أو "all" يرسل النشرة
 *   tenders_list {}                          → قائمة المناقصات بالجدول
 */
function handleApi_(d) {
  switch (d.action) {
    case 'list':
      return { requests: listRequests_(d.status === undefined ? STATUS.NEW : d.status) };

    case 'files': {
      const req = mustFind_(d.id);
      const folder = DriveApp.getFolderById(req.folder_id).getFoldersByName('مرفقات').next();
      const out = [];
      const it = folder.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        out.push({ id: f.getId(), name: f.getName(), mime: f.getMimeType(), size: f.getSize(), url: f.getUrl() });
      }
      return { request: req, files: out };
    }

    case 'update': {
      const req = updateStatus_(d.id, d.status, d.note);
      if (d.notify) send_(req.chat_id, 'ℹ️ ' + d.id + ': ' + escapeHtml_(d.status) + (d.note ? '\n' + escapeHtml_(d.note) : ''));
      return { request: req };
    }

    case 'upload': {
      const req = mustFind_(d.id);
      const blob = Utilities.newBlob(Utilities.base64Decode(d.b64), d.mime || 'application/octet-stream', d.name);
      const file = DriveApp.getFolderById(req.results_folder_id).createFile(blob);
      return { file_id: file.getId(), url: file.getUrl() };
    }

    case 'deliver': {
      const req = mustFind_(d.id);
      const it = DriveApp.getFolderById(req.results_folder_id).getFiles();
      const ids = [];
      while (it.hasNext()) ids.push(it.next().getId());
      if (!ids.length) throw new Error('ماكو ملفات بمجلد النتائج');

      send_(req.chat_id, '📦 <b>' + req.id + '</b> جاهز\n' + escapeHtml_(d.message || ''));
      ids.forEach(function (id) { sendDriveFile_(req.chat_id, id); });

      const mgr = prop_('MANAGER_ID');
      if (d.to_manager && mgr) {
        if (mgr !== req.chat_id) ids.forEach(function (id) { sendDriveFile_(mgr, id); });
        send_(mgr, '👆 <b>' + req.id + '</b> ' + escapeHtml_(req.type + ' ' + (req.company || '') + ' ' + (req.number || '')) +
          '\n' + escapeHtml_(d.message || '') + '\nإذا عاجبك دوس اطبعه.',
          [[btn_('✅ اطبعه', 'mgr:ok:' + req.id), btn_('↩️ رجّعه للتعديل', 'mgr:no:' + req.id)]]);
        // صاحب البوت يستلم نفس الملفات والأزرار
        const owner = prop_('OWNER_ID');
        if (owner && owner !== mgr && owner !== req.chat_id) {
          ids.forEach(function (id) { sendDriveFile_(owner, id); });
          send_(owner, '👑 نسخة لك: <b>' + req.id + '</b> بانتظار موافقة المدير.\n' + escapeHtml_(d.message || ''),
            [[btn_('✅ اطبعه', 'mgr:ok:' + req.id), btn_('↩️ رجّعه للتعديل', 'mgr:no:' + req.id)]]);
        }
        updateStatus_(req.id, STATUS.WAITING_MANAGER, '');
      } else {
        updateStatus_(req.id, STATUS.READY, '');
      }
      return { sent: ids.length };
    }

    case 'notify': {
      let targets;
      if (d.target === 'manager') targets = [prop_('MANAGER_ID')];
      else if (d.target === 'all') targets = allowedIds_().concat([prop_('MANAGER_ID')]);
      else targets = [String(d.target)];
      targets = targets.filter(function (t, i, a) { return t && a.indexOf(t) === i; });
      targets.forEach(function (t) { send_(t, d.text); });
      return { sent: targets.length };
    }

    case 'tenders_sync': {
      const res = syncTenders_(d.tenders || []);
      if (d.brief) setProp_('LAST_BRIEF', JSON.stringify(d.brief));
      if (d.push) res.pushed = pushBrief_(d.push);
      return res;
    }

    case 'tenders_list':
      return { tenders: listTenders_() };

    default:
      throw new Error('أمر غير معروف: ' + d.action);
  }
}

function mustFind_(id) {
  const found = findRequest_(id);
  if (!found) throw new Error('الطلب غير موجود: ' + id);
  return found.req;
}
