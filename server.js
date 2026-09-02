const express = require('express');
const https = require('https');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PROXY_SECRET = process.env.PROXY_SECRET;
const CERT = process.env.SICREDI_CERT_PEM.replace(/\\n/g, '\n');
const KEY = process.env.SICREDI_KEY_PEM.replace(/\\n/g, '\n');
const SICREDI_HOST = 'mtls-api-parceiro.sicredi.com.br';
const FORWARD_HEADERS = new Set([
  'authorization',
  'content-type',
  'accept',
  'x-cooperativa',
  'x-conta',
  'x-documento',
]);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res, next) => {
  if (req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.all('/proxy/*', async (req, res) => {
  const targetPath = req.params[0];
  const targetUrl = `https://${SICREDI_HOST}/${targetPath}`;

  const headers = { host: SICREDI_HOST };
  for (const [k, v] of Object.entries(req.headers)) {
    if (FORWARD_HEADERS.has(k.toLowerCase()) && typeof v === 'string') {
      headers[k.toLowerCase()] = v;
    }
  }

  const options = {
    method: req.method,
    cert: CERT,
    key: KEY,
    headers,
  };

  try {
    const proxyReq = https.request(targetUrl, options, (proxyRes) => {
      res.status(proxyRes.statusCode);
      Object.entries(proxyRes.headers).forEach(([k, v]) => {
        if (k.toLowerCase() === 'transfer-encoding') return;
        res.setHeader(k, v);
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message);
      res.status(502).json({ error: 'Proxy error', detail: err.message });
    });

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const body = req.headers['content-type']?.includes('application/x-www-form-urlencoded')
        ? new URLSearchParams(req.body).toString()
        : JSON.stringify(req.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(body));
      proxyReq.write(body);
    }

    proxyReq.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log(`Sicredi mTLS proxy running on port ${PORT}`));
