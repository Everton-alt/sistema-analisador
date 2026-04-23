const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Puxando as chaves que você configurou no painel do Render
const CHAVE_ADM = process.env.SENHA_ADM;
const EMAIL_MESTRE = process.env.EMAIL_ADM ? process.env.EMAIL_ADM.toLowerCase().trim() : "";

// --- ROTA DE VALIDAÇÃO (SEGURA) ---
app.post('/validar', async (req, res) => {
  const { email } = req.body;
  try {
    const emailLimpo = email.trim().toLowerCase();
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [emailLimpo]);
    
    if (result.rows.length === 0) return res.status(404).json({ autorizado: false, msg: "E-mail não cadastrado" });

    const user = result.rows[0];
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    const vencimento = new Date(user.data_vencimento);

    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      // O servidor decide se o cara é ADM ou não
      const isAdmin = (emailLimpo === EMAIL_MESTRE);
      res.json({ autorizado: true, is_admin: isAdmin, msg: "Acesso liberado!" });
    } else {
      res.json({ autorizado: false, msg: "Assinatura vencida" });
    }
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

// --- ROTA: WEBHOOK DO ASAAS ---
app.post('/webhook-pagamento', async (req, res) => {
    const { event, payment } = req.body;
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_SETTLED') {
        let emailBruto = payment.customerEmail || (payment.customer ? payment.customer.email : null) || payment.email;
        const emailCliente = emailBruto ? emailBruto.toLowerCase().trim() : null;
        if (emailCliente) {
            try {
                const dataVencimento = new Date();
                dataVencimento.setDate(dataVencimento.getDate() + 31);
                await pool.query(
                    `INSERT INTO usuarios (email, status_assinatura, data_vencimento) 
                     VALUES ($1, $2, $3) ON CONFLICT (email) 
                     DO UPDATE SET status_assinatura = $2, data_vencimento = $3`,
                    [emailCliente, 'ativo', dataVencimento]
                );
            } catch (err) { console.error("Erro webhook:", err.message); }
        }
    }
    res.status(200).send('OK');
});

// --- ROTA: ADICIONAR/ATUALIZAR MANUAL ---
app.post('/adicionar-usuario', async (req, res) => {
    const { email, senha, dias } = req.body;
    if (senha !== CHAVE_ADM) return res.status(401).json({ erro: "Senha ADM incorreta" });
    try {
        const dataVencimento = new Date();
        dataVencimento.setDate(dataVencimento.getDate() + parseInt(dias || 31));
        await pool.query(
            `INSERT INTO usuarios (email, status_assinatura, data_vencimento) 
             VALUES ($1, $2, $3) ON CONFLICT (email) 
             DO UPDATE SET status_assinatura = $2, data_vencimento = $3`,
            [email.toLowerCase().trim(), 'ativo', dataVencimento]
        );
        res.json({ msg: `✅ Usuário atualizado!` });
    } catch (err) { res.status(500).json({ erro: "Erro ao salvar." }); }
});

// --- ROTA BUSCAR BASE ---
app.get('/obter-base', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM base_jogos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: "Erro ao buscar base" }); }
});

// --- ROTA IMPORTAR EXCEL ---
app.post('/importar-base', async (req, res) => {
  const { jogos, senha } = req.body;
  if (senha !== CHAVE_ADM) return res.status(401).json({ erro: "Senha ADM incorreta" });
  try {
    await pool.query('TRUNCATE TABLE base_jogos RESTART IDENTITY');
    const queryText = `INSERT INTO base_jogos (casa, visitante, placar_casa, placar_visitante, prob_casa, prob_empate, prob_fora) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    const limparNum = (v) => typeof v === 'string' ? parseFloat(v.replace(',', '.')) || 0 : parseFloat(v) || 0;
    for (const j of jogos) {
      const nomeC = j['Equipe Casa'] || j['Casa'];
      const nomeV = j['Equipe Visitante'] || j['Visitante'];
      if (!nomeC || !nomeV) continue;
      await pool.query(queryText, [String(nomeC).trim(), String(nomeV).trim(), parseInt(j['Placar Casa']) || 0, parseInt(j['Placar Visitante']) || 0, limparNum(j['Prob, Casa (1)']), limparNum(j['Prob, Empate (X)']), limparNum(j['Prob, Fora (2)'])]);
    }
    res.json({ msg: "🚀 Base importada com sucesso!" });
  } catch (err) { res.status(500).json({ erro: "Erro ao salvar." }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Online na porta ${PORT}`));
