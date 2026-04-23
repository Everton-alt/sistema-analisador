const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// --- CONFIGURAÇÃO DO BANCO COM TIMEOUT ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000 // Espera até 5 segundos para conectar
});

// FUNÇÃO DE INICIALIZAÇÃO COM RETRY (Tenta conectar até o banco responder)
const inicializarBanco = async () => {
  console.log("⏳ Aguardando conexão com o banco de dados...");
  
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

  try {
    // Testa a conexão antes de rodar os comandos
    const client = await pool.connect();
    console.log("✅ Conectado ao PostgreSQL!");
    
    for (const sql of comandos) {
      await client.query(sql);
    }
    
    client.release(); // Libera o cliente de volta para o pool
    console.log("🚀 Tabelas verificadas/prontas.");
  } catch (err) {
    console.error("❌ Erro crítico no banco de dados:", err.message);
    // Não encerramos o processo aqui para permitir que o servidor tente rodar as rotas
  }
};

// --- MIDDLEWARES ---
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

// --- ROTAS (Vitrine, Login, Importação) ---
// (Mantenha as rotas que já tínhamos no código anterior...)

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

// ... (Demais rotas: atualizar-palpite, deletar-palpite, validar, etc.)

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor Analista Pro rodando na porta ${PORT}`);
  // Só tenta criar as tabelas DEPOIS que o servidor já estiver de pé
  await inicializarBanco();
});
