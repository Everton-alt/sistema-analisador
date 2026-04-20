const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configuração do Banco de Dados
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// CHAVE DE SEGURANÇA ADM
const CHAVE_ADM = 'Henrique2026';

// 1. ROTA DE VALIDAÇÃO (LOGIN)
app.post('/validar', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [email]);
    if (result.rows.length === 0) return res.status(404).json({ autorizado: false, msg: "E-mail não cadastrado" });

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
  } catch (err) { res.status(500).json({ erro: "Erro no servidor" }); }
});

// 2. ROTA PARA BUSCAR JOGOS
app.get('/obter-base', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM base_jogos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: "Erro ao buscar base" }); }
});

// 3. ROTA PARA IMPORTAR (COM SENHA ADM)
app.post('/importar-base', async (req, res) => {
  const { jogos, senha } = req.body;
  if (senha !== CHAVE_ADM) return res.status(401).json({ erro: "Senha ADM incorreta" });

  try {
    await pool.query('DELETE FROM base_jogos');
    for (const jogo of jogos) {
      await pool.query(
        `INSERT INTO base_jogos (casa, visitante, placar_casa, placar_visitante, prob_casa, prob_empate, prob_fora) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          jogo['Casa'] || '', jogo['Visitante'] || '', 
          parseInt(jogo['Placar Casa']) || 0, parseInt(jogo['Placar Visitante']) || 0, 
          parseFloat(jogo['Prob, Casa (1)']) || 0, parseFloat(jogo['Prob, Empate (X)']) || 0, parseFloat(jogo['Prob, Fora (2)']) || 0
        ]
      );
    }
    res.json({ msg: "Base atualizada com sucesso!" });
  } catch (err) { res.status(500).json({ erro: "Erro ao salvar no banco" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sistema girando na porta ${PORT}`));
