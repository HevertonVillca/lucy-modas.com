/**
 * CONFIGURAÇÃO FIREBASE — Lucy Modas
 * 1. Acesse https://console.firebase.google.com
 * 2. Crie projeto → Firestore Database → modo produção
 * 3. Configurações do projeto → Seus apps → Web → copie o firebaseConfig
 * 4. Cole abaixo e salve este arquivo
 */
window.FIREBASE_CONFIG = {
  apiKey: 'COLE_SUA_API_KEY',
  authDomain: 'SEU_PROJETO.firebaseapp.com',
  projectId: 'SEU_PROJETO',
  storageBucket: 'SEU_PROJETO.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000'
};

/** true quando projectId foi configurado (não é placeholder) */
window.FIREBASE_ATIVO =
  typeof window.FIREBASE_CONFIG?.projectId === 'string' &&
  window.FIREBASE_CONFIG.projectId.length > 3 &&
  !window.FIREBASE_CONFIG.projectId.includes('SEU_PROJETO');
