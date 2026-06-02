const OKCDN_RE =
  /https?:\/\/(?:vki3|i|pimg|dp)\.okcdn\.ru\/i\?r=[A-Za-z0-9_-]+(?:&[^"'\\s<>]*)?/gi;
const OKCDN_URL_RE =
  /^https?:\/\/(?:vki3|i|pimg|dp)\.okcdn\.ru\/i\?r=[A-Za-z0-9_-]+/i;
const SKIP = ['/static/', '/res/assets/', 'holder_', 'ico_', 'pixel/'];

export function isOkPhotoUrl(url) {
  if (!url || SKIP.some((p) => url.includes(p))) return false;
  const clean = url.split('"')[0].split("'")[0];
  return OKCDN_URL_RE.test(clean);
}

function bestQualityUrl(url) {
  const clean = url.split('"')[0].split("'")[0];
  if (!clean.includes('dpr=')) {
    return clean + (clean.includes('?') ? '&' : '?') + 'dpr=2';
  }
  return clean;
}

export function normalizeProfileUrl(url) {
  let u = url.trim();
  if (!u) throw new Error('Пустая ссылка');
  if (!u.startsWith('http')) u = 'https://' + u;
  const parsed = new URL(u);
  if (!parsed.hostname.includes('ok.ru') && !parsed.hostname.includes('odnoklassniki.ru')) {
    throw new Error('Ссылка должна быть с ok.ru');
  }
  const m = parsed.pathname.match(/\/profile\/([^/]+)(?:\/photos)?/i);
  if (m) {
    const id = m[1];
    return { photosUrl: `https://ok.ru/profile/${id}/photos`, profileId: id };
  }
  throw new Error('Пример: https://ok.ru/profile/123456789/photos');
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function extractPhotoUrls(html) {
  const text = decodeHtml(html);
  const seen = new Set();
  const out = [];
  for (const raw of text.match(OKCDN_RE) || []) {
    if (SKIP.some((p) => raw.includes(p))) continue;
    let url = raw.split('"')[0].split("'")[0];
    if (!url.startsWith('http')) url = 'https:' + url.replace(/^\/\//, '//');
    if (!url.includes('dpr=')) url += (url.includes('?') ? '&' : '?') + 'dpr=2';
    const key = url.split('&')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function extractFriendId(html, fallback) {
  const m =
    html.match(/st-prm_friendId["']?\s*[:=]\s*["']?(\d+)/) ||
    html.match(/st\.friendId=(\d+)/) ||
    html.match(/\/profile\/(\d+)/);
  return m ? m[1] : fallback;
}

export async function collectProfileUrls(profileUrl, cookiesHeader) {
  const { photosUrl, profileId } = normalizeProfileUrl(profileUrl);
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
  };
  if (cookiesHeader) headers.Cookie = cookiesHeader;

  const fetchHtml = async (url) => {
    const r = await fetch(url, { headers, redirect: 'follow' });
    if (!r.ok) throw new Error(`OK.ru ответил ${r.status}`);
    return r.text();
  };

  const html = await fetchHtml(photosUrl);
  const friendId = extractFriendId(html, profileId);
  const all = [];
  const seen = new Set();
  const add = (pageHtml) => {
    let n = 0;
    for (const u of extractPhotoUrls(pageHtml)) {
      const k = u.split('&')[0];
      if (!seen.has(k)) {
        seen.add(k);
        all.push(u);
        n++;
      }
    }
    return n;
  };

  add(html);
  for (let fp = 1; fp < 25; fp++) {
    const pageUrl = `https://ok.ru/dk?st.cmd=anonymFriendPhotos&st.friendId=${friendId}&st.layer.lg.ftid=0&st.layer.lg.fp=${fp}&st._aid=FriendPhotoStream_Photos_Over`;
    try {
      const chunk = await fetchHtml(pageUrl);
      if (add(chunk) === 0) break;
    } catch {
      break;
    }
  }
  return all;
}

export function parseHar(harBytes) {
  const har = JSON.parse(new TextDecoder().decode(harBytes));
  const entries = har?.log?.entries || [];
  const items = [];
  const urlsOnly = new Set();
  const seenBody = new Set();

  for (const entry of entries) {
    const url = bestQualityUrl(entry?.request?.url || '');
    if (!isOkPhotoUrl(url)) continue;

    const content = entry?.response?.content || {};
    const text = content.text;
    const mime = (content.mimeType || 'image/webp').split(';')[0];

    if (text && mime.startsWith('image/')) {
      const raw =
        content.encoding === 'base64'
          ? Buffer.from(text, 'base64')
          : Buffer.from(text, 'latin1');
      if (raw.length >= 500) {
        const key = url.split('&')[0];
        if (!seenBody.has(key)) {
          seenBody.add(key);
          items.push({ url, mime, data: raw });
        }
        continue;
      }
    }

    urlsOnly.add(url.split('&')[0]);
  }

  for (const key of seenBody) urlsOnly.delete(key);

  return { items, urlsOnly: [...urlsOnly].map((k) => bestQualityUrl(k)) };
}

export function nextImportName(manifest, ext) {
  let max = 0;
  for (const it of manifest) {
    const m = String(it.id).match(/^imp_(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `imp_${String(max + 1).padStart(4, '0')}${ext}`;
}
