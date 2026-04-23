const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// --- CONFIGURAÇÃO DO BANCO ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// FUNÇÃO ROBUSTA: Cria as tabelas uma por uma para evitar falhas no deploy
const inicializarBanco = async () => {
  const comandos = [
    `CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      status_assinatura TEXT,
      data_vencimento TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS base_jogos (
      id SERIAL PRIMARY KEY,
      casa TEXT,
      visitante TEXT,
      placar_casa INTEGER,
      placar_visitante INTEGER,
      prob_casa NUMERIC,
      prob_empate NUMERIC,
      prob_fora NUMERIC
    );`,
    `CREATE TABLE IF NOT EXISTS vitrine (
      id SERIAL PRIMARY KEY,
      confronto TEXT NOT NULL,
      hora TEXT,
      palpite TEXT,
      odd NUMERIC(10,2),
      data DATE,
      status TEXT DEFAULT 'ANDAMENTO'
    );`
  ];

  for (const sql of comandos) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error("⚠️ Aviso na criação de tabela:", err.message);
    }
  }
  console.log("✅ Tabelas verificadas/prontas.");
};

inicializarBanco();

// --- CONFIGURAÇÕES ---
const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { erro: "Muitas requisições. Tente novamente em 15 minutos." }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(limiterGeral);

const CHAVE_ADM = process.env.SENHA_ADM;
const EMAIL_MESTRE = process.env.EMAIL_ADM ? process.env.EMAIL_ADM.toLowerCase().trim() : "";

// --- ROTAS DA VITRINE ---

app.get('/obter-vitrine', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vitrine ORDER BY data DESC, id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: "Erro ao buscar vitrine" }); }
});

app.post('/salvar-palpite', async (req, res) => {
  const { confronto, hora, palpite, odd, data, status } = req.body;
  try {
    await pool.query(
      'INSERT INTO vitrine (confronto, hora, palpite, odd, data, status) VALUES ($1, $2, $3, $4, $5, $6)',
      [confronto, hora, palpite, odd, data, status || 'ANDAMENTO']
    );
    res.json({ msg: "✅ Palpite adicionado!" });
  } catch (err) { res.status(500).json({ erro: "Erro ao salvar" }); }
});

app.put('/atualizar-palpite', async (req, res) => {
  const { id, status } = req.body;
  try {
    await pool.query('UPDATE vitrine SET status = $1 WHERE id = $2', [status, id]);
    res.json({ msg: "✅ Status atualizado!" });
  } catch (err) { res.status(500).json({ erro: "Erro ao atualizar" }); }
});

app.delete('/deletar-palpite', async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query('DELETE FROM vitrine WHERE id = $1', [id]);
    res.json({ msg: "✅ Palpite removido!" });
  } catch (err) { res.status(500).json({ erro: "Erro ao deletar" }); }
});

// --- ROTA DE LOGIN ---

app.post('/validar', async (req, res) => {
  const { email } = req.body;
  try {
    const emailLimpo = email.trim().toLowerCase();
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [emailLimpo]);
    
    if (result.rows.length === 0) return res.status(404).json({ autorizado: false, msg: "E-mail não cadastrado" });

    const user = result.rows[0];
    const hoje = new Date();
    const vencimento = new Date(user.data_vencimento);

    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      res.json({ autorizado: true, is_admin: (emailLimpo === EMAIL_MESTRE) });
    } else {
      res.json({ autorizado: false, msg: "Assinatura vencida" });
    }
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

// --- ROTA ADMINISTRATIVA: ADICIONAR USUÁRIO ---
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
        res.json({ msg: `✅ Usuário ${email} atualizado!` });
    } catch (err) { res.status(500).json({ erro: "Erro ao salvar usuário." }); }
});

// --- ROTA ADMINISTRATIVA: IMPORTAR EXCEL ---
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
      await pool.query(queryText, [
        String(nomeC).trim(), 
        String(nomeV).trim(), 
        parseInt(j['Placar Casa']) || 0, 
        parseInt(j['Placar Visitante']) || 0, 
        limparNum(j['Prob, Casa (1)']), 
        limparNum(j['Prob, Empate (X)']), 
        limparNum(j['Prob, Fora (2)'])
      ]);
    }
    res.json({ msg: "🚀 Base global atualizada com sucesso!" });
  } catch (err) { res.status(500).json({ erro: "Erro na importação." }); }
});

app.get('/obter-base', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM base_jogos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: "Erro ao buscar base" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
