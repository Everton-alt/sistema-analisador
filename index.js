const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configuração do Banco de Dados via Variável de Ambiente do Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// CHAVE DE SEGURANÇA ADM
const CHAVE_ADM = 'Everton2026';

// --- ROTA: WEBHOOK DO ASAAS ---
app.post('/webhook-pagamento', async (req, res) => {
    const { event, payment } = req.body;
    console.log(`Evento recebido do Asaas: ${event}`);

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_SETTLED') {
        const emailCliente = payment.customerEmail ? payment.customerEmail.toLowerCase().trim() : null;
        
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
                console.log(`✅ Acesso liberado automaticamente via Webhook: ${emailCliente}`);
            } catch (err) {
                console.error("❌ Erro no banco via webhook:", err);
            }
        }
    }
    res.status(200).send('OK');
});

// --- ROTA: ADICIONAR OU ATUALIZAR USUÁRIO MANUAL (Painel ADM) ---
app.post('/adicionar-usuario', async (req, res) => {
    const { email, senha, dias } = req.body;

    if (senha !== CHAVE_ADM) {
        return res.status(401).json({ erro: "Senha ADM incorreta" });
    }

    if (!email) return res.status(400).json({ erro: "E-mail necessário" });

    try {
        const dataVencimento = new Date();
        dataVencimento.setDate(dataVencimento.getDate() + parseInt(dias || 31));

        await pool.query(
            `INSERT INTO usuarios (email, status_assinatura, data_vencimento) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (email) 
             DO UPDATE SET status_assinatura = $2, data_vencimento = $3`,
            [email.toLowerCase().trim(), 'ativo', dataVencimento]
        );
        res.json({ msg: `✅ Usuário ${email} cadastrado/atualizado com sucesso!` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao salvar usuário no banco." });
    }
});

// --- ROTA: EXCLUIR USUÁRIO (Painel ADM) ---
app.post('/excluir-usuario', async (req, res) => {
    const { email, senha } = req.body;

    if (senha !== CHAVE_ADM) {
        return res.status(401).json({ erro: "Senha ADM incorreta" });
    }

    if (!email) return res.status(400).json({ erro: "E-mail necessário para exclusão" });

    try {
        const result = await pool.query('DELETE FROM usuarios WHERE LOWER(email) = LOWER($1)', [email.trim()]);
        
        if (result.rowCount > 0) {
            res.json({ msg: `❌ Usuário ${email} removido com sucesso!` });
        } else {
            res.status(404).json({ erro: "Usuário não encontrado na base de dados." });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao excluir usuário do banco." });
    }
});

// --- ROTA DE VALIDAÇÃO (LOGIN NO FRONTEND) ---
app.post('/validar', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ autorizado: false, msg: "E-mail obrigatório" });

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    
    if (result.rows.length === 0) {
        return res.status(404).json({ autorizado: false, msg: "E-mail não cadastrado ou pagamento pendente" });
    }

    const user = result.rows[0];
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    const vencimento = new Date(user.data_vencimento);
    vencimento.setHours(0,0,0,0);

    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      res.json({ autorizado: true, msg: "Acesso liberado!" });
    } else {
      res.json({ autorizado: false, msg: "Assinatura vencida ou inativa" });
    }
  } catch (err) { 
    console.error(err);
    res.status(500).json({ erro: "Erro interno no servidor" }); 
  }
});

// --- ROTA PARA O FRONTEND BUSCAR A BASE DE JOGOS ---
app.get('/obter-base', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM base_jogos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: "Erro ao buscar base" }); }
});

// --- ROTA PARA IMPORTAR EXCEL (COM SENHA ADM) ---
app.post('/importar-base', async (req, res) => {
  const { jogos, senha } = req.body;
  
  if (senha !== CHAVE_ADM) {
      return res.status(401).json({ erro: "Senha ADM incorreta" });
  }

  try {
    await pool.query('DELETE FROM base_jogos');
    
    for (const jogo of jogos) {
      await pool.query(
        `INSERT INTO base_jogos (casa, visitante, placar_casa, placar_visitante, prob_casa, prob_empate, prob_fora) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          jogo['Casa'] || '', 
          jogo['Visitante'] || '', 
          parseInt(jogo['Placar Casa']) || 0, 
          parseInt(jogo['Placar Visitante']) || 0, 
          parseFloat(jogo['Prob, Casa (1)']) || 0, 
          parseFloat(jogo['Prob, Empate (X)']) || 0, 
          parseFloat(jogo['Prob, Fora (2)']) || 0
        ]
      );
    }
    res.json({ msg: "🚀 Base importada com sucesso!" });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar no banco. Verifique as colunas do Excel." }); 
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Analista Pro online na porta ${PORT}`));
