const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ROTA DE VALIDAÇÃO (SITE E APK CONSULTAM AQUI)
app.post('/validar', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ autorizado: false, msg: "E-mail não encontrado" });

    const user = result.rows[0];
    const hoje = new Date();
    const vencimento = new Date(user.data_vencimento);

    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      res.json({ autorizado: true, msg: "Acesso liberado!" });
    } else {
      res.json({ autorizado: false, msg: "Assinatura expirada ou pendente" });
    }
  } catch (err) { res.status(500).send("Erro no servidor"); }
});

// ROTA WEBHOOK (O ASAAS AVISA AQUI)
app.post('/webhook-asaas', async (req, res) => {
  const { event, payment } = req.body;

  // Se o pagamento foi confirmado ou recebido
  if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
    const emailCliente = payment.customer ? await buscarEmailNoAsaas(payment.customer) : null; 
    // Nota: O ideal é o cliente já estar cadastrado ou você capturar o e-mail do campo 'email' do payload do Asaas
    const emailFinal = payment.externalReference || payment.customer; // O Asaas envia o e-mail se configurado

    console.log(`Pagamento confirmado para: ${emailFinal}`);

    // Atualiza o banco para 30 dias de acesso
    await pool.query(
      "UPDATE usuarios SET status_assinatura = 'ativo', data_vencimento = CURRENT_DATE + INTERVAL '30 days' WHERE email = $1",
      [emailFinal]
    );
  }
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sistema rodando na porta ${PORT}`));
