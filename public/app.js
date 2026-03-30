// ── Helpers ───────────────────────────────────────────────────────────────────

// Convierte una VAPID public key en base64url a Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function setStatus(msg, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = `status ${type}`;
}

function setSubscribed(subscribed) {
  document.getElementById('btn-subscribe').style.display = subscribed ? 'none' : 'inline-block';
  document.getElementById('btn-unsubscribe').style.display = subscribed ? 'inline-block' : 'none';
  document.getElementById('notify-section').style.display = subscribed ? 'block' : 'none';
}

// ── Registro del Service Worker ───────────────────────────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    setStatus('❌ Tu navegador no soporta Service Workers', 'error');
    return null;
  }
  if (!('PushManager' in window)) {
    setStatus('❌ Tu navegador no soporta Web Push', 'error');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    console.log('SW registrado:', reg.scope);
    return reg;
  } catch (err) {
    setStatus(`❌ Error registrando SW: ${err.message}`, 'error');
    return null;
  }
}

// ── Suscripción ───────────────────────────────────────────────────────────────
async function subscribe() {
  try {
    setStatus('⏳ Solicitando permiso…', 'info');

    const permission = await Notification.requestPermission();
    console.log('Permiso:', permission);
    if (permission !== 'granted') {
      setStatus('❌ Permiso denegado. Habilitá las notificaciones en tu navegador.', 'error');
      return;
    }

    setStatus('⏳ Registrando suscripción push…', 'info');
    const reg = await navigator.serviceWorker.ready;
    console.log('SW ready:', reg.scope);

    // Obtiene la VAPID public key del servidor
    const res = await fetch('/api/vapid-public-key');
    const { publicKey } = await res.json();
    console.log('VAPID key obtenida:', publicKey.slice(0, 20) + '…');

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    console.log('Push subscription creada:', subscription.endpoint.slice(-30));

    // Envía la suscripción al servidor
    const saveRes = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    const saveData = await saveRes.json();
    console.log('Respuesta del servidor:', saveData);

    localStorage.setItem('push-subscribed', '1');
    setStatus('✅ Suscripto correctamente. Ya podés enviar notificaciones.', 'success');
    setSubscribed(true);
  } catch (err) {
    console.error('Error en subscribe():', err);
    setStatus(`❌ Error al suscribirse: ${err.message}`, 'error');
  }
}

// ── Desuscripción ─────────────────────────────────────────────────────────────
async function unsubscribe() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  localStorage.removeItem('push-subscribed');
  setStatus('ℹ️ Desuscripto. Podés volver a suscribirte cuando quieras.', 'info');
  setSubscribed(false);
}

// ── Envío de push de prueba ───────────────────────────────────────────────────
async function sendTestPush() {
  const title = document.getElementById('push-title').value.trim() || 'Notificación de prueba';
  const body = document.getElementById('push-body').value.trim() || 'Hola desde el servidor 👋';
  const url = document.getElementById('push-url').value.trim() || '/';

  const btn = document.getElementById('btn-send');
  btn.disabled = true;
  btn.textContent = 'Enviando…';

  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, url }),
    });
    const data = await res.json();
    setStatus(`📤 Enviado a ${data.sent} suscriptor(es).`, 'success');
  } catch (err) {
    setStatus(`❌ Error al enviar: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar notificación';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await registerSW();

  // Verifica si ya está suscripto
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    setSubscribed(true);
    setStatus('✅ Ya estás suscripto.', 'success');
  } else {
    setSubscribed(false);
    setStatus('Hacé click en "Activar notificaciones" para comenzar.', 'info');
  }

  document.getElementById('btn-subscribe').addEventListener('click', subscribe);
  document.getElementById('btn-unsubscribe').addEventListener('click', unsubscribe);
  document.getElementById('btn-send').addEventListener('click', sendTestPush);
})();
