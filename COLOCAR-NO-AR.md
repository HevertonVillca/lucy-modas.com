# Lucy Modas 2.0 — Colocar no ar com domínio

## Login do administrador

| Campo | Valor |
|--------|--------|
| **Gmail** | `adminlucymodas@gmail.com` |
| **Senha** | `lucy modas` |

Use esses dados em **Entrar** na loja. Depois acesse o ícone de escudo → `admin.html`.

---

## Passo 1 — Domínio (onde comprar)

Sugestões de nome para **Lucy Modas 2.0**:

- `lucymodas2.com.br` (Registro.br)
- `lucymodas20.com.br`
- `loja.lucymodas.com.br` (se já tiver lucymodas.com.br)

Sites para comprar: [Registro.br](https://registro.br), GoDaddy, Hostinger.

---

## Passo 2 — Firebase (site + banco de pedidos)

1. https://console.firebase.google.com → **Criar projeto** → nome: `lucy-modas-2`
2. **Firestore** → Criar banco → modo produção
3. **Regras** → publicar o arquivo `firestore.rules` do projeto
4. **Configurações** → Seus apps → **Web** → copiar `firebaseConfig` → colar em `firebase-config.js`
5. No terminal, na pasta `d:\luk 2`:

```powershell
cd "d:\luk 2"
npm install
copy .firebaserc.example .firebaserc
```

Edite `.firebaserc` e troque `SEU_PROJECT_ID_AQUI` pelo **projectId** do Firebase (ex: `lucy-modas-2`).

```powershell
npx firebase login
npx firebase deploy --only hosting,firestore:rules
```

Site gratuito ficará em: `https://lucy-modas-2.web.app` (ou o ID do seu projeto).

---

## Passo 3 — Domínio personalizado no Firebase

1. Firebase Console → **Hosting** → **Adicionar domínio personalizado**
2. Digite: `www.lucymodas2.com.br` (o domínio que você comprou)
3. O Firebase mostra registros **DNS** (tipo A e TXT)
4. No painel do Registro.br / GoDaddy → **DNS** → cole os registros que o Firebase pedir
5. Aguarde 24–48h (às vezes algumas horas) → site no ar com HTTPS

---

## Passo 4 — E-mail automático (opcional)

Siga `CONFIGURAR-EMAIL.txt` e preencha `email-config.js` (EmailJS grátis).

---

## Passo 5 — Vídeo da loja

```powershell
cd "d:\luk 2"
.\copiar-video.ps1
```

Depois rode de novo: `npx firebase deploy --only hosting`

---

## Comandos rápidos

| Ação | Comando |
|------|---------|
| Instalar ferramentas | `npm install` |
| Testar local | `npx firebase serve --only hosting` |
| Publicar site | `npm run deploy` |
| Login Firebase | `npm run login` |

---

## Importante

- **Não abra** o site só com duplo clique no HTML — use o link do Firebase Hosting ou Live Server.
- O **backend** (`backend/`) é opcional; com Firebase configurado, pedidos e admin funcionam sem `localhost:3001`.
- Troque a senha do admin depois de ir ao ar, se quiser mais segurança.
