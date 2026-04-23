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

const CHAVE_ADM = 'Everton2026';

// --- ROTA: WEBHOOK DO ASAAS ---
app.post('/webhook-pagamento', async (req, res) => {
    const { event, payment } = req.body;
    console.log(`Evento recebido do Asaas: ${event}`);

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_SETTLED') {
        let emailBruto = payment.customerEmail || 
                         (payment.customer ? payment.customer.email : null) || 
                         payment.email;

        const emailCliente = emailBruto ? emailBruto.toLowerCase().trim() : null;
        
        if (emailCliente) {
            try {
                const dataVencimento = new Date();
                dataVencimento.setDate(dataVencimento.getDate() + 31);

                await pool.query(
                    `INSERT INTO usuarios (email, status_assinatura, data_vencimento) 
                     VALUES ($1, $2, $3) 
                     ON CONFLICT (email) 
                     DO UPDATE SET status_assinatura = $2, data_vencimento = $3`,
                    [emailCliente, 'ativo', dataVencimento]
                );
                console.log(`✅ Acesso liberado automaticamente: ${emailCliente}`);
            } catch (err) {
                console.error("❌ Erro no banco via webhook:", err.message);
            }
        }
    }
    res.status(200).send('OK');
});

// --- ROTA: ADICIONAR/ATUALIZAR MANUAL ---
app.post('/adicionar-usuario', async (req, res) => {
    const { email, senha, dias } = req.body;
    if (senha !== CHAVE_ADM) return res.status(401).json({ erro: "Senha ADM incorreta" });
    if (!email) return res.status(400).json({ erro: "E-mail necessário" });

    try {
        const dataVencimento = new Date();
        dataVencimento.setDate(dataVencimento.getDate() + parseInt(dias || 31));
        await pool.query(
            `INSERT INTO usuarios (email, status_assinatura, data_vencimento) 
             VALUES ($1, $2, $3) ON CONFLICT (email) 
             DO UPDATE SET status_assinatura = $2, data_vencimento = $3`,
            [email.toLowerCase().trim(), 'ativo', dataVencimento]
        );
        res.json({ msg: `✅ Usuário ${email} atualizado!` });
    } catch (err) { res.status(500).json({ erro: "Erro ao salvar." }); }
});

// --- ROTA DE VALIDAÇÃO ---
app.post('/validar', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (result.rows.length === 0) return res.status(404).json({ autorizado: false, msg: "E-mail não cadastrado" });

    const user = result.rows[0];
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    const vencimento = new Date(user.data_vencimento);

    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      res.json({ autorizado: true, msg: "Acesso liberado!" });
    } else {
      res.json({ autorizado: false, msg: "Assinatura vencida" });
    }
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

// --- ROTA BUSCAR BASE ---
app.get('/obter-base', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM base_jogos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: "Erro ao buscar base" }); }
});

// --- ROTA IMPORTAR EXCEL (CORRIGIDA) ---
app.post('/importar-base', async (req, res) => {
  const { jogos, senha } = req.body;
  if (senha !== CHAVE_ADM) return res.status(401).json({ erro: "Senha ADM incorreta" });

  try {
    await pool.query('TRUNCATE TABLE base_jogos RESTART IDENTITY');
    
    const queryText = `
      INSERT INTO base_jogos (casa, visitante, placar_casa, placar_visitante, prob_casa, prob_empate, prob_fora) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    const limparNum = (val) => {
        if (typeof val === 'string') return parseFloat(val.replace(',', '.')) || 0;
        return parseFloat(val) || 0;
    };

    // Processa os jogos
    for (const jogo of jogos) {
      // AJUSTE DOS NOMES DAS COLUNAS CONFORME SUA PLANILHA
      const nomeCasa = jogo['Equipe Casa'] || jogo['Casa'];
      const nomeVisitante = jogo['Equipe Visitante'] || jogo['Visitante'];

      if (!nomeCasa || !nomeVisitante) continue;

      const valores = [
        String(nomeCasa).trim(),
        String(nomeVisitante).trim(),
        parseInt(jogo['Placar Casa']) || 0,
        parseInt(jogo['Placar Visitante']) || 0,
        limparNum(jogo['Prob, Casa (1)']),
        limparNum(jogo['Prob, Empate (X)']),
        limparNum(jogo['Prob, Fora (2)'])
      ];

      await pool.query(queryText, valores);
    }
    res.json({ msg: "🚀 Base importada com sucesso!" });
  } catch (err) { 
    console.error("Erro SQL:", err.message);
    res.status(500).json({ erro: "Erro ao salvar no banco." }); 
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Analista Pro online na porta ${PORT}`));
