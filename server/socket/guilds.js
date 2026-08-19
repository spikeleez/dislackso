'use strict';

/**
 * Servidores e canais.
 *
 * Servidores são privados por construção: não há busca nem diretório. A única
 * forma de entrar é com um convite, e o dono pode gerar um novo a qualquer
 * momento — o que invalida o antigo.
 */

const { cleanAssetPath, cleanText, inviteCode, uid } = require('../util');

const MAX_CHANNELS = 40;

function registerGuilds(socket, ctx) {
  const { store, guard, presence, publicGuild, io } = ctx;
  const db = () => store.data;

  const session = () => {
    const s = presence.sessions.get(socket.id);
    if (!s) throw new Error('nao autenticado');
    return s;
  };

  function requireGuild(guildId) {
    const guild = db().guilds[guildId];
    if (!guild) throw new Error('servidor inexistente');
    return guild;
  }

  /** A conta marcada como administradora do app (painel de dev) passa por qualquer dono. */
  function isAppAdmin(userId) {
    return Boolean(db().adminUserId) && userId === db().adminUserId;
  }

  function requireOwner(guildId, action) {
    const guild = requireGuild(guildId);
    const { userId } = session();
    if (guild.ownerId !== userId && !isAppAdmin(userId)) throw new Error(`Somente o dono pode ${action}.`);
    return guild;
  }

  socket.on('guild:create', ({ name } = {}, cb) => guard(cb, () => {
    const { userId } = session();
    const guild = {
      id: uid(),
      name: cleanText(name, 48, 'Meu Servidor'),
      ownerId: userId,
      invite: inviteCode(),
      icon: '',
      createdAt: Date.now(),
      members: [userId],
      // Um servidor vazio não serve para nada; já nasce com um canal de cada tipo.
      channels: [
        { id: uid(), name: 'geral', type: 'text', messages: [] },
        { id: uid(), name: 'Sala Principal', type: 'voice', messages: [] },
      ],
    };

    db().guilds[guild.id] = guild;
    store.save();
    socket.join(presence.guildRoom(guild.id));
    cb({ guild: publicGuild(guild) });
    presence.pushOnline(guild.id);
  }));

  socket.on('guild:join', ({ invite } = {}, cb) => guard(cb, () => {
    const { userId } = session();
    const code = String(invite || '').trim().toUpperCase();
    const guild = Object.values(db().guilds).find((g) => g.invite === code);
    if (!guild) throw new Error('Convite invalido ou expirado.');

    if (!guild.members.includes(userId)) {
      guild.members.push(userId);
      store.save();
    }
    socket.join(presence.guildRoom(guild.id));
    cb({ guild: publicGuild(guild) });
    presence.pushGuild(guild.id);
    presence.pushPresence(guild.id);
    presence.pushOnline(guild.id);
  }));

  socket.on('guild:update', ({ guildId, name, icon } = {}, cb) => guard(cb, () => {
    const guild = requireOwner(guildId, 'editar');
    if (name !== undefined) guild.name = cleanText(name, 48, guild.name);
    if (icon !== undefined) {
      const clean = cleanAssetPath(icon);
      if (clean === undefined) throw new Error('imagem invalida');
      guild.icon = clean;
    }
    store.save();
    cb({ guild: publicGuild(guild) });
    presence.pushGuild(guildId);
  }));

  socket.on('guild:leave', ({ guildId } = {}, cb) => guard(cb, () => {
    const { userId } = session();
    const guild = requireGuild(guildId);
    if (guild.ownerId === userId) throw new Error('O dono nao pode sair; exclua o servidor.');

    guild.members = guild.members.filter((id) => id !== userId);
    store.save();
    presence.leaveVoice(socket);
    socket.leave(presence.guildRoom(guildId));
    cb({ ok: true });
    presence.pushGuild(guildId);
    presence.pushPresence(guildId);
    presence.pushOnline(guildId);
  }));

  socket.on('guild:delete', ({ guildId } = {}, cb) => guard(cb, () => {
    requireOwner(guildId, 'excluir');
    // Avisa antes de apagar: depois do delete não há mais sala para emitir.
    io.to(presence.guildRoom(guildId)).emit('guild:deleted', { guildId });
    delete db().guilds[guildId];
    store.save();
    cb({ ok: true });
  }));

  socket.on('guild:regenInvite', ({ guildId } = {}, cb) => guard(cb, () => {
    const guild = requireOwner(guildId, 'gerar convites');
    guild.invite = inviteCode();
    store.save();
    cb({ invite: guild.invite });
    presence.pushGuild(guildId);
  }));

  // Criar canal era liberado pra qualquer membro; virou ação do dono junto
  // com o resto da administração do servidor (excluir, convidar, expulsar).
  socket.on('channel:create', ({ guildId, name, type = 'voice' } = {}, cb) => guard(cb, () => {
    const guild = requireOwner(guildId, 'criar canais');
    if (guild.channels.length >= MAX_CHANNELS) throw new Error(`Limite de ${MAX_CHANNELS} canais.`);
    if (!['voice', 'text'].includes(type)) throw new Error('tipo de canal inválido');

    guild.channels.push({
      id: uid(),
      name: cleanText(name, 32, type === 'text' ? 'novo-texto' : 'Nova Sala'),
      type,
      messages: [],
    });
    store.save();
    cb({ guild: publicGuild(guild) });
    presence.pushGuild(guildId);
    presence.pushPresence(guildId);
  }));

  socket.on('channel:delete', ({ guildId, channelId } = {}, cb) => guard(cb, () => {
    const guild = requireOwner(guildId, 'excluir salas');
    if (!guild.channels.some((c) => c.id === channelId)) throw new Error('canal inexistente');

    presence.evictVoiceRoom(guildId, channelId);
    guild.channels = guild.channels.filter((c) => c.id !== channelId);
    store.save();
    cb({ guild: publicGuild(guild) });
    presence.pushGuild(guildId);
    presence.pushPresence(guildId);
  }));

  socket.on('guild:kick', ({ guildId, userId } = {}, cb) => guard(cb, () => {
    const guild = requireOwner(guildId, 'expulsar membros');
    if (!userId || !guild.members.includes(userId)) throw new Error('essa pessoa não é membro');
    if (userId === guild.ownerId) throw new Error('O dono não pode ser expulso.');

    guild.members = guild.members.filter((id) => id !== userId);
    store.save();

    // Derruba todas as sessões do expulso neste servidor: sai da sala de voz,
    // sai da sala do socket e fica sabendo (clientes novos removem o servidor
    // da lista na hora; os antigos só param de receber eventos até relogar).
    const room = io.sockets.adapter.rooms.get(presence.guildRoom(guildId));
    for (const sid of [...(room ?? [])]) {
      const target = presence.sessions.get(sid);
      if (!target || target.userId !== userId) continue;
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      if (target.room && target.room.startsWith(`voice:${guildId}/`)) presence.leaveVoice(sock);
      sock.emit('guild:kicked', { guildId });
      sock.leave(presence.guildRoom(guildId));
    }

    cb({ ok: true });
    presence.pushGuild(guildId);
    presence.pushPresence(guildId);
    presence.pushOnline(guildId);
  }));

  /**
   * Move alguém para outra sala de voz do mesmo servidor.
   *
   * O servidor não mexe nas salas do socket: ele só avisa o cliente movido
   * (`voice:moved`), e é o cliente quem refaz o `voice:join` — assim o motor
   * de mídia dele desmonta e remonta as conexões pelo caminho normal, em vez
   * de descobrir que trocou de sala com as conexões antigas ainda de pé.
   */
  socket.on('voice:move', ({ guildId, channelId, userId } = {}, cb) => guard(cb, () => {
    const guild = requireOwner(guildId, 'mover membros');
    if (!guild.channels.some((c) => c.id === channelId && c.type !== 'text')) {
      throw new Error('sala de voz inexistente');
    }
    if (!userId || !guild.members.includes(userId)) throw new Error('essa pessoa não é membro');

    let delivered = 0;
    for (const [sid, target] of presence.sessions) {
      if (target.userId !== userId) continue;
      if (!target.room || !target.room.startsWith(`voice:${guildId}/`)) continue;
      if (target.room === presence.voiceRoom(guildId, channelId)) continue; // já está lá
      io.to(sid).emit('voice:moved', { guildId, channelId });
      delivered++;
    }
    if (!delivered) throw new Error('essa pessoa não está em uma sala de voz deste servidor');
    cb({ ok: true });
  }));
}

module.exports = { registerGuilds };
