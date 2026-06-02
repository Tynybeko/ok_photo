export default async function handler(req, res) {
  const cookies = process.env.OK_COOKIES || '';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    ok: true,
    has_blob_token: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    has_blob_store: Boolean(process.env.BLOB_STORE_ID),
    has_ok_cookies: cookies.length > 50,
    ok_cookies_length: cookies.length,
    has_jsession: /JSESSIONID=/i.test(cookies),
    has_authcode: /AUTHCODE=/i.test(cookies),
    hint: cookies.length < 50
      ? 'OK_COOKIES не задан. Vercel → Settings → Environment Variables → OK_COOKIES (не BLOB_OK_COOKIES)'
      : undefined,
  });
}
