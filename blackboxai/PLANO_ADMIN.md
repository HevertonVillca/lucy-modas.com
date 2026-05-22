# Plano (Correções Admin + Novo botão de usuários)

## Informação Gathered
- O projeto usa `admin.html` + `admin.js` + `admin.css` para o painel admin.
- Em `admin.html`, os botões de navegação já usam `data-tab` e o clique é tratado em `admin.js` via `document.querySelectorAll('.nav-item')`.
- Em `admin.js`, os botões de ações dentro das listas são renderizados por `renderBotoes(pedido)` e criam:
  - `button.btn-confirmar-admin[data-action="pagar"][data-id="..."]`
  - `button.btn-enviar-cliente[data-action="enviar"][data-id="..."]` e `input#rastreio-${pedidoId}`
- `admin.js` tenta tratar cliques por delegação em `setupDelegacaoEventos()` adicionando um listener de click nos containers `listaPendentes`, `listaPagos`, `listaEnviados`.
- Já existem funções globais `marcarComoPago` e `marcarComoEnviado` e um mapeamento por `data-action`.
- `script.js` contém uma lógica própria de admin antiga (`renderizarPedidosAdmin`, `btn-confirmar-pix`, `btn-enviar-cliente` etc.), que pode conflitar com o admin novo (dependendo do HTML usado).

## Problema Provável (relacionado aos prints de erro)
- Mesmo havendo funções e delegação, os “cliques que não funcionam” tipicamente acontecem quando:
  1) o container usado na delegação é diferente do id real no HTML (ou container inexistente no momento)
  2) funções não estão acessíveis no escopo que o HTML espera (onclick inline) — mas aqui o HTML não tem onclick inline; então a delegação deve bastar.
  3) há outro admin/arquivo sendo carregado (ex: `script.js` no admin) e gerando conflito.

## Plan
### 1) Correção dos botões do painel (Pending/Pagos/Enviados)
- Garantir que a delegação atue SOMENTE nos containers realmente existentes.
- Refatorar o código de ações para uma camada “profissional”:
  - `async function acaoAdminConfirmarPagamento(pedidoId)`
  - `async function acaoAdminMarcarEnviado(pedidoId, rastreio)`
- Padronizar leitura do rastreio (sem depender de ID montado incorreto).
- Após cada atualização, atualizar a UI apenas uma vez.

### 2) Novo botão “Contar pessoas com login”
- Adicionar um novo item no menu lateral (ex: `data-tab="usuarios"`).
- Criar nova aba `section id="tab-usuarios"` com:
  - contador total
  - e opcionalmente uma lista curta (email/nome) se existir dado.
- Como o app usa login via `localStorage` (`usuariosLucyModas`) no modo atual, a contagem será:
  - `usuariosLucyModas.length` (para “pessoas cadastradas”), e
ainda assim será o melhor proxy.
- Estruturar função:
  - `function calcularUsuariosRegistrados()`

### 3) Ajuste CSS/UX
- Estilo para o novo botão e nova aba usando as classes existentes.
- Estilo para cards/contador.

## Dependent Files to be edited
- `d:/luk 2/admin.html`
- `d:/luk 2/admin.js`
- `d:/luk 2/admin.css`

## Followup steps
- Abrir `admin.html` no browser, logar como admin.
- Validar clique em:
  - “Confirmar Pagamento” em Pendentes
  - “Marcar como Enviado” em Pagos
- Validar novo botão “Usuários logados/cadastrados”.

## <ask_followup_question>
Você autoriza eu seguir este plano e aplicar as alterações diretas nos arquivos `admin.html`, `admin.js`, `admin.css` para corrigir os botões e adicionar a aba/contador de pessoas com login?
</ask_followup_question>

