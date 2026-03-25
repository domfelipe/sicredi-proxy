const express = require('express');
const https = require('https');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PROXY_SECRET = process.env.PROXY_SECRET;
const CERT = process.env.SICREDI_CERT_PEM.replace(/\\n/g, '\n');
const KEY = process.env.SICREDI_KEY_PEM.replace(/\\n/g, '\n');

// Middleware de autenticação
app.use((req, res, next) => {
  if (req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy genérico - encaminha qualquer request para o Sicredi com mTLS
app.all('/proxy/*', async (req, res) => {
  const targetPath = req.params[0]; // tudo depois de /proxy/
  const targetUrl = `https://mtls-api-parceiro.sicredi.com.br/${targetPath}`;

  const options = {
    method: req.method,
    cert: CERT,
    key: KEY,
    headers: { ...req.headers },
  };

  // Remove headers que não devem ir pro Sicredi
  delete options.headers['host'];
  delete options.headers['x-proxy-secret'];
  delete options.headers['content-length'];

  try {
    const proxyReq = https.request(targetUrl, options, (proxyRes) => {
      res.status(proxyRes.statusCode);
      Object.entries(proxyRes.headers).forEach(([k, v]) => res.setHeader(k, v));
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
