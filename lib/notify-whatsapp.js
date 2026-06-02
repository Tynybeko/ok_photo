import { getCurrentPasswords } from './passwords.js';

/** Green API — https://green-api.com (поддерживает группы WhatsApp) */
async function sendGreenApi(chatId, message) {
  const id = process.env.GREEN_API_ID;
  const token = process.env.GREEN_API_TOKEN;
  if (!id || !token || !chatId) {
    return { ok: false, error: 'Green API не настроен' };
  }
  const url = `https://api.green-api.com/waInstance${id}/sendMessage/${token}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: data.message || r.statusText, chatId };
  return { ok: true, chatId, idMessage: data.idMessage };
}

/** CallMeBot — только на один номер (https://www.callmebot.com/blog/free-api-whatsapp-messages/) */
async function sendCallMeBot(phone, apikey, message) {
  if (!phone || !apikey) return { ok: false, error: 'CallMeBot не настроен' };
  const q = new URLSearchParams({
    phone,
    text: message,
    apikey,
  });
  const r = await fetch(`https://api.callmebot.com/whatsapp.php?${q}`);
  const text = await r.text();
  if (!r.ok || /ERROR/i.test(text)) return { ok: false, error: text || r.statusText };
  return { ok: true, phone };
}

function formatUntil(iso) {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

export async function sendPasswordNotifications({ force = false, lastPeriod = -1 } = {}) {
  const { view, admin, validUntil, period, rotationDays } = getCurrentPasswords();

  if (!force && lastPeriod === period) {
    return { skipped: true, period, reason: 'already_sent' };
  }

  const until = formatUntil(validUntil);
  const site = process.env.SITE_URL || '';

  const viewMsg =
    `📷 *Галерея OK.ru*\n\n` +
    `Пароль для *просмотра*:\n\`\`\`${view}\`\`\`\n\n` +
    `Действует до: ${until}\n` +
    `(меняется каждые ${rotationDays} дн.)` +
    (site ? `\n\n🔗 ${site}` : '');

  const adminMsg =
    `🔐 *Галерея — только для тебя*\n\n` +
    `Пароль *редактирования* (удаление, импорт):\n\`\`\`${admin}\`\`\`\n\n` +
    `Действует до: ${until}\n` +
    `⚠️ Никому не пересылай.` +
    (site ? `\n\n🔗 ${site}` : '');

  const results = [];

  const groupChat = process.env.WHATSAPP_GROUP_CHAT_ID;
  const adminChat = process.env.WHATSAPP_ADMIN_CHAT_ID;

  if (groupChat && process.env.GREEN_API_ID) {
    results.push({ target: 'group', ...(await sendGreenApi(groupChat, viewMsg)) });
  } else if (process.env.WHATSAPP_VIEW_PHONE && process.env.CALLMEBOT_VIEW_APIKEY) {
    results.push({
      target: 'view_phone',
      ...(await sendCallMeBot(
        process.env.WHATSAPP_VIEW_PHONE,
        process.env.CALLMEBOT_VIEW_APIKEY,
        viewMsg.replace(/\*/g, '').replace(/```/g, '')
      )),
    });
  }

  if (adminChat && process.env.GREEN_API_ID) {
    results.push({ target: 'admin', ...(await sendGreenApi(adminChat, adminMsg)) });
  } else if (process.env.WHATSAPP_ADMIN_PHONE && process.env.CALLMEBOT_ADMIN_APIKEY) {
    results.push({
      target: 'admin_phone',
      ...(await sendCallMeBot(
        process.env.WHATSAPP_ADMIN_PHONE,
        process.env.CALLMEBOT_ADMIN_APIKEY,
        adminMsg.replace(/\*/g, '').replace(/```/g, '')
      )),
    });
  }

  const anySent = results.some((r) => r.ok);
  const configured =
    (groupChat && process.env.GREEN_API_ID) ||
    (process.env.WHATSAPP_VIEW_PHONE && process.env.CALLMEBOT_VIEW_APIKEY) ||
    (adminChat && process.env.GREEN_API_ID) ||
    (process.env.WHATSAPP_ADMIN_PHONE && process.env.CALLMEBOT_ADMIN_APIKEY);

  if (!configured) {
    return {
      skipped: true,
      period,
      error: 'WhatsApp не настроен (GREEN_API или CallMeBot)',
      results,
    };
  }

  if (!anySent) {
    return { ok: false, period, results };
  }

  return { ok: true, period, results, view, admin, validUntil };
}
