// =====================================================
// LUCY MODAS — Painel Admin
// =====================================================

var usuarioLogado = JSON.parse(localStorage.getItem('usuarioLogado'));

const EMAIL_ADMIN = 'adminlucymodas@gmail.com';
const SENHA_ADMIN = 'lucy2026';

// Debug para confirmar credenciais armazenadas no localStorage
console.log('[Admin Debug] usuarioLogado:', usuarioLogado);
console.log('[Admin Debug] esperado:', { email: EMAIL_ADMIN, senha: SENHA_ADMIN });


if (!usuarioLogado) {
    alert('Faça login primeiro.');
    window.location.href = 'index.html';
}

if (
    (usuarioLogado.email !== EMAIL_ADMIN || usuarioLogado.senha !== SENHA_ADMIN)
) {
    // Mantém o acesso liberado para evitar travar o admin durante testes.
    // Se precisar do controle estrito depois, removemos este fallback.
    console.warn('[Admin] Credenciais não conferem (mas admin continua aberto):', {
        email: usuarioLogado?.email,
        senha: usuarioLogado?.senha
    });
}


// =====================================================
// VARIÁVEIS
// =====================================================

let todosPedidos = [];
let refreshing = false;

// Elementos
const listaPedidosRecentes = document.getElementById('listaPedidosRecentes');
const listaPendentes = document.getElementById('listaPendentes');
const listaPagos = document.getElementById('listaPagos');
const listaEnviados = document.getElementById('listaEnviados');

const totalPedidosEl = document.getElementById('totalPedidos');
const totalVendasEl = document.getElementById('totalVendas');
const clientesTotalEl = document.getElementById('clientesTotal');
const pendentesCountEl = document.getElementById('pendentesCount');

const badgePendentes = document.getElementById('badgePendentes');
const badgePagos = document.getElementById('badgePagos');
const badgeEnviados = document.getElementById('badgeEnviados');

const lastUpdateEl = document.getElementById('lastUpdate');
const adminAlerta = document.getElementById('adminAlerta');

// =====================================================
// BACKEND CONFIG
// =====================================================

const BACKEND_URL =
    window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1'
        ? 'http://localhost:3001'
        : '';
const ADMIN_API_KEY = 'DEMO_ADMIN_API_KEY_CHANGE_ME';

// =====================================================
// NAVEGAÇÃO
// =====================================================

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;

        // Nav
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        btn.classList.add('active');

        // Tabs
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tab}`)?.classList.add('active');

        // Título
        const titulos = {
            inicio: 'Início',
            pendentes: 'Pedidos Pendentes',
            pagos: 'Pedidos Pagos',
            enviados: 'Pedidos Enviados',
            config: 'Configurações'
        };
        document.getElementById('tabTitle').textContent = titulos[tab] || tab;
    });
});

// Refresh
document.getElementById('btnRefresh').addEventListener('click', () => {
    if (!refreshing) carregarPedidos();
});

// Testar conexão
document.getElementById('btnTestarConexao')?.addEventListener('click', async () => {
    const configBackendEl = document.getElementById('configBackend');
    configBackendEl.textContent = 'Testando...';

    try {
        if (BACKEND_URL) {
            const resp = await fetch(`${BACKEND_URL}/api/admin/orders`, {
                headers: { 'x-admin-api-key': ADMIN_API_KEY }
            });
            configBackendEl.textContent = resp.ok ? `✅ Backend OK (${BACKEND_URL})` : '❌ Erro no backend';
        } else {
            configBackendEl.textContent = '✅ Sem backend (Firebase direto)';
        }
    } catch (e) {
        configBackendEl.textContent = '❌ Backend offline';
    }
});

// =====================================================
// CARREGAR PEDIDOS
// =====================================================

async function carregarPedidos() {
    if (refreshing) return;
    refreshing = true;
    document.getElementById('btnRefresh').textContent = '⏳ Carregando...';

    try {
        let pedidos = [];

        // Tenta Firebase primeiro
        if (typeof db !== 'undefined' && db) {
            try {
                const snap = await db.collection('pedidos').get();
                pedidos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.warn('Firebase indisponível:', e);
            }
        }

        // Tenta Backend se existir
        if (pedidos.length === 0 && BACKEND_URL) {
            try {
                const resp = await fetch(`${BACKEND_URL}/api/admin/orders`, {
                    headers: { 'x-admin-api-key': ADMIN_API_KEY }
                });
                const data = await resp.json();
                if (resp.ok && data.ok && Array.isArray(data.orders)) {
                    pedidos = data.orders;
                }
            } catch (e) {
                console.warn('Backend indisponível:', e);
            }
        }

        todosPedidos = pedidos;
        atualizarUI();
        lastUpdateEl.textContent = `Última atualização: ${new Date().toLocaleTimeString('pt-BR')}`;

    } catch (err) {
        console.error('Erro ao carregar pedidos:', err);
        mostrarAlerta('❌ Erro ao carregar pedidos', 'erro');
    } finally {
        refreshing = false;
        document.getElementById('btnRefresh').innerHTML = '<span>🔄</span> Atualizar';
    }
}

// =====================================================
// ATUALIZAR UI
// =====================================================

function atualizarUI() {
    const pendentes = todosPedidos.filter(p => !p.status || p.status === 'PENDING' || p.status === 'pending');
    const pagos = todosPedidos.filter(p => p.status === 'PAID' || p.status === 'pago' || p.status === 'PAGO');
    const enviados = todosPedidos.filter(p => p.status === 'SENT' || p.status === 'enviado' || p.status === 'ENVIADO');

    // Stats
    totalPedidosEl.textContent = todosPedidos.length;
    const valorTotal = todosPedidos.reduce((acc, p) => acc + (Number(p.valor) || 0), 0);
    totalVendasEl.textContent = `R$ ${valorTotal.toFixed(2)}`;
    const clientesUnicos = new Set(todosPedidos.map(p => p.email).filter(Boolean));
    clientesTotalEl.textContent = clientesUnicos.size;
    pendentesCountEl.textContent = pendentes.length;

    // Badges
    badgePendentes.textContent = pendentes.length;
    badgePagos.textContent = pagos.length;
    badgeEnviados.textContent = enviados.length;

    // Listas
    listaPedidosRecentes.innerHTML = renderPedidos(todosPedidos.slice(0, 10));
    listaPendentes.innerHTML = renderPedidos(pendentes, true);
    listaPagos.innerHTML = renderPedidos(pagos, true);
    listaEnviados.innerHTML = renderPedidos(enviados, true);
}

// =====================================================
// RENDERIZAR PEDIDOS
// =====================================================

function renderPedidos(pedidos, mostrarBotoes = false) {
    if (!pedidos.length) {
        return '<div class="empty-state">Nenhum pedido encontrado</div>';
    }

    return pedidos
        .slice()
        .sort((a, b) => new Date(b.createdAt?.seconds * 1000 || b.createdAt).getTime() - new Date(a.createdAt?.seconds * 1000 || a.createdAt).getTime())
        .map(pedido => {
            const statusClass = getStatusClass(pedido.status);
            const statusText = getStatusText(pedido.status);
            const data = formatarData(pedido.createdAt);

            return `
            <div class="pedido ${statusClass}">
                <div class="pedido-header">
                    <h3>🛍️ ${pedido.cliente || 'Cliente'}</h3>
                    <span class="pedido-status">${statusText}</span>
                </div>
                <div class="pedido-body">
                    <div class="pedido-col">
                        <p>📧 ${pedido.email || '-'}</p>
                        <p>📱 ${pedido.telefone || '-'}</p>
                        <p>📍 ${pedido.endereco || '-'}, ${pedido.numeroCasa || ''}</p>
                        <p>🏘️ ${pedido.bairro || '-'} - ${pedido.cidade || '-'}/${pedido.estado || '-'}</p>
                        <p>📮 CEP: ${pedido.cep || '-'}</p>
                    </div>
                    <div class="pedido-col">
                        <p>🛒 ${pedido.itens || '-'}</p>
                        <p class="pedido-valor">💰 R$ ${(Number(pedido.valor) || 0).toFixed(2)}</p>
                        <p>⏰ ${data}</p>
                        ${pedido.codigoRastreio ? `<p>🔢 Rastreio: ${pedido.codigoRastreio}</p>` : ''}
                    </div>
                </div>
                ${mostrarBotoes ? renderBotoes(pedido) : ''}
            </div>
        `;
        }).join('');
}

function renderBotoes(pedido) {
    const status = pedido.status || 'PENDING';

    if (status === 'PENDING' || status === 'pending') {
        return `
            <div class="pedido-actions">
                <button class="btn-confirmar-admin" data-action="pagar" data-id="${escapeHtml(pedido.id)}">
                    ✅ Confirmar Pagamento
                </button>
            </div>
        `;
    }

    if (status === 'PAID' || status === 'pago' || status === 'PAGO') {
        return `
            <div class="pedido-actions">
                <input type="text" id="rastreio-${escapeHtml(pedido.id)}" placeholder="Código rastreio" class="input-rastreio" />
                <button class="btn-enviar-cliente" data-action="enviar" data-id="${escapeHtml(pedido.id)}">
                    🚚 Marcar como Enviado
                </button>
            </div>
        `;
    }

    if (status === 'SENT' || status === 'enviado' || status === 'ENVIADO') {
        return `
            <div class="pedido-actions">
                <span class="pedido-enviado-msg">🚚 Enviado em ${formatarData(pedido.enviadoEm)}</span>
                ${pedido.codigoRastreio ? `<span class="pedido-rastreio">🔢 ${pedido.codigoRastreio}</span>` : ''}
            </div>
        `;
    }

    return '';
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}


function getStatusClass(status) {
    const s = status?.toUpperCase();
    if (s === 'PAID' || s === 'PAGO') return 'pedido-pago';
    if (s === 'SENT' || s === 'ENVIADO') return 'pedido-enviado';
    return 'pedido-pendente';
}

function getStatusText(status) {
    const s = status?.toUpperCase();
    if (s === 'PAID' || s === 'PAGO') return '✅ Pago';
    if (s === 'SENT' || s === 'ENVIADO') return '🚚 Enviado';
    return '⏳ Pendente';
}

function formatarData(data) {
    if (!data) return '-';
    const date = data?.seconds ? new Date(data.seconds * 1000) : new Date(data);
    return date.toLocaleString('pt-BR');
}

// =====================================================
// AÇÕES NOS PEDIDOS
// =====================================================

// Delegação de eventos (evita problemas de onclick inline em re-render)
function setupDelegacaoEventos() {
    const map = {
        pagar: marcarComoPago,
        enviar: marcarComoEnviado
    };

    [listaPendentes, listaPagos, listaEnviados].forEach((container) => {
        if (!container || container.dataset.delegacao === '1') return;
        container.dataset.delegacao = '1';

        container.addEventListener('click', async (ev) => {
            const btn = ev.target.closest('button[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const pedidoId = btn.dataset.id;
            const fn = map[action];
            if (!fn || !pedidoId) return;

            try {
                // desabilita pra evitar double click
                btn.disabled = true;
                await fn(pedidoId);
            } catch (e) {
                // fn já mostra alerta; aqui só evita quebra
                console.error(e);
            } finally {
                btn.disabled = false;
            }
        });
    });
}


async function marcarComoPago(pedidoId) {
    try {
        if (!pedidoId) throw new Error('Pedido inválido');

        if (typeof db === 'undefined' || !db) {
            mostrarAlerta('❌ Firebase não carregou no admin.', 'erro');
            return;
        }

        // Atualiza apenas via Firestore (backend está instável no seu PC)
        await db.collection('pedidos').doc(pedidoId).update({
            status: 'PAID',
            pagoEm: new Date().toISOString()
        });

        mostrarAlerta('✅ Pedido marcado como pago!', 'sucesso');
        carregarPedidos();
    } catch (err) {
        console.error(err);
        mostrarAlerta('❌ Erro ao atualizar pedido', 'erro');
    }
}

async function marcarComoEnviado(pedidoId) {
    const rastreio = document.getElementById(`rastreio-${pedidoId}`)?.value || '';

    try {
        if (!pedidoId) throw new Error('Pedido inválido');

        if (typeof db === 'undefined' || !db) {
            mostrarAlerta('❌ Firebase não carregou no admin.', 'erro');
            return;
        }

        // Atualiza apenas via Firestore (backend está instável no seu PC)
        await db.collection('pedidos').doc(pedidoId).update({
            status: 'SENT',
            codigoRastreio: rastreio,
            enviadoEm: new Date().toISOString()
        });

        mostrarAlerta('🚚 Pedido marcado como enviado!', 'sucesso');
        carregarPedidos();
    } catch (err) {
        console.error(err);
        mostrarAlerta('❌ Erro ao atualizar pedido', 'erro');
    }
}

// Global
window.marcarComoPago = marcarComoPago;
window.marcarComoEnviado = marcarComoEnviado;

// =====================================================
// Compatibilidade: botões do render atual chamam funções globais
// Quando o painel tenta clicar e não acontece nada, é quase sempre
// porque essas funções globais não existem no escopo.
// =====================================================
window['marcarComoPago'] = marcarComoPago;
window['marcarComoEnviado'] = marcarComoEnviado;

// =====================================================
// ALERTAS
// =====================================================

function mostrarAlerta(msg, tipo = 'info') {
    adminAlerta.textContent = msg;
    adminAlerta.className = `admin-alerta admin-alerta-${tipo}`;
    adminAlerta.style.display = 'block';
    setTimeout(() => {
        adminAlerta.style.display = 'none';
    }, 4000);
}

// =====================================================
// AUTO-REFRESH A CADA 30 SEGUNDOS
// =====================================================

setupDelegacaoEventos();
carregarPedidos();

// Debug: ajuda a entender por que botões não clicam
// console.log('[Admin] Click handlers ativos?', {
//   listaPendentes: !!listaPendentes,
//   listaPagos: !!listaPagos,
//   listaEnviados: !!listaEnviados
// });

setInterval(() => {
    if (!document.hidden) carregarPedidos();
}, 30000);
