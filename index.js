const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Necessário para o Render
});

// ROTA DE VALIDAÇÃO (O APK vai chamar isso aqui)
app.post('/validar', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ autorizado: false, msg: "Usuário não cadastrado" });
    }

    const user = result.rows[0];
    const hoje = new Date();
    const vencimento = new Date(user.data_vencimento);

    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      res.json({ autorizado: true, msg: "Acesso liberado!" });
    } else {
      res.json({ autorizado: false, msg: "Assinatura vencida" });
    }
  } catch (err) {
    res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
