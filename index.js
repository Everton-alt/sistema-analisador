app.post('/validar', async (req, res) => {
  const { email } = req.body;
  try {
    // Busca o usuário ignorando maiúsculas/minúsculas
    const result = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [email]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ autorizado: false, msg: "E-mail não cadastrado" });
    }

    const user = result.rows[0];
    
    // Pega a data atual no fuso de Brasília (ou ajusta para meia-noite para evitar erro de horas)
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0); 

    const vencimento = new Date(user.data_vencimento);
    vencimento.setHours(0, 0, 0, 0);

    // LOG DE SEGURANÇA (Verifique isso no console do Render)
    console.log(`Verificando: ${email} | Status: ${user.status_assinatura} | Vence: ${vencimento}`);

    // CONDIÇÃO DE BLOQUEIO RIGOROSA
    if (user.status_assinatura === 'ativo' && vencimento >= hoje) {
      res.json({ autorizado: true, msg: "Acesso liberado!" });
    } else {
      let motivo = "Assinatura expirada";
      if (user.status_assinatura !== 'ativo') motivo = "Assinatura inativa ou pendente";
      
      res.status(403).json({ autorizado: false, msg: motivo });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro interno no servidor" });
  }
});
