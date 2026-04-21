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

// CHAVE DE SEGURANÇA ADM (Para importar Excel e validar Webhook se necessário)
const CHAVE_ADM = 'Everton2026';

// --- ROTA: WEBHOOK DO ASAAS ---
// Esta rota recebe o aviso de pagamento e cadastra o usuário sozinho!
app.post('/webhook-pagamento', async (req, res) => {
    const { event, payment } = req.body;

    // Log para você monitorar no painel do Render
    console.log(`Evento recebido do Asaas: ${event}`);

    // Verifica se o evento é de pagamento confirmado ou recebido
    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_SETTLED') {
        const emailCliente = payment.customerEmail ? payment.customerEmail.toLowerCase().trim() : null;
        
        if (emailCliente) {
            try {
                // Define data de vencimento para 31 dias a partir de hoje
                const dataVencimento = new Date();
                dataVencimento.setDate(dataVencimento.getDate() + 31);

                // Insere ou atualiza o usuário no banco de dados (POSTGRES)
                await pool.query(
                    `INSERT INTO usuarios (email, status_assinatura, data_vencimento) 
                     VALUES ($1, $2, $3) 
                     ON CONFLICT (email) 
                     DO UPDATE SET status_assinatura = $2, data_vencimento = $3`,
                    [emailCliente, 'ativo', dataVencimento]
                );
                console.log(`✅ Acesso liberado automaticamente: ${emailCliente}`);
            } catch (err) {
                console.error("❌ Erro ao processar banco no webhook:", err);
            }
        }
    }
    
    // O Asaas exige sempre resposta 200 para confirmar o recebimento
    res.status(200).send('OK');
});

// 1. ROTA DE VALIDAÇÃO (LOGIN NO FRONTEND)
app.post('/validar', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ autorizado: false, msg: "E-mail obrigatório" });

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    
    if (result.rows.length === 0) {
        return res.status(404).json({ autorizado: false, msg: "E-mail não cadastrado ou pagamento não processado" });
    }

    const user = result.rows[0];
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    const vencimento = new Date(user.data_vencimento);
    vencimento.setHours(0,0,0,0);

    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      res.json({ autorizado: true, msg: "Acesso liberado!" });
    } else {
      res.json({ autorizado: false, msg: "Assinatura pendente ou vencida" });
    }
  } catch (err) { 
    console.error(err);
    res.status(500).json({ erro: "Erro interno no servidor" }); 
  }
});

// 2. ROTA PARA O FRONTEND BUSCAR A BASE DE JOGOS
app.get('/obter-base', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM base_jogos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: "Erro ao buscar base" }); }
});

// 3. ROTA PARA IMPORTAR EXCEL (COM SENHA ADM)
app.post('/importar-base', async (req, res) => {
  const { jogos, senha } = req.body;
  
  if (senha !== CHAVE_ADM) {
      return res.status(401).json({ erro: "Senha ADM incorreta" });
  }

  try {
    // Limpa a base antiga antes de subir a nova
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
    res.json({ msg: "Base atualizada com sucesso no banco de dados!" });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar no banco. Verifique as colunas do Excel." }); 
  }
});

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Analista Pro girando na porta ${PORT}`));
