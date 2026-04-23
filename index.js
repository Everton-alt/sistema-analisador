const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

// --- CONFIGURAÇÃO DO BANCO ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// FUNÇÃO DE AUTO-SETUP: Cria as tabelas se não existirem
const inicializarBanco = async () => {
  const comandos = [
    `CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, email TEXT UNIQUE, status_assinatura TEXT, data_vencimento TIMESTAMP);`,
    `CREATE TABLE IF NOT EXISTS base_jogos (id SERIAL PRIMARY KEY, casa TEXT, visitante TEXT, placar_casa INTEGER, placar_visitante INTEGER, prob_casa NUMERIC, prob_empate NUMERIC, prob_fora NUMERIC);`,
    `CREATE TABLE IF NOT EXISTS vitrine (id SERIAL PRIMARY KEY, confronto TEXT NOT NULL, hora TEXT, palpite TEXT, odd NUMERIC(10,2), data DATE, status TEXT DEFAULT 'ANDAMENTO');`
  ];
  try {
    const client = await pool.connect();
    for (const sql of comandos) { await client.query(sql); }
    client.release();
    console.log("✅ Banco de dados sincronizado.");
  } catch (err) { 
    console.error("❌ Erro no banco:", err.message); 
  }
};

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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
    res.json({ msg: "✅ Palpite salvo!" });
  } catch (err) { res.status(500).json({ erro: "Erro ao salvar" }); }
});

app.put('/atualizar-palpite', async (req, res) => {
  const { id, status } = req.body;
  try {
    await pool.query('UPDATE vitrine SET status = $1 WHERE id = $2', [status, id]);
    res.json({ msg: "✅ Status atualizado!" });
  } catch (err) { res.status(500).json({ erro: "Erro ao atualizar" }); }
});

// --- ROTA DE LOGIN ---
app.post('/validar', async (req, res) => {
  const { email } = req.body;
  const EMAIL_MESTRE = process.env.EMAIL_ADM ? process.env.EMAIL_ADM.toLowerCase().trim() : "";
  try {
    const emailLimpo = email.trim().toLowerCase();
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [emailLimpo]);
    if (result.rows.length === 0) return res.status(404).json({ autorizado: false, msg: "E-mail não cadastrado" });
    const user = result.rows[0];
    const hoje = new Date();
    const vencimento = new Date(user.data_vencimento);
    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      res.json({ autorizado: true, is_admin: (emailLimpo === EMAIL_MESTRE) });
    } else { res.json({ autorizado: false, msg: "Vencido" }); }
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  inicializarBanco();
});
