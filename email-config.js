/**
 * EMAILJS — notificar cliente quando pagar
 * 1. https://www.emailjs.com → conta grátis
 * 2. Email Services → conectar Gmail
 * 3. Email Templates:
 *    - template_cliente_pago: para {{to_email}} assunto "Pedido pago - Lucy Modas"
 *    - template_admin_pedido: para adminlucymodas@gmail.com "Novo pedido"
 * 4. Account → Public Key
 */
window.EMAILJS_CONFIG = {
  publicKey: 'COLE_SUA_PUBLIC_KEY',
  serviceId: 'COLE_SEU_SERVICE_ID',
  templateClientePago: 'template_cliente_pago',
  templateClienteEnviado: 'template_cliente_enviado',
  templateAdminNovoPedido: 'template_admin_pedido'
};

window.EMAILJS_ATIVO =
  typeof window.EMAILJS_CONFIG?.publicKey === 'string' &&
  window.EMAILJS_CONFIG.publicKey.length > 8 &&
  !window.EMAILJS_CONFIG.publicKey.includes('COLE_SUA');
