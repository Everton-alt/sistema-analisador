const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// --- CONFIGURAÇÃO DE SEGURANÇA (RATE LIMIT) ---

// Limitador Geral: 100 requisições a cada 15 minutos por IP
const limiterGeral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { erro: "Muitas requisições. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limitador de Força Bruta (ADM): Apenas 5 tentativas por hora para rotas sensíveis
const limiterADM = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { erro: "Bloqueio de segurança: Muitas tentativas de acesso administrativo." }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(limiterGeral); // Aplica o limite geral em todas as rotas

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Chaves do Cofre do Render
const CHAVE_ADM = process.env.SENHA_ADM;
const EMAIL_MESTRE = process.env.EMAIL_ADM ? process.env.EMAIL_ADM.toLowerCase().trim() : "";

// --- ROTA DE VALIDAÇÃO DE LOGIN ---
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
      // O servidor valida se é o e-mail mestre configurado no Render
      const isAdmin = (emailLimpo === EMAIL_MESTRE);
      res.json({ autorizado: true, is_admin: isAdmin, msg: "Acesso liberado!" });
    } else {
      res.json({ autorizado: false, msg: "Assinatura vencida" });
    }
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

// --- ROTA ADMINISTRATIVA: ADICIONAR USUÁRIO (PROTEGIDA) ---
app.post('/adicionar-usuario', limiterADM, async (req, res) => {
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

// --- ROTA ADMINISTRATIVA: IMPORTAR EXCEL (PROTEGIDA) ---
app.post('/importar-base', limiterADM, async (req, res) => {
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

// --- ROTA PÚBLICA: OBTER DADOS PARA ANÁLISE ---
app.get('/obter-base', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM base_jogos ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: "Erro ao buscar base" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Analista Pro rodando na porta ${PORT}`));
