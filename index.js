// CHAVE DE SEGURANÇA (Troque 'Henrique2026' por uma senha sua)
const CHAVE_ADM = 'Henrique2026';

app.post('/importar-base', async (req, res) => {
  const { jogos, senha } = req.body;

  // Verifica se a senha está correta
  if (senha !== CHAVE_ADM) {
    return res.status(401).json({ erro: "Acesso negado: Senha de ADM incorreta" });
  }

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
    res.json({ msg: "Base atualizada com sucesso para todos os usuários!" });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao salvar no banco" });
  }
});
