const http = require('http');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Carrega .env se disponível
try {
  require('dotenv').config();
} catch (e) {
  console.warn('[backend] dotenv não carregado:', e.message);
}


const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'DEMO_WEBHOOK_SECRET_CHANGE_ME';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'DEMO_ADMIN_API_KEY_CHANGE_ME';

// Mercado Pago
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';

// Identificação interna (não é necessariamente usada no PIX, mas pode ajudar em auditoria)
const DONO_MERCADO_PAGO_CONTA = process.env.DONO_MERCADO_PAGO_CONTA || '';

const PIX_CHAVE = process.env.PIX_CHAVE || '5511942129432';
const PIX_NOME = process.env.PIX_NOME || 'LUCY MODAS';
const PIX_CIDADE = process.env.PIX_CIDADE || 'SAO PAULO';
const PAGAMENTO_VALIDADE_MS = 24 * 60 * 60 * 1000;

const baseDir = path.join(__dirname, 'data');
const dbFile = path.join(baseDir, 'db.json');

function ensureDb() {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify({ orders: [], payments: [] }, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-admin-api-key,x-webhook-secret',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) raw = '';
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function safeString(v) {
  return String(v ?? '').trim();
}

function normalizeEmail(email) {
  return safeString(email).toLowerCase();
}

function newId(len = 10) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function gerarCodigoPagamento() {
  const n = Math.floor(10000000 + Math.random() * 90000000);
  return `LM${n}`;
}

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

function gerarPixPayload(chave, nomeBeneficiario, cidade, valor, txidRef) {
  const chaveLimpa = String(chave).replace(/\D/g, '');
  const nomeLimpo = nomeBeneficiario
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .substring(0, 25);
  const cidadeLimpa = cidade
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .substring(0, 15);
  const valorStr = Number(valor).toFixed(2);
  const txid = String(txidRef || 'LM' + newId(8))
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 25);

  function emv(id, value) {
    return id + String(value.length).padStart(2, '0') + value;
  }

  const pixKey = emv('01', chaveLimpa);
  const merchant = emv('26', emv('00', 'BR.GOV.BCB.PIX') + pixKey);
  const semCrc =
    emv('00', '01') +
    emv('01', '12') +
    merchant +
    emv('52', '0000') +
    emv('53', '986') +
    emv('54', valorStr) +
    emv('58', 'BR') +
    emv('59', nomeLimpo) +
    emv('60', cidadeLimpa) +
    emv('62', emv('05', txid)) +
    '6304';
  return semCrc + crc16(semCrc);
}

function requireAdmin(req, res) {
  const key = req.headers['x-admin-api-key'];
  if (!key || key !== ADMIN_API_KEY) {
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

function orderExpired(order) {
  if (!order?.expiresAt) return false;
  return Date.now() > Number(order.expiresAt);
}

function markOrderPaid(db, order, raw = {}) {
  if (order.status === 'PAID') return order;

  order.status = 'PAID';
  order.paidAt = new Date().toISOString();

  db.payments.push({
    id: newId(12),
    createdAt: new Date().toISOString(),
    orderId: order.id,
    paymentCode: order.paymentCode,
    txid: order.txid,
    status: 'PAID',
    raw
  });

  writeDb(db);

  return order;
}

// =====================================================
// Firestore (para o painel detectar PAID automaticamente)
// =====================================================

let firestoreOk = false;
let firestore = null;

function initFirestore() {
  try {
    // Lazy require: evita quebrar caso dependência não esteja instalada
    const admin = require('firebase-admin');

    // Se você já usa Firestore no front, ainda assim o backend precisa do admin SDK.
    // Vamos preferir FIREBASE_SERVICE_ACCOUNT (JSON) via env.
    const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saRaw) {
      console.warn('[backend] FIREBASE_SERVICE_ACCOUNT_JSON não configurado; webhook não vai atualizar Firestore');
      return false;
    }

    const serviceAccount = JSON.parse(saRaw);

    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }

    firestore = admin.firestore();
    firestoreOk = true;
    return true;
  } catch (e) {
    console.warn('[backend] Firestore init falhou:', e.message);
    return false;
  }
}

initFirestore();

async function syncPaidToFirestore(order) {
  // Não muda o front/admin sem necessidade: se Firestore não estiver configurado, só mantemos db.json.
  if (!firestoreOk || !firestore) return false;
  if (!order?.id) return false;

  try {
    await firestore.collection('pedidos').doc(order.id).set(
      {
        status: 'PAID',
        paidAt: order.paidAt || new Date().toISOString(),
        paymentCode: order.paymentCode,
        txid: order.txid,
        // campos de endereço/cliente (se existirem no db)
        cliente: order.cliente || null,
        email: order.email || null,
        telefone: order.telefone || null,
        endereco: order.endereco || null,
        numeroCasa: order.numeroCasa || null,
        bairro: order.bairro || null,
        cidade: order.cidade || null,
        estado: order.estado || null,
        cep: order.cep || null
      },
      { merge: true }
    );

    return true;
  } catch (e) {
    console.warn('[backend] syncPaidToFirestore falhou:', e.message);
    return false;
  }
}



// =====================================================
// Mercado Pago (PIX)
// =====================================================

async function criarCobrancaMercadoPagoPix({ valor, orderId, description, forcePixQrStatic }) {
  // Se o usuário quiser QR estático via imagem/pix fixo, não vamos aqui.
  // Para cobrança dinâmica (valor do pedido), usamos o Mercado Pago.
  if (!MERCADO_PAGO_ACCESS_TOKEN) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado no backend/.env');
  }

  const url = 'https://api.mercadopago.com/v1/payments';

  const body = {
    transaction_amount: Number(valor),
    description: description || 'Pedido Lucy Modas',
    external_reference: String(orderId),
    payment_method_id: 'pix',
    // Em muitas contas/configs o Mercado Pago aceita token: 'PIX'.
    // Mantemos para compatibilidade com o seu projeto.
    token: 'PIX'
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();
  if (!resp.ok) {
    const msg = data?.message || data?.error || 'Falha ao criar cobrança PIX';
    throw new Error(msg);
  }

  const qr = data?.point_of_interaction?.transaction_data || {};

  return {
    mpPaymentId: data.id,
    status: data.status,
    qrCode: qr?.qr_code || qr?.qr_code_base64 || '',
    pixCopiaCola: qr?.copy_paste || qr?.copia_e_cola || qr?.digitable_line || ''
  };
}

function normalizeDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

async function consultarStatusPagamentoMercadoPago(mpPaymentId) {
  if (!MERCADO_PAGO_ACCESS_TOKEN) return null;
  if (!mpPaymentId) return null;

  // Busca pagamento pela API
  const resp = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(mpPaymentId)}`, {
    headers: {
      Authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`
    }
  });

  const data = await resp.json();
  if (!resp.ok) {
    return null;
  }

  const status = safeString(data?.status).toUpperCase();

  // Normalizamos alguns status comuns.
  const paid =
    status.includes('APPROVED') ||
    status.includes('PAID') ||
    status.includes('CONFIRMED') ||
    status.includes('AUTHORIZED') ||
    data?.status_detail?.toUpperCase?.().includes('PAID');

  return { paid, status, raw: data };
}


async function marcarComoPagoPorWebhookMP({ orderId, mpPaymentId, status }) {
  // Aqui marcamos no db.json. O front e admin dependem do Firestore ou local.
  // Como este backend hoje não atualiza Firestore diretamente, mantemos o padrão do projeto:
  // o front monitora por Firestore. Para integrar full, também precisaríamos atualizar Firestore no webhook.
  // Como não foi implementado ainda, vamos atualizar apenas no backend e local.
  return true;
}

const server = http.createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const pathname = url.parse(req.url).pathname || '/';

  if (method === 'OPTIONS') {
    return json(res, 204, { ok: true });
  }

  if (method === 'GET' && pathname === '/health') {
    return json(res, 200, { ok: true, service: 'lucy-modas-backend' });
  }

  if (method === 'POST' && pathname === '/api/orders') {
    const body = await readBody(req);
    const valor = Number(body.valor || 0);
    if (!(valor > 0)) {
      return json(res, 400, { ok: false, error: 'Valor inválido' });
    }

    // cria order interna
    const order = {
      id: newId(10),
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + PAGAMENTO_VALIDADE_MS,
      status: 'PENDING',

      // manter compatibilidade com o admin/front existente
      paymentCode: gerarCodigoPagamento(),
      txid: gerarCodigoPagamento(),
      pixCopiaCola: '',

      cliente: safeString(body.cliente),
      email: normalizeEmail(body.email),
      telefone: safeString(body.telefone),
      endereco: safeString(body.endereco),
      numeroCasa: safeString(body.numeroCasa),
      bairro: safeString(body.bairro),
      cidade: safeString(body.cidade),
      estado: safeString(body.estado),
      cep: safeString(body.cep),
      itens: body.itens ?? [],
      valor
    };

  // Cobrança dinâmica PIX via Mercado Pago
    // Se der erro, fallback para EMV local (para não quebrar o site)
    try {
      const mp = await criarCobrancaMercadoPagoPix({
        valor,
        orderId: order.id,
        description: `Pedido Lucy Modas - ${order.id}`
      });

      order.mpPaymentId = mp.mpPaymentId;
      order.mpPixStatus = mp.status;
      // pix copia/cola que o cliente usa para pagar (e que deve ficar consistente)
      order.pixCopiaCola = mp.pixCopiaCola || '';

      // IMPORTANTE:
      // - Seu admin (admin.js) espera confirmar com "codigo" do input.
      // - Esse "codigo" geralmente é o COPIA E COLA/EMV.
      // Então não é ideal tentar validar diretamente contra mpPaymentId.
      // Mantemos paymentCode como EMV gerado localmente (EMV inválido no seu caso)
      // -> melhor: setar paymentCode como txid/txid esperado no EMV.
      // Aqui vamos manter paymentCode como a txid que está embutida no EMV.
      // Para isso, geramos um EMV local SOMENTE para extrair txid/pattern e manter compatibilidade do admin.
      const txid = order.txid.replace(/[^a-zA-Z0-9]/g, '').substring(0, 25);
      order.txid = txid;
      order.paymentCode = 'LM' + txid; // fallback: usado apenas como "token" alternativo

      // Se o mp retornou pixCopiaCola, mantemos ela para o cliente pagar.
      // Se o mp falhar (ou se o admin precisar), o txid embutido ajuda a bater códigos.
      if (!order.pixCopiaCola) {
        order.pixCopiaCola = gerarPixPayload(PIX_CHAVE, PIX_NOME, PIX_CIDADE, valor, txid);
      }
    } catch (e) {
      // fallback EMV local
      const txid = order.txid.replace(/[^a-zA-Z0-9]/g, '').substring(0, 25);
      const pixCopiaCola = gerarPixPayload(PIX_CHAVE, PIX_NOME, PIX_CIDADE, valor, txid);
      order.pixCopiaCola = pixCopiaCola;
      order.txid = txid;
      order.paymentCode = 'LM' + txid;
    }


    const db = readDb();
    db.orders.push(order);
    writeDb(db);

    return json(res, 200, {
      ok: true,
      order: {
        id: order.id,
        status: order.status,
        paymentCode: order.paymentCode,
        pixCopiaCola: order.pixCopiaCola,
        valor: order.valor,
        expiresAt: order.expiresAt,
        txid: order.txid,
        mpPaymentId: order.mpPaymentId || null
      }
    });
  }

  const statusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (method === 'GET' && statusMatch) {
    // se a ordem tiver mpPaymentId, tenta consultar status no Mercado Pago
    // e marca como PAID quando confirmado.
    const db = readDb();
    const order = db.orders.find((o) => o.id === statusMatch[1]);
    if (order && order.mpPaymentId && order.status === 'PENDING' && !orderExpired(order)) {
      try {
        const st = await consultarStatusPagamentoMercadoPago(order.mpPaymentId);
        if (st?.paid) {
          markOrderPaid(db, order, { method: 'mp_poll', mpPaymentId: order.mpPaymentId, status: st.status });
          await syncPaidToFirestore(order);
        }
      } catch (e) {
        // ignore falha de consulta
      }
    }

    const db2 = readDb();
    const order2 = db2.orders.find((o) => o.id === statusMatch[1]);
    if (!order2) return json(res, 404, { ok: false, error: 'Pedido não encontrado' });
    if (orderExpired(order2) && order2.status === 'PENDING') {
      order2.status = 'EXPIRED';
      writeDb(db2);
    }

    return json(res, 200, {
      ok: true,
      order: {
        id: order2.id,
        status: order2.status,
        paymentCode: order2.paymentCode,
        valor: order2.valor,
        expiresAt: order2.expiresAt,
        paidAt: order2.paidAt || null
      }
    });
  }


  if (method === 'POST' && pathname === '/api/payments/confirm-by-code') {
    const body = await readBody(req);
    const orderId = safeString(body.orderId);
    const codigoRaw = safeString(body.codigo);
    const codigo = String(codigoRaw || '').toUpperCase();

    if (!orderId || !codigo) {
      return json(res, 400, { ok: false, error: 'orderId e codigo obrigatórios' });
    }

    const db = readDb();
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) return json(res, 404, { ok: false, error: 'Pedido não encontrado' });
    if (orderExpired(order)) return json(res, 400, { ok: false, error: 'Pagamento expirado (24h)' });

    // Suporta 3 tipos de entrada no admin:
    // 1) paymentCode (ex: LM123...)
    // 2) Cópia e cola/EMV (contém txid em 62 + pode conter LM... no txid)
    // 3) Linha digitável (digits longos)

    const paymentCodeExpected = String(order.paymentCode || '').toUpperCase();
    const txidExpected = String(order.txid || '').toUpperCase();

    // tenta extrair TXID do EMV: bloco 62.. (ex: 62xx05TXID)
    const extractTxidFromEmv = (emv) => {
      // procura por "62" seguido de 4-6 chars e then "05" + txid (padrão do nosso gerarPixPayload)
      // Ex: ...6208 05<txid> (quantidade pode variar)
      const m = String(emv)
        .replace(/\s+/g, '')
        .match(/62\d{2}05([A-Z0-9]{1,25})/i);
      return m?.[1] ? String(m[1]).toUpperCase() : '';
    };

    const txidFromEmv = extractTxidFromEmv(codigo);

    // tenta achar paymentCode dentro do texto (caso o admin cole o EMV que contém LM... no txid)
    const lmMatch = codigo.match(/LM\d{7,10}/i);

    const codigoDigits = codigo.replace(/\D/g, '');
    const codigoCentavos = String(Math.round(Number(order.valor) * 100));

    const ok =
      // caso 1: colou o paymentCode
      codigo === paymentCodeExpected ||
      // caso 2: colou EMV e conseguimos extrair txid
      (!!txidFromEmv && (txidFromEmv === txidExpected || txidFromEmv.includes(txidExpected) || txidExpected.includes(txidFromEmv))) ||
      // caso 2b: no EMV aparece o LM...
      (!!lmMatch && String(lmMatch[0]).toUpperCase() === paymentCodeExpected) ||
      // caso 3: tentativa pelo valor em centavos (fallback do seu código antigo)
      codigoDigits === codigoCentavos;

    if (!ok) {
      return json(res, 400, {
        ok: false,
        error: 'Código incorreto (não reconheci o paymentCode/txid/EMV)'
      });
    }

    markOrderPaid(db, order, { method: 'confirm_by_code', codigo: codigoRaw });
    return json(res, 200, { ok: true, order });
  }

  if (method === 'POST' && pathname === '/api/payments/confirm') {
    const body = await readBody(req);
    const orderId = safeString(body.orderId);
    const txid = safeString(body.txid);
    const db = readDb();
    const order = orderId
      ? db.orders.find((o) => o.id === orderId)
      : db.orders.find((o) => o.txid === txid);
    if (!order) return json(res, 404, { ok: false, error: 'Pedido não encontrado' });
    markOrderPaid(db, order, { method: 'manual_confirm' });
    return json(res, 200, { ok: true, order });
  }

  if (method === 'POST' && pathname === '/api/webhooks/pix') {
    const secret = req.headers['x-webhook-secret'] || req.headers['x-webhook-token'];
    if (!secret || secret !== WEBHOOK_SECRET) {
      return json(res, 401, { ok: false, error: 'Invalid webhook secret' });
    }

    const payload = await readBody(req);
    const txid = safeString(payload.txid || payload.transactionId || payload.tid);
    const paymentCode = safeString(payload.paymentCode || payload.reference).toUpperCase();
    const statusRaw = safeString(payload.status || payload.paymentStatus).toUpperCase();
    const isPaid =
      statusRaw.includes('PAID') ||
      statusRaw.includes('CONFIRMED') ||
      statusRaw.includes('APPROVED') ||
      payload.paid === true;

    if (!isPaid) return json(res, 200, { ok: true, ignored: true });

    const db = readDb();
    const order =
      db.orders.find((o) => o.txid === txid) ||
      db.orders.find((o) => String(o.paymentCode).toUpperCase() === paymentCode);

    if (!order) return json(res, 404, { ok: false, error: 'Pedido não encontrado para confirmação' });
    markOrderPaid(db, order, payload);
    return json(res, 200, { ok: true, order });
  }

  if (method === 'GET' && pathname === '/api/admin/orders') {
    if (!requireAdmin(req, res)) return;
    const db = readDb();
    const orders = db.orders
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return json(res, 200, { ok: true, orders });
  }

  return json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Lucy Modas backend rodando na porta ${PORT}`);
});
