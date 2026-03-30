require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
const ENV_FILE = path.join(__dirname, '.env');

// ── Genera VAPID keys al primer arranque si no existen ────────────────────────
function ensureVapidKeys() {
  const hasKeys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
  if (hasKeys) return;

  console.log('🔑 Generando VAPID keys por primera vez...');
  const keys = webpush.generateVAPIDKeys();

  const mailto = process.env.VAPID_MAILTO || 'mailto:admin@example.com';
  const envContent = [
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    `VAPID_MAILTO=${mailto}`,
    `PORT=${process.env.PORT || 3000}`,
  ].join('\n') + '\n';

  fs.writeFileSync(ENV_FILE, envContent);
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_MAILTO = mailto;
  console.log('✅ VAPID keys guardadas en .env');
}

ensureVapidKeys();

webpush.setVapidDetails(
  process.env.VAPID_MAILTO,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── Helpers de persistencia ───────────────────────────────────────────────────
function loadSubscriptions() {
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSubscriptions(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Devuelve la VAPID public key para que el frontend pueda suscribirse
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Guarda una nueva suscripción (evita duplicados por endpoint)
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }

  const subs = loadSubscriptions();
  const exists = subs.some((s) => s.endpoint === subscription.endpoint);

  if (!exists) {
    subs.push(subscription);
    saveSubscriptions(subs);
    console.log(`📥 Nueva suscripción. Total: ${subs.length}`);
  }

  res.status(201).json({ message: 'Suscripción registrada' });
});

// Envía una notificación push a todos los suscriptores
app.post('/api/notify', async (req, res) => {
  const {
    title = 'Notificación de prueba',
    body = 'Hola desde el servidor 👋',
    url = '/',
    icon = '/icon.png',
  } = req.body;

  const payload = JSON.stringify({ title, body, url, icon });
  let subs = loadSubscriptions();

  if (subs.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No hay suscriptores' });
  }

  const results = await Promise.allSettled(
    subs.map((sub) => webpush.sendNotification(sub, payload, { TTL: 60, urgency: 'high' }))
  );

  // Limpia suscripciones inválidas (410 Gone = el browser ya no las registra)
  const invalidEndpoints = new Set();
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const status = result.reason?.statusCode;
      if (status === 410 || status === 404) {
        invalidEndpoints.add(subs[i].endpoint);
        console.log(`🗑️  Suscripción expirada eliminada: ${subs[i].endpoint.slice(-30)}…`);
      } else {
        console.error(`❌ Error enviando push:`, result.reason?.message);
      }
    }
  });

  if (invalidEndpoints.size > 0) {
    subs = subs.filter((s) => !invalidEndpoints.has(s.endpoint));
    saveSubscriptions(subs);
  }

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`📤 Push enviado a ${sent}/${results.length} suscriptores`);
  res.json({ sent, total: results.length, removed: invalidEndpoints.size });
});

// ── Arranca el servidor ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🔑 VAPID public key: ${process.env.VAPID_PUBLIC_KEY?.slice(0, 20)}…\n`);
});
