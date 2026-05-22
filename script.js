// =====================================================
// LUCY MODAS — Loja + Admin + PIX + Firebase
// =====================================================

const CONFIG = {
  EMAIL_ADMIN: 'adminlucymodas@gmail.com',
  SENHA_ADMIN: 'lucy modas',
  BACKEND_URL:
    window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1'
      ? 'http://localhost:3001'
      : '',
  ADMIN_API_KEY: 'DEMO_ADMIN_API_KEY_CHANGE_ME',
  PIX_CHAVE: '5511942129432',
  PIX_NOME: 'LUCY MODAS',
  PIX_CIDADE: 'SAO PAULO',
  PAGAMENTO_VALIDADE_MS: 24 * 60 * 60 * 1000,
  VIDEO_LOCAL: './videos/IMG_9592.MOV',
  VIDEO_ALT: './videos/IMG_9592.MOV',
  LOJA_ENDERECO:
    'Loja física Shopping Canindé, Box 217, Térreo (último corredor), São Paulo, Brazil, CEP 03031-000',
  MAPS_EMBED:
    'https://maps.google.com/maps?q=Shopping+Canind%C3%A9,+box+217,+t%C3%A9rreo,+S%C3%A3o+Paulo,+03031-000&hl=pt&z=17&output=embed',
  MAPS_LINK:
    'https://www.google.com/maps/search/?api=1&query=Shopping+Canindé,+box+217,+térreo,+último+corredor,+São+Paulo,+03031-000'
};

let usuarios = JSON.parse(localStorage.getItem('usuariosLucyModas') || '[]');
let usuarioLogado = JSON.parse(localStorage.getItem('usuarioLogado') || 'null');
if (usuarioLogado === 'null') usuarioLogado = null;
let carrinho = JSON.parse(localStorage.getItem('carrinhoLucyModas') || '[]');

let _otpRecuperacao = null;
let _otpUsuarioAlvo = null;
let _otpExpiracao = null;
let _pedidoAtual = null;
let _pollTimer = null;
let _firestoreUnsub = null;
let _adminUnsub = null;
let _db = null;
let _pagando = false;
let _pedidosAdminCache = [];
let _ultimoTotalPedidos = 0;

// =====================================================
// FIREBASE
// =====================================================

function initFirebase() {
  if (!window.FIREBASE_ATIVO || typeof firebase === 'undefined') return false;
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
    }
    _db = firebase.firestore();
    return true;
  } catch (e) {
    console.warn('Firebase:', e);
    return false;
  }
}

const firebaseOk = initFirebase();

// =====================================================
// UTILITÁRIOS
// =====================================================

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function salvarCarrinho() {
  localStorage.setItem('carrinhoLucyModas', JSON.stringify(carrinho));
}

function salvarSessao(usuario) {
  usuarioLogado = usuario;
  localStorage.setItem('usuarioLogado', JSON.stringify(usuario));
}

function formatarMoeda(v) {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
}

function calcularTotaisCarrinho() {
  const subtotal = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const totalItens = carrinho.reduce((s, i) => s + i.quantidade, 0);
  const desconto = totalItens >= 8 ? subtotal * 0.1 : 0;
  return { subtotal, totalItens, desconto, total: subtotal - desconto };
}

function gerarCodigoPedido() {
  return 'LM' + Math.floor(10000000 + Math.random() * 90000000);
}

// =====================================================
// MODAIS (evita bug carrinho → pagar)
// =====================================================

const Modal = {
  abrir(id) {
    document.querySelectorAll('.modal-overlay.active, .cart-modal-overlay.active, .pix-modal-overlay.active').forEach((el) => {
      el.classList.remove('active');
    });
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  },
  fechar(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
    const algumAberto = document.querySelector(
      '.modal-overlay.active, .cart-modal-overlay.active, .pix-modal-overlay.active'
    );
    if (!algumAberto) document.body.style.overflow = '';
  },
  fecharTodos() {
    document.querySelectorAll('.modal-overlay, .cart-modal-overlay, .pix-modal-overlay').forEach((el) => {
      el.classList.remove('active');
    });
    document.body.style.overflow = '';
  }
};

// =====================================================
// PIX EMV válido (todos os bancos)
// =====================================================

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

function gerarPixPayload(valor, txidRef) {
  const chaveLimpa = String(CONFIG.PIX_CHAVE).replace(/\D/g, '');
  const nomeLimpo = CONFIG.PIX_NOME.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().substring(0, 25);
  const cidadeLimpa = CONFIG.PIX_CIDADE.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().substring(0, 15);
  const valorStr = Number(valor).toFixed(2);
  const txid = String(txidRef || gerarCodigoPedido()).replace(/[^a-zA-Z0-9]/g, '').substring(0, 25);

  const emv = (id, value) => id + String(value.length).padStart(2, '0') + value;
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

// =====================================================
// ADMIN SEED
// =====================================================

function garantirAdminCadastrado() {
  const admin = {
    id: 1,
    nome: 'Admin Lucy Modas',
    email: CONFIG.EMAIL_ADMIN,
    telefone: '5511942129432',
    senha: CONFIG.SENHA_ADMIN,
    endereco: 'Shopping Canindé',
    numeroCasa: 'Box 217',
    bairro: 'Térreo (último corredor)',
    cidade: 'São Paulo',
    estado: 'SP',
    cep: '03031-000',
    data: new Date().toLocaleString('pt-BR')
  };
  const idx = usuarios.findIndex((u) => u.email === CONFIG.EMAIL_ADMIN);
  if (idx === -1) usuarios.push(admin);
  else usuarios[idx] = { ...usuarios[idx], ...admin };
  localStorage.setItem('usuariosLucyModas', JSON.stringify(usuarios));
}

garantirAdminCadastrado();

// =====================================================
// PEDIDOS — Firebase + localStorage + backend opcional
// =====================================================

function getPedidosLocal() {
  return JSON.parse(localStorage.getItem('pedidosLucyModas') || '[]');
}

function salvarPedidoLocal(pedido) {
  const lista = getPedidosLocal();
  const idx = lista.findIndex((p) => p.id === pedido.id);
  if (idx >= 0) lista[idx] = { ...lista[idx], ...pedido };
  else lista.push(pedido);
  localStorage.setItem('pedidosLucyModas', JSON.stringify(lista));
}

async function criarPedido(dados) {
  const id = 'ped_' + Date.now();
  const paymentCode = gerarCodigoPedido();
  const pedido = {
    id,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + CONFIG.PAGAMENTO_VALIDADE_MS,
    status: 'PENDING',
    paymentCode,
    pixCopiaCola: gerarPixPayload(dados.valor, paymentCode),
    ...dados
  };

  salvarPedidoLocal(pedido);

  if (firebaseOk && _db) {
    await _db.collection('pedidos').doc(id).set(pedido);
  }

  notificarAdminNovoPedido(pedido);

  if (CONFIG.BACKEND_URL) {
    try {
      await fetch(`${CONFIG.BACKEND_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dados, txid: paymentCode, orderId: id })
      });
    } catch {
      /* backend opcional */
    }
  }

  return pedido;
}

async function buscarPedidoPorId(pedidoId) {
  if (firebaseOk && _db) {
    const snap = await _db.collection('pedidos').doc(pedidoId).get();
    if (snap.exists) return { id: pedidoId, ...snap.data() };
  }
  return getPedidosLocal().find((p) => p.id === pedidoId) || null;
}

async function atualizarStatusPedido(pedidoId, status, pedidoRef = null) {
  const paidAt = status === 'PAID' ? new Date().toISOString() : null;
  const shippedAt = status === 'SHIPPED' ? new Date().toISOString() : null;
  const patch = { status };
  if (paidAt) patch.paidAt = paidAt;
  if (shippedAt) patch.shippedAt = shippedAt;

  if (firebaseOk && _db) {
    await _db.collection('pedidos').doc(pedidoId).update(patch);
  }

  const lista = getPedidosLocal();
  const idx = lista.findIndex((p) => p.id === pedidoId);
  if (idx !== -1) {
    lista[idx] = { ...lista[idx], ...patch };
    localStorage.setItem('pedidosLucyModas', JSON.stringify(lista));
  }

  if (CONFIG.BACKEND_URL) {
    try {
      await fetch(`${CONFIG.BACKEND_URL}/api/payments/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: pedidoId })
      });
    } catch {
      /* opcional */
    }
  }

  if (status === 'PAID') {
    const pedido = pedidoRef || (await buscarPedidoPorId(pedidoId));
    if (pedido && !pedido.emailNotificado) {
      await enviarEmailClientePago(pedido);
      if (firebaseOk && _db) {
        await _db.collection('pedidos').doc(pedidoId).update({ emailNotificado: true });
      }
      const loc = getPedidosLocal();
      const i = loc.findIndex((p) => p.id === pedidoId);
      if (i !== -1) {
        loc[i].emailNotificado = true;
        localStorage.setItem('pedidosLucyModas', JSON.stringify(loc));
      }
    }
  }
}

async function marcarPedidoComoPago(pedidoId) {
  const pedido = await buscarPedidoPorId(pedidoId);
  await atualizarStatusPedido(pedidoId, 'PAID', pedido);
  mostrarAlertaAdmin('✅ Pagamento confirmado! Cliente notificado por e-mail.', 'ok');
}

async function enviarPedidoParaCliente(pedidoId) {
  const pedido = await buscarPedidoPorId(pedidoId);
  if (!pedido) throw new Error('Pedido não encontrado');
  if (pedido.status !== 'PAID') {
    alert('Só é possível enviar pedidos já pagos.');
    return;
  }
  await atualizarStatusPedido(pedidoId, 'SHIPPED', pedido);
  await enviarEmailClienteEnviado(pedido);
  if (firebaseOk && _db) {
    await _db.collection('pedidos').doc(pedidoId).update({ emailEnviadoLoja: true });
  }
  const loc = getPedidosLocal();
  const i = loc.findIndex((p) => p.id === pedidoId);
  if (i !== -1) {
    loc[i].emailEnviadoLoja = true;
    localStorage.setItem('pedidosLucyModas', JSON.stringify(loc));
  }
  mostrarAlertaAdmin('📦 Pedido enviado! Cliente notificado que saiu da loja.', 'ok');
}

// =====================================================
// E-MAIL (EmailJS)
// =====================================================

function initEmailJS() {
  if (!window.EMAILJS_ATIVO || typeof emailjs === 'undefined') return false;
  try {
    emailjs.init(window.EMAILJS_CONFIG.publicKey);
    return true;
  } catch (e) {
    console.warn('EmailJS:', e);
    return false;
  }
}

const emailJsOk = initEmailJS();

async function enviarEmailClienteEnviado(pedido) {
  if (!pedido?.email) return;
  const params = {
    to_email: pedido.email,
    to_name: pedido.cliente || 'Cliente',
    order_id: pedido.id,
    valor: formatarMoeda(pedido.valor),
    itens: Array.isArray(pedido.itens) ? pedido.itens.join(', ') : String(pedido.itens || ''),
    mensagem: 'Seu pedido saiu da loja e está a caminho!',
    reply_to: CONFIG.EMAIL_ADMIN
  };

  if (emailJsOk && window.EMAILJS_CONFIG.templateClienteEnviado) {
    try {
      await emailjs.send(
        window.EMAILJS_CONFIG.serviceId,
        window.EMAILJS_CONFIG.templateClienteEnviado,
        params
      );
      return;
    } catch (e) {
      console.warn('EmailJS enviado:', e);
    }
  }

  console.info('[Lucy Modas] E-mail envio loja:', params);
}

async function enviarEmailClientePago(pedido) {
  if (!pedido?.email) return;
  const params = {
    to_email: pedido.email,
    to_name: pedido.cliente || 'Cliente',
    order_id: pedido.id,
    payment_code: pedido.paymentCode || '',
    valor: formatarMoeda(pedido.valor),
    itens: Array.isArray(pedido.itens) ? pedido.itens.join(', ') : String(pedido.itens || ''),
    reply_to: CONFIG.EMAIL_ADMIN
  };

  if (emailJsOk) {
    try {
      await emailjs.send(
        window.EMAILJS_CONFIG.serviceId,
        window.EMAILJS_CONFIG.templateClientePago,
        params
      );
      return;
    } catch (e) {
      console.warn('EmailJS cliente:', e);
    }
  }

  console.info('[Lucy Modas] E-mail cliente (configure EmailJS):', params);
}

async function notificarAdminNovoPedido(pedido) {
  if (!pedido) return;
  mostrarAlertaAdmin(`🛒 Novo pedido: ${pedido.cliente} — ${formatarMoeda(pedido.valor)}`, 'novo');

  const params = {
    to_email: CONFIG.EMAIL_ADMIN,
    to_name: 'Admin Lucy Modas',
    cliente: pedido.cliente,
    email_cliente: pedido.email,
    telefone: pedido.telefone,
    endereco: `${pedido.endereco || ''}, ${pedido.numeroCasa || ''} — ${pedido.bairro || ''}`,
    cidade: `${pedido.cidade || ''} / ${pedido.estado || ''} — CEP ${pedido.cep || ''}`,
    itens: Array.isArray(pedido.itens) ? pedido.itens.join(', ') : String(pedido.itens || ''),
    valor: formatarMoeda(pedido.valor),
    payment_code: pedido.paymentCode,
    order_id: pedido.id
  };

  if (emailJsOk) {
    try {
      await emailjs.send(
        window.EMAILJS_CONFIG.serviceId,
        window.EMAILJS_CONFIG.templateAdminNovoPedido,
        params
      );
    } catch (e) {
      console.warn('EmailJS admin:', e);
    }
  }
}

function mostrarAlertaAdmin(msg, tipo = 'info') {
  const el = document.getElementById('adminAlerta');
  if (!el) return;
  el.style.display = 'block';
  el.className = 'admin-alerta admin-alerta-' + tipo;
  el.textContent = msg;
  if (tipo !== 'novo') {
    setTimeout(() => {
      el.style.display = 'none';
    }, 6000);
  }
}

function pararMonitoramentoPagamento() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_firestoreUnsub) {
    _firestoreUnsub();
    _firestoreUnsub = null;
  }
}

function iniciarMonitoramentoPagamento(pedidoId) {
  pararMonitoramentoPagamento();
  atualizarStatusPix('⏳ Aguardando pagamento no banco (24h)...', 'info');

  if (firebaseOk && _db) {
    _firestoreUnsub = _db
      .collection('pedidos')
      .doc(pedidoId)
      .onSnapshot(
        (snap) => {
          if (!snap.exists) return;
          const data = snap.data();
          if (data.status === 'PAID') finalizarPedidoPago();
          else if (data.status === 'EXPIRED') atualizarStatusPix('❌ Pagamento expirado.', 'erro');
        },
        (err) => console.warn('Firestore listen:', err)
      );
  }

  _pollTimer = setInterval(() => {
    const local = getPedidosLocal().find((p) => p.id === pedidoId);
    if (local?.status === 'PAID') {
      finalizarPedidoPago();
      return;
    }
    if (local?.expiresAt && Date.now() > local.expiresAt && local.status === 'PENDING') {
      atualizarStatusPix('❌ Pagamento expirado. Gere novo pedido.', 'erro');
      pararMonitoramentoPagamento();
    }
  }, 3000);
}

// =====================================================
// CARRINHO
// =====================================================

function atualizarCarrinhoUI() {
  const cartItemsEl = document.getElementById('cartItems');
  const cartTotalEl = document.getElementById('cartTotal');
  const cartCountEl = document.getElementById('cartCount');
  const descontoRow = document.getElementById('descontoRow');
  const descontoValue = document.getElementById('descontoValue');

  if (!cartItemsEl || !cartTotalEl || !cartCountEl) return;

  const { totalItens, desconto, total } = calcularTotaisCarrinho();
  cartCountEl.textContent = totalItens;

  if (!carrinho.length) {
    cartItemsEl.innerHTML =
      '<div class="cart-vazio" style="text-align:center;padding:2rem;color:#999;">Carrinho vazio 🛒</div>';
    cartTotalEl.textContent = 'R$ 0,00';
    if (descontoRow) descontoRow.style.display = 'none';
    const btnPagar = document.getElementById('btnPagar');
    if (btnPagar) btnPagar.disabled = true;
    return;
  }

  // Exigência: no carrinho, mostrar apenas as fotos (evita erros de layout/HTML)
  cartItemsEl.innerHTML = carrinho
    .map(
      (item) => `
    <div class="cart-item" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f0f0f0;">
      <img src="${escapeHtml(item.imagem)}" alt="" style="width:90px;height:70px;object-fit:cover;border-radius:12px;" onerror="this.style.display='none'">
    </div>`
    )
    .join('');
  cartItemsEl.innerHTML = carrinho
    .map(
      (item, index) => `
    <div class="cart-item" data-index="${index}" style="display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #f0f0f0;">
      <img src="${escapeHtml(item.imagem)}" alt="" style="width:60px;height:60px;object-fit:cover;border-radius:10px;" onerror="this.style.display='none'">
      <div style="flex:1;">
        <h4 style="font-size:0.95rem;margin-bottom:4px;">${escapeHtml(item.nome)}</h4>
        ${item.estampa ? `<small style="color:#888;">Estampa: ${escapeHtml(item.estampa)}</small>` : ''}
        <div style="display:flex;gap:10px;align-items:center;">
          <button type="button" class="btn-qtd-menos" data-index="${index}" style="width:28px;height:28px;border-radius:50%;border:none;background:#eee;cursor:pointer;font-weight:700;">-</button>
          <span style="font-weight:600;">${item.quantidade}</span>
          <button type="button" class="btn-qtd-mais" data-index="${index}" style="width:28px;height:28px;border-radius:50%;border:none;background:#eee;cursor:pointer;font-weight:700;">+</button>
        </div>
        <strong style="color:#FF69B4;">${formatarMoeda(item.preco * item.quantidade)}</strong>
      </div>
      <button type="button" class="btn-remover-item" data-index="${index}" style="background:none;border:none;color:#FF4444;cursor:pointer;font-size:1.3rem;">🗑️</button>
    </div>`
    )
    .join('');

  if (desconto > 0) {
    if (descontoRow) descontoRow.style.display = 'flex';
    if (descontoValue) descontoValue.textContent = `-${formatarMoeda(desconto)}`;
  } else if (descontoRow) {
    descontoRow.style.display = 'none';
  }

  cartTotalEl.textContent = formatarMoeda(total);
  const btnPagar = document.getElementById('btnPagar');
  if (btnPagar) btnPagar.disabled = false;
}

function setupDelegacaoCarrinho() {
  const cartItemsEl = document.getElementById('cartItems');
  if (!cartItemsEl || cartItemsEl.dataset.bound === '1') return;
  cartItemsEl.dataset.bound = '1';

  cartItemsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const index = parseInt(btn.dataset.index, 10);
    if (Number.isNaN(index) || !carrinho[index]) return;

    if (btn.classList.contains('btn-qtd-mais')) {
      carrinho[index].quantidade += 1;
    } else if (btn.classList.contains('btn-qtd-menos')) {
      carrinho[index].quantidade -= 1;
      if (carrinho[index].quantidade <= 0) carrinho.splice(index, 1);
    } else if (btn.classList.contains('btn-remover-item')) {
      carrinho.splice(index, 1);
    } else return;

    salvarCarrinho();
    atualizarCarrinhoUI();
  });
}

function adicionarAoCarrinho({ id, nome, preco, imagem, quantidade = 1, abrirCarrinho = false }) {
  if (!usuarioLogado) {
    Modal.abrir('loginModal');
    return;
  }
  const existente = carrinho.find((i) => i.id === id);
  if (existente) existente.quantidade += quantidade;
  else carrinho.push({ id, nome, preco, imagem, quantidade });
  salvarCarrinho();
  atualizarCarrinhoUI();

  const badge = document.getElementById('cartCount');
  if (badge) {
    badge.style.transform = 'scale(1.35)';
    setTimeout(() => (badge.style.transform = ''), 280);
  }
  if (abrirCarrinho) Modal.abrir('cartModal');
}

// =====================================================
// LOGIN
// =====================================================

function atualizarLoginUI() {
  const loginBtn = document.getElementById('loginBtn');
  if (!loginBtn) return;
  if (usuarioLogado) {
    loginBtn.textContent = `Olá, ${usuarioLogado.nome.split(' ')[0]} ▾`;
    loginBtn.classList.add('logado');
  } else {
    loginBtn.innerHTML = '<i class="fas fa-user"></i> Entrar';
    loginBtn.classList.remove('logado');
  }
  const adminLink = document.querySelector('.admin-link');
  if (adminLink) {
    adminLink.style.display =
      usuarioLogado?.email === CONFIG.EMAIL_ADMIN ? 'flex' : 'none';
  }
}

function mostrarApenasRecovery(formId) {
  ['forgotPasswordRequest', 'forgotPasswordVerify', 'forgotPasswordReset'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === formId ? 'block' : 'none';
  });
}

// =====================================================
// PAGAMENTO PIX
// =====================================================

function atualizarStatusPix(msg, tipo = 'info') {
  const el = document.getElementById('pixStatusMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.color = tipo === 'ok' ? '#28a745' : tipo === 'erro' ? '#dc3545' : '#666';
}

async function gerarQRCode(payload) {
  const img = document.getElementById('qrCodeImg');
  if (!img || !window.QRCode) return;
  return new Promise((resolve) => {
    window.QRCode.toDataURL(payload, { width: 220, margin: 2, errorCorrectionLevel: 'M' }, (err, url) => {
      if (err) {
        img.style.display = 'none';
        resolve();
        return;
      }
      img.src = url;
      img.style.display = 'block';
      resolve();
    });
  });
}

function preencherTelaPagamento(pedido) {
  const pixInput = document.getElementById('pixCopiaColaInput');
  const valorEl = document.getElementById('pixValorDisplay');

  document._pixCopiaColaAtual = pedido.pixCopiaCola || '';
  if (pixInput) pixInput.value = document._pixCopiaColaAtual;
  if (valorEl) valorEl.textContent = formatarMoeda(pedido.valor);

  gerarQRCode(document._pixCopiaColaAtual);
}

async function finalizarPedidoPago() {
  pararMonitoramentoPagamento();
  atualizarStatusPix('✅ Pagamento confirmado! Pedido finalizado.', 'ok');

  if (_pedidoAtual?.id && _pedidoAtual.status !== 'PAID') {
    await atualizarStatusPedido(_pedidoAtual.id, 'PAID', _pedidoAtual);
    _pedidoAtual.status = 'PAID';
  } else if (_pedidoAtual?.id && !_pedidoAtual.emailNotificado) {
    await enviarEmailClientePago(_pedidoAtual);
  }

  carrinho = [];
  salvarCarrinho();
  atualizarCarrinhoUI();
  setTimeout(() => {
    Modal.fechar('pixModal');
    alert('✅ Pagamento concluído com sucesso!');
  }, 800);
}

async function processarPagamento() {
  // Se o backend estiver ativo, o PIX é “por código” (manual_confirm) no admin.
  // Como não existe webhook real de banco → precisa confirmar no admin ou integrar webhook.

  if (_pagando) return;
  if (!carrinho.length) {
    alert('Seu carrinho está vazio.');
    return;
  }
  if (!usuarioLogado) {
    Modal.abrir('loginModal');
    return;
  }

  const btnPagar = document.getElementById('btnPagar');
  _pagando = true;
  if (btnPagar) {
    btnPagar.disabled = true;
    btnPagar.textContent = 'Gerando PIX...';
  }

  const { total, desconto } = calcularTotaisCarrinho();
  const u = usuarioLogado;

  const resumoEl = document.getElementById('pedidoResumo');
  if (resumoEl) {
    resumoEl.innerHTML = `
      <div style="background:#f9f9f9;border-radius:15px;padding:1rem;text-align:left;">
        <h4 style="margin-bottom:0.5rem;color:#333;">📋 Resumo</h4>
        ${carrinho
          .map(
            (i) =>
              `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.9rem;">
                <span>${escapeHtml(i.nome)} x${i.quantidade}</span>
                <strong>${formatarMoeda(i.preco * i.quantidade)}</strong>
              </div>`
          )
          .join('')}
        ${desconto > 0 ? `<div style="color:green;padding:4px 0;">Desconto: -${formatarMoeda(desconto)}</div>` : ''}
        <hr style="margin:8px 0;">
        <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1.1rem;">
          <span>Total</span><span style="color:#FF69B4;">${formatarMoeda(total)}</span>
        </div>
      </div>`;
  }

  try {
    _pedidoAtual = await criarPedido({
      cliente: u.nome,
      email: u.email,
      telefone: u.telefone,
      endereco: u.endereco,
      numeroCasa: u.numeroCasa,
      bairro: u.bairro,
      cidade: u.cidade,
      estado: u.estado,
      cep: u.cep,
      itens: carrinho.map((i) => `${i.nome} x${i.quantidade}`),
      valor: total
    });

    Modal.fechar('cartModal');
    preencherTelaPagamento(_pedidoAtual);
    iniciarMonitoramentoPagamento(_pedidoAtual.id);
    atualizarStatusPix('✅ Código gerado! Copie o PIX e pague no seu banco.', 'ok');
    Modal.abrir('pixModal');
  } catch (err) {
    console.error(err);
    alert('Erro ao gerar pagamento. Tente novamente.');
  } finally {
    _pagando = false;
    if (btnPagar) {
      btnPagar.disabled = !carrinho.length;
      btnPagar.innerHTML = 'Pagar via PIX <i class="fas fa-bolt"></i>';
    }
  }
}

async function copiarTexto(texto, btn, okText) {
  if (!texto?.trim()) {
    alert('Nenhum código disponível. Clique em Pagar via PIX primeiro.');
    return;
  }
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = okText || '✅ Copiado!';
    setTimeout(() => (btn.innerHTML = orig), 2000);
  }
}

// =====================================================
// LOCALIZAÇÃO + VÍDEO (pasta videos/)
// =====================================================

function montarModalLocalizacao() {
  const content = document.querySelector('.location-content');
  if (!content || content.dataset.ready === '1') return;

  const wrap = document.createElement('div');
  wrap.className = 'loc-video-wrap';
  wrap.style.cssText = 'margin:1rem 0;border-radius:12px;overflow:hidden;';

  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.style.cssText = 'width:100%;max-height:280px;border-radius:12px;background:#000;';
  const fontes = [CONFIG.VIDEO_LOCAL, CONFIG.VIDEO_ALT];
  let fonteIdx = 0;
  function tentarProximaFonte() {
    if (fonteIdx >= fontes.length) {
      video.insertAdjacentHTML(
        'afterend',
        '<p style="color:#888;font-size:0.85rem;margin:8px 0;">Vídeo não encontrado. Execute <strong>copiar-video.ps1</strong> na pasta do site.</p>'
      );
      return;
    }
    video.src = fontes[fonteIdx++];
  }
  video.onerror = tentarProximaFonte;
  tentarProximaFonte();

  const mapa = document.createElement('iframe');
  mapa.width = '100%';
  mapa.height = '220';
  mapa.src = CONFIG.MAPS_EMBED;
  mapa.title = 'Localização Lucy Modas';
  mapa.style.cssText = 'margin-top:10px;border:0;border-radius:12px;';
  mapa.loading = 'lazy';
  mapa.referrerPolicy = 'no-referrer-when-downgrade';

  const linkMaps = document.createElement('a');
  linkMaps.href = CONFIG.MAPS_LINK;
  linkMaps.target = '_blank';
  linkMaps.rel = 'noopener';
  linkMaps.className = 'loc-maps-link';
  linkMaps.style.cssText =
    'display:inline-block;margin-top:8px;color:#FF69B4;font-weight:700;text-decoration:none;';
  linkMaps.textContent = '📍 Abrir no Google Maps';

  wrap.appendChild(video);
  wrap.appendChild(mapa);
  wrap.appendChild(linkMaps);

  const p = content.querySelector('p');
  if (p) p.after(wrap);
  content.dataset.ready = '1';
}

// =====================================================
// ESTAMPAS — galeria + modal profissional
// =====================================================

const PRODUTOS_ESTAMPAS = {
  'millena-manga-longa': {
    nome: 'Millena Manga Longa',
    preco: 67,
    estampas: [
      { id: 'e1', nome: 'Estampa 1', img: './image/millenamangalonga.png' },
      { id: 'e2', nome: 'Estampa 2', img: './image/millenamangalonga2.png' },
      { id: 'e3', nome: 'Estampa 3', img: './image/millenamangalonga3.png' },
      { id: 'e4', nome: 'Estampa 4', img: './image/millenamangalonga4.png' },
      { id: 'e5', nome: 'Estampa 5', img: './image/millenamangalonga5.png' },
      { id: 'e6', nome: 'Estampa 6', img: './image/millenamangalonga6.png' },
      { id: 'e7', nome: 'Estampa 7', img: './image/millenamangalonga7.png' },
      { id: 'e8', nome: 'Estampa 8', img: './image/millenamangalonga8.png' },
      { id: 'e9', nome: 'Estampa 9', img: './image/millenamangalonga9.png' },
      { id: 'e10', nome: 'Estampa 10', img: './image/millenamangalonga10.png' },
      { id: 'e11', nome: 'Estampa 11', img: './image/millenamangalonga11.png' },
      { id: 'e12', nome: 'Estampa 12', img: './image/millenamangalonga12.png' },
      { id: 'e13', nome: 'Estampa 13', img: './image/millenamangalonga13.png' }
    ]
  },
  'millena-manga-curta': {
    nome: 'Millena Manga Curta',
    preco: 37,
    estampas: [
      { id: 'e1', nome: 'Estampa 1', img: './image/millenamangacurta1.png' },
      { id: 'e2', nome: 'Estampa 2', img: './image/millenamangacurta2.png' },
      { id: 'e3', nome: 'Estampa 3', img: './image/millenamangacurta3.png' },
      { id: 'e4', nome: 'Estampa 4', img: './image/millenamangacurta4.png' },
      { id: 'e5', nome: 'Estampa 5', img: './image/millenamangacurta5.png' },
      { id: 'e6', nome: 'Estampa 6', img: './image/millenamangacurta6.png' },
      { id: 'e7', nome: 'Estampa 7', img: './image/millenamangacurta7.png' },
      { id: 'e8', nome: 'Estampa 8', img: './image/millenamangacurta8.png' }
    ]
  }
};


let _produtoEstampaAberto = null;
let _estampaEscolhida = null;

function trocarImagemGaleria(produtoEl, imgSrc, estampaNome) {
  const principal = produtoEl.querySelector('.galeria-img-principal');
  const label = produtoEl.querySelector('.estampa-selecionada-label span');
  if (principal) {
    principal.style.opacity = '0';
    setTimeout(() => {
      principal.src = imgSrc;
      principal.style.opacity = '1';
    }, 120);
  }
  if (label) label.textContent = estampaNome;
  produtoEl.querySelectorAll('.miniatura').forEach((m) => {
    m.classList.toggle('ativa', m.dataset.img === imgSrc);
  });
}

function initGaleriaEstampas() {
  document.querySelectorAll('.produto-com-estampas').forEach((produtoEl) => {
    produtoEl.querySelectorAll('.miniatura').forEach((mini) => {
      const ativar = () => {
        trocarImagemGaleria(produtoEl, mini.dataset.img, mini.dataset.estampa);
      };
      mini.addEventListener('mouseenter', ativar);
      mini.addEventListener('click', ativar);
    });
  });
}

function abrirModalEstampas(produtoId) {
  const produto = PRODUTOS_ESTAMPAS[produtoId];
  if (!produto) return;

  if (!usuarioLogado) {
    Modal.abrir('loginModal');
    return;
  }

  _produtoEstampaAberto = produtoId;
  _estampaEscolhida = null;

  const modal = document.getElementById('estampaModal');
  const grid = document.getElementById('estampaModalGrid');
  const preview = document.getElementById('estampaModalPreview');
  const nomeEl = document.getElementById('estampaModalNome');
  const btnOkEl = document.getElementById('confirmarEstampaBtn');
  if (!grid || !btnOkEl) {
    console.warn('[Lucy Modas] Modal de estampas: elementos ausentes (grid/btn).');
    return;
  }

  const titulo = document.getElementById('estampaModalTitulo');
  const btnOk = document.getElementById('confirmarEstampaBtn');

  if (titulo) titulo.textContent = produto.nome;
  if (preview) preview.src = '';
  if (nomeEl) nomeEl.textContent = 'Selecione uma estampa';
  if (btnOkEl) btnOkEl.disabled = true;

  const subTitulo = document.getElementById('estampaModalSubTitulo');
  if (subTitulo) {
    subTitulo.textContent =
      produtoId === 'millena-manga-longa'
        ? 'Millena Manga Longa — toque na estampa desejada'
        : 'Millena Manga Curta — toque na estampa desejada';
  }

  // renderiza apenas o conjunto correto (curta vs longa)
  grid.innerHTML = produto.estampas
    .map(
      (e) => `
    <button type="button" class="estampa-opcao" data-id="${e.id}" data-img="${escapeHtml(e.img)}" data-nome="${escapeHtml(e.nome)}">
      <img src="${escapeHtml(e.img)}" alt="${escapeHtml(e.nome)}">
      <span>${escapeHtml(e.nome)}</span>
    </button>`
    )
    .join('');



  grid.querySelectorAll('.estampa-opcao').forEach((btn) => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.estampa-opcao').forEach((b) => b.classList.remove('selecionada'));
      btn.classList.add('selecionada');
      _estampaEscolhida = {
        id: btn.dataset.id,
        nome: btn.dataset.nome,
        img: btn.dataset.img
      };
      if (preview) preview.src = _estampaEscolhida.img;
      if (nomeEl) nomeEl.textContent = _estampaEscolhida.nome;
      if (btnOk) btnOk.disabled = false;
    });
  });

  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function fecharModalEstampas() {
  const modal = document.getElementById('estampaModal');
  if (modal) modal.classList.remove('active');
  const outroModal = document.querySelector(
    '.modal-overlay.active, .cart-modal-overlay.active, .pix-modal-overlay.active'
  );
  if (!outroModal) document.body.style.overflow = '';
}

function confirmarEstampaNoCarrinho() {
  if (!_produtoEstampaAberto || !_estampaEscolhida) return;
  const produto = PRODUTOS_ESTAMPAS[_produtoEstampaAberto];
  const idCarrinho = `${_produtoEstampaAberto}_${_estampaEscolhida.id}`;
  const nomeCompleto = `${produto.nome} — ${_estampaEscolhida.nome}`;

  adicionarAoCarrinho({
    id: idCarrinho,
    nome: nomeCompleto,
    preco: produto.preco,
    imagem: _estampaEscolhida.img,
    estampa: _estampaEscolhida.nome,
    abrirCarrinho: true
  });

  fecharModalEstampas();
}

// =====================================================
// PROMOÇÕES
// =====================================================

const PROMOS = [
  // Removido placeholder externo (via.placeholder.com) para evitar erro no console offline.
  { sel: '.promo-3x105 .add-cart-promo', id: 'promo_3x105', nome: 'Promoção 3 por R$105', preco: 105, img: './image/millenamangacurta2.png' },
  { sel: '.promo-vestido .add-cart-promo', id: 'promo_vestido', nome: 'Vestido Promoção R$45', preco: 45, img: './image/millenamangacurta1.png' },
  { sel: '.promo-3x100 .add-cart-promo', id: 'promo_3x100', nome: 'Promoção 3 por R$100', preco: 100, img: './image/millenamangalonga2.png' }
];

function iniciarTimersPromo() {
  document.querySelectorAll('.promo-separada').forEach((promo) => {
    const timerEl = promo.querySelector('.promo-timer-v4');
    if (!timerEl) return;
    const key = 'promoTimer_' + (promo.dataset.timer || 'default');
    let restante = parseInt(localStorage.getItem(key), 10);
    if (!restante || restante <= 0) restante = parseInt(promo.dataset.timer, 10) || 86400;

    const fmt = (s) => {
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      return `⏰ ${h}:${m}:${sec}`;
    };

    timerEl.textContent = fmt(restante);
    const iv = setInterval(() => {
      if (restante <= 0) {
        clearInterval(iv);
        timerEl.textContent = '⏰ ENCERRADA';
        return;
      }
      restante--;
      timerEl.textContent = fmt(restante);
      localStorage.setItem(key, restante);
    }, 1000);
  });
}

// =====================================================
// ADMIN
// =====================================================

function protegerAdmin() {
  if (!location.pathname.toLowerCase().includes('admin')) return;
  if (!usuarioLogado || usuarioLogado.email !== CONFIG.EMAIL_ADMIN || usuarioLogado.senha !== CONFIG.SENHA_ADMIN) {
    alert('Acesso restrito.');
    location.href = 'index.html';
  }
}

function renderizarPedidosAdmin(pedidos) {
  const lista = document.getElementById('listaPedidos');
  if (!lista) return;

  const aguardandoEnvio = pedidos.filter((p) => p.status === 'PAID').length;
  const badge = document.getElementById('badgeNovos');
  if (badge) {
    badge.style.display = aguardandoEnvio > 0 ? 'inline-block' : 'none';
    badge.textContent = aguardandoEnvio;
  }

  document.getElementById('totalPedidos').textContent = pedidos.length;
  document.getElementById('totalVendas').textContent = formatarMoeda(
    pedidos
      .filter((p) => p.status === 'PAID' || p.status === 'SHIPPED')
      .reduce((a, p) => a + (Number(p.valor) || 0), 0)
  );
  document.getElementById('clientesTotal').textContent = new Set(pedidos.map((p) => p.email).filter(Boolean)).size;

  if (pedidos.length > _ultimoTotalPedidos) {
    const novos = pedidos.length - _ultimoTotalPedidos;
    if (_ultimoTotalPedidos > 0 && novos > 0) {
      mostrarAlertaAdmin(`🔔 ${novos} novo(s) pedido(s) na loja!`, 'novo');
    }
  }
  _ultimoTotalPedidos = pedidos.length;
  _pedidosAdminCache = pedidos;

  lista.innerHTML = pedidos.length
    ? pedidos
        .map((p) => {
          const statusClass =
            p.status === 'SHIPPED'
              ? 'pedido-enviado'
              : p.status === 'PAID'
                ? 'pedido-pago'
                : p.status === 'PENDING'
                  ? 'pedido-pendente'
                  : '';
          const statusLabel =
            p.status === 'SHIPPED'
              ? '📦 Enviado ao cliente'
              : p.status === 'PAID'
                ? '✅ Pago — pronto para enviar'
                : p.status === 'PENDING'
                  ? '⏳ Aguardando pagamento PIX'
                  : escapeHtml(p.status || 'PENDING');
          return `
        <div class="pedido ${statusClass}" data-id="${escapeHtml(p.id)}">
          <h3>🛍️ ${escapeHtml(p.cliente)}</h3>
          <p>📧 ${escapeHtml(p.email)}</p>
          <p>📱 ${escapeHtml(p.telefone)}</p>
          <p>📍 ${escapeHtml(p.endereco || '')}, ${escapeHtml(p.numeroCasa || '')}</p>
          <p>🏘️ ${escapeHtml(p.bairro || '')} — ${escapeHtml(p.cidade || '')} / ${escapeHtml(p.estado || '')}</p>
          <p>📮 CEP: ${escapeHtml(p.cep || '')}</p>
          <p>🛒 ${escapeHtml(Array.isArray(p.itens) ? p.itens.join(', ') : p.itens)}</p>
          <p>💰 ${formatarMoeda(p.valor)}</p>
          <p>🔑 Código PIX: <strong>${escapeHtml(p.paymentCode)}</strong></p>
          <p>⏰ ${p.createdAt ? new Date(p.createdAt).toLocaleString('pt-BR') : ''}</p>
          <p class="pedido-status"><strong>Status:</strong> ${statusLabel}</p>
          ${
            p.status === 'PAID'
              ? `<button type="button" class="btn-enviar-cliente" data-id="${escapeHtml(p.id)}">Enviar para cliente</button>`
              : p.status === 'PENDING'
                ? `<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
                    <input type="text" class="admin-confirm-code-input" placeholder="Colar Código PIX" data-id="${escapeHtml(p.id)}" style="padding:8px 10px;border-radius:12px;border:1px solid #eee;min-width:220px;" />
                    <button type="button" class="btn-confirmar-pix" data-id="${escapeHtml(p.id)}">Confirmar PIX</button>
                  </div>`
                : p.status === 'SHIPPED'

                ? `<p class="pedido-pago-msg">📦 Saiu da loja${p.shippedAt ? ' em ' + new Date(p.shippedAt).toLocaleString('pt-BR') : ''}${p.emailEnviadoLoja ? ' — cliente avisado' : ''}</p>`
                : p.status === 'PENDING'
                  ? '<p style="color:#ffc107;margin-top:8px;">Aguardando confirmação do pagamento no banco.</p>'
                  : ''
          }
        </div>`;
        })
        .join('')
    : '<p class="admin-vazio">Nenhum pedido ainda. Quando um cliente pagar, aparece aqui em tempo real.</p>';

  lista.querySelectorAll('.btn-enviar-cliente').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Confirmar que o pedido saiu da loja e avisar o cliente por e-mail?')) return;
      btn.disabled = true;
      try {
        await enviarPedidoParaCliente(btn.dataset.id);
        await carregarPedidosAdmin();
      } catch (e) {
        alert(e.message || 'Erro ao enviar');
        btn.disabled = false;
      }
    };
  });

  // Confirmação manual por código no backend (quando disponível)
  lista.querySelectorAll('.btn-confirmar-pix').forEach((btn) => {
    btn.onclick = async () => {
      const pedidoId = btn.dataset.id;
      const input = lista.querySelector(`.admin-confirm-code-input[data-id="${pedidoId}"]`);
      const codigo = input?.value?.trim();
      if (!codigo) return alert('Cole o código PIX no campo.');

      btn.disabled = true;
      try {
        if (!CONFIG.BACKEND_URL) {
          // Sem backend: tenta marcar no Firebase/localStorage (modo manual simples)
          await atualizarStatusPedido(pedidoId, 'PAID');
        } else {
          // Backend confirma por código e marca como PAID.
          const resp = await fetch(`${CONFIG.BACKEND_URL}/api/payments/confirm-by-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: pedidoId, codigo })
          });
          const data = await resp.json();
          if (!resp.ok || !data.ok) throw new Error(data?.error || 'Falha ao confirmar por código');

          // Atualiza Firebase/localStorage para refletir na tela
          await atualizarStatusPedido(pedidoId, 'PAID');
        }

        mostrarAlertaAdmin('✅ PIX confirmado manualmente! Pedido marcado como PAID.', 'ok');
        await carregarPedidosAdmin();
      } catch (e) {
        alert(e.message || 'Erro ao confirmar PIX.');
        btn.disabled = false;
      }
    };
  });
}


async function carregarPedidosAdmin() {
  let pedidos = [];
  if (firebaseOk && _db) {
    try {
      const snap = await _db.collection('pedidos').orderBy('createdAt', 'desc').limit(100).get();
      pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn(e);
    }
  }
  if (!pedidos.length) pedidos = getPedidosLocal().slice().reverse();
  renderizarPedidosAdmin(pedidos);
}

function pararAdminTempoReal() {
  if (_adminUnsub) {
    _adminUnsub();
    _adminUnsub = null;
  }
}

function iniciarAdminTempoReal() {
  pararAdminTempoReal();
  if (!firebaseOk || !_db) {
    carregarPedidosAdmin();
    setInterval(carregarPedidosAdmin, 5000);
    return;
  }

  _adminUnsub = _db
    .collection('pedidos')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .onSnapshot(
      (snap) => {
        const pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderizarPedidosAdmin(pedidos);
      },
      (err) => {
        console.warn('Admin snapshot:', err);
        carregarPedidosAdmin();
      }
    );
}

// =====================================================
// INIT LOJA
// =====================================================

function initLoja() {
  Modal.fecharTodos();
  atualizarLoginUI();
  atualizarCarrinhoUI();
  setupDelegacaoCarrinho();
  initGaleriaEstampas();
  montarModalLocalizacao();
  iniciarTimersPromo();

  document.querySelector('.menu-toggle-v4')?.addEventListener('click', () => {
    document.querySelector('.nav-menu-v4')?.classList.toggle('active-v4');
  });

  document.getElementById('loginBtn')?.addEventListener('click', () => {
    if (usuarioLogado) {
      if (confirm(`Sair da conta de ${usuarioLogado.nome}?`)) {
        localStorage.removeItem('usuarioLogado');
        location.reload();
      }
      return;
    }
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotPasswordForm').style.display = 'none';
    Modal.abrir('loginModal');
  });

  document.querySelector('.close-modal')?.addEventListener('click', () => Modal.fechar('loginModal'));
  document.getElementById('loginModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'loginModal') Modal.fechar('loginModal');
  });

  document.getElementById('toggleForm')?.addEventListener('click', (e) => {
    e.preventDefault();
    const loginVisible = document.getElementById('loginForm').style.display !== 'none';
    document.getElementById('loginForm').style.display = loginVisible ? 'none' : 'block';
    document.getElementById('registerForm').style.display = loginVisible ? 'block' : 'none';
    document.getElementById('modalTitle').textContent = loginVisible ? 'Criar nova conta' : 'Entre na sua conta';
  });

  document.getElementById('loginForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('emailInput').value.trim().toLowerCase();
    const senha = document.getElementById('passwordInput').value;
    const u = usuarios.find((x) => x.email === email && x.senha === senha);
    if (!u) return alert('Email ou senha incorretos.');
    salvarSessao(u);
    atualizarLoginUI();
    Modal.fechar('loginModal');
  });

  document.getElementById('registerFormSubmit')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const novo = {
      id: Date.now(),
      nome: document.getElementById('nomeInput').value.trim(),
      email: document.getElementById('registerEmail').value.trim().toLowerCase(),
      telefone: document.getElementById('telefoneInput').value.trim(),
      endereco: document.getElementById('enderecoInput').value.trim(),
      numeroCasa: document.getElementById('numeroCasaInput').value.trim(),
      bairro: document.getElementById('bairroInput').value.trim(),
      cidade: document.getElementById('cidadeInput').value.trim(),
      estado: document.getElementById('estadoInput').value.trim(),
      cep: document.getElementById('cepInput').value.trim(),
      senha: document.getElementById('registerPassword').value,
      data: new Date().toLocaleString('pt-BR')
    };
    if (novo.senha.length < 6) return alert('Senha mínima: 6 caracteres.');
    if (usuarios.find((x) => x.email === novo.email)) return alert('Email já cadastrado.');
    usuarios.push(novo);
    localStorage.setItem('usuariosLucyModas', JSON.stringify(usuarios));
    salvarSessao(novo);
    atualizarLoginUI();
    Modal.fechar('loginModal');
    alert('✅ Conta criada!');
  });

  document.getElementById('forgotPasswordLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotPasswordForm').style.display = 'block';
    mostrarApenasRecovery('forgotPasswordRequest');
  });

  document.getElementById('forgotPasswordRequest')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const metodo = document.getElementById('recoveryMethod').value;
    let alvo = null;
    if (metodo === 'email') {
      alvo = usuarios.find((u) => u.email === document.getElementById('recoveryEmail').value.trim().toLowerCase());
    } else {
      const tel = document.getElementById('recoveryPhone').value.replace(/\D/g, '');
      alvo = usuarios.find((u) => u.telefone?.replace(/\D/g, '') === tel);
    }
    if (!alvo) return alert('Conta não encontrada.');
    _otpRecuperacao = String(Math.floor(100000 + Math.random() * 900000));
    _otpUsuarioAlvo = alvo.email;
    _otpExpiracao = Date.now() + 600000;
    alert(`Código: ${_otpRecuperacao}`);
    mostrarApenasRecovery('forgotPasswordVerify');
  });

  document.getElementById('forgotPasswordVerify')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (Date.now() > _otpExpiracao) return alert('Código expirado.');
    if (document.getElementById('recoveryOtp').value.trim() !== _otpRecuperacao) return alert('Código incorreto.');
    mostrarApenasRecovery('forgotPasswordReset');
  });

  document.getElementById('forgotPasswordReset')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const nova = document.getElementById('newPasswordInput').value;
    if (nova.length < 6) return alert('Senha mínima: 6 caracteres.');
    const idx = usuarios.findIndex((u) => u.email === _otpUsuarioAlvo);
    if (idx === -1) return alert('Erro.');
    usuarios[idx].senha = nova;
    localStorage.setItem('usuariosLucyModas', JSON.stringify(usuarios));
    alert('✅ Senha redefinida!');
    document.getElementById('forgotPasswordForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
  });

  document.getElementById('cartIcon')?.addEventListener('click', () => {
    if (!usuarioLogado) return Modal.abrir('loginModal');
    Modal.abrir('cartModal');
    atualizarCarrinhoUI();
  });

  document.querySelector('.close-cart')?.addEventListener('click', () => Modal.fechar('cartModal'));
  document.getElementById('cartModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'cartModal') Modal.fechar('cartModal');
  });

  document.getElementById('btnPagar')?.addEventListener('click', (e) => {
    e.preventDefault();
    processarPagamento();
  });

  document.getElementById('closePixModal')?.addEventListener('click', () => {
    pararMonitoramentoPagamento();
    Modal.fechar('pixModal');
  });

  document.getElementById('pixModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'pixModal') {
      pararMonitoramentoPagamento();
      Modal.fechar('pixModal');
    }
  });

  document.getElementById('copiarPixCopiaColaBtn')?.addEventListener('click', () => {
    const pix =
      document._pixCopiaColaAtual ||
      document.getElementById('pixCopiaColaInput')?.value ||
      _pedidoAtual?.pixCopiaCola;
    copiarTexto(pix, document.getElementById('copiarPixCopiaColaBtn'), '✅ PIX copiado!');

    // Removido alerta de erro ao copiar PIX.
    // O status de pagamento será mostrado quando o sistema detectar PAID (Admin/Firestore).
    // Aqui apenas confirma que o código foi copiado com sucesso.
  });


  document.querySelectorAll('.add-cart-estampas').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      abrirModalEstampas(btn.dataset.produtoId);
    });
  });

  // Proteção extra: se alguém clicar no botão sem selecionar estampa, evita erro.
// Proteção extra: se clicar em "Adicionar ao carrinho" sem selecionar estampa,
// mostramos alerta (mantém o handler principal funcionando).
document.getElementById('confirmarEstampaBtn')?.addEventListener('click', (e) => {
  if (_produtoEstampaAberto && _estampaEscolhida) return;
  e.preventDefault();
  alert('Selecione uma estampa antes de adicionar ao carrinho.');
});


  document.getElementById('fecharEstampaModal')?.addEventListener('click', fecharModalEstampas);
  document.getElementById('estampaModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'estampaModal') fecharModalEstampas();
  });
  document.getElementById('confirmarEstampaBtn')?.addEventListener('click', confirmarEstampaNoCarrinho);

  document.querySelectorAll('.add-cart-btn:not(.add-cart-estampas)').forEach((btn) => {
    btn.addEventListener('click', function () {
      const p = this.closest('.produto-v4');
      if (!p || p.classList.contains('produto-com-estampas')) return;
      adicionarAoCarrinho({
        id: p.dataset.nome,
        nome: p.dataset.nome,
        preco: parseFloat(p.dataset.preco) || 0,
        imagem: p.querySelector('.produto-img img')?.src || p.querySelector('img')?.src || '',
        abrirCarrinho: true
      });
    });
  });

  PROMOS.forEach(({ sel, id, nome, preco, img }) => {
    document.querySelectorAll(sel).forEach((btn) => {
      btn.addEventListener('click', () => adicionarAoCarrinho({ id, nome, preco, imagem: img, abrirCarrinho: true }));
    });
  });

  document.getElementById('btnLocalizacao')?.addEventListener('click', (e) => {
    e.preventDefault();
    montarModalLocalizacao();
    const m = document.getElementById('locationModal');
    if (m) m.style.display = 'flex';
  });

  document.getElementById('fecharLocalizacao')?.addEventListener('click', () => {
    const m = document.getElementById('locationModal');
    if (m) m.style.display = 'none';
  });

  document.getElementById('locationModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'locationModal') e.target.style.display = 'none';
  });
}

// =====================================================
// BOOT
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
  protegerAdmin();
  if (location.pathname.toLowerCase().includes('admin')) {
    iniciarAdminTempoReal();
  } else {
    initLoja();
  }
});

window.logout = () => {
  localStorage.removeItem('usuarioLogado');
  location.reload();
};
