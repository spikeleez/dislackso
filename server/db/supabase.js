'use strict';

/**
 * Espelho do banco JSON numa única linha do Postgres do Supabase.
 *
 * Existe por um motivo bem concreto: no Render o disco é efêmero, e sem este
 * espelho todo redeploy começaria do zero — contas, servidores e conversas
 * simplesmente sumiriam. Com ele, o servidor continua sendo um arquivo JSON
 * simples, mas sobrevive a reinícios.
 *
 * É opcional: sem as credenciais, tudo funciona só com o disco local.
 *
 * REGRA DE OURO: este espelho nunca pode sobrescrever dados bons com um banco
 * vazio. Já aconteceu em produção — o `load()` falhou num redeploy (Supabase
 * hibernado, rede fria), o servidor subiu com o banco zerado, e o primeiro
 * `save()` gravou esse vazio por cima do estado de todo mundo: contas,
 * servidores e fotos, perdidos de uma vez. Por isso:
 *
 *   1. `save()` se recusa a espelhar antes de um `load()` bem-sucedido —
 *      sem saber o que há do outro lado, gravar é roleta-russa;
 *   2. `save()` se recusa a gravar um banco sem usuários por cima de um
 *      estado que já teve usuários (não existe "apagar conta" no app, então
 *      usuários indo a zero só pode ser bug ou boot vazio).
 */

const TABLE = 'app_state';

/** "fetch failed" do Node não diz o motivo; `err.cause` tem o erro de rede real. */
function describeFetchError(err) {
  const cause = err && err.cause;
  const code = cause && cause.code;
  return code ? `${err.message} (${code}: ${cause.message || code})` : err.message;
}

function createMirror({ url, key, row }) {
  const baseUrl = String(url || '').replace(/\/$/, '');
  const enabled = Boolean(baseUrl && key && typeof fetch === 'function');
  const rowId = String(row || 'main');

  const state = {
    lastError: null,
    lastOkAt: null,
    /** Já conseguimos LER o estado remoto nesta execução? Trava do save(). */
    everLoaded: false,
    /** Máximo de usuários já visto (remoto ou gravado) — detector de banco zerado. */
    highWaterUsers: 0,
  };

  if (enabled && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(baseUrl)) {
    console.warn(
      `[db] SUPABASE_URL não parece uma URL de projeto Supabase válida: "${baseUrl}" `
      + '(esperado algo como https://xxxxxxxx.supabase.co, sem barra no final).',
    );
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  /**
   * Lê o estado remoto.
   *
   * Devolve `{ ok, data }` — e não só os dados — porque o chamador precisa
   * distinguir "não há linha salva ainda" (ok, começar do zero é correto) de
   * "não consegui ler" (aí gravar por cima seria destruir o que existe).
   */
  async function load() {
    if (!enabled) return { ok: false, data: null };
    try {
      const query = `${TABLE}?id=eq.${encodeURIComponent(rowId)}&select=data`;
      const res = await fetch(`${baseUrl}/rest/v1/${query}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);

      const rows = await res.json();
      state.lastError = null;
      state.lastOkAt = new Date().toISOString();
      state.everLoaded = true;

      const data = rows[0] && rows[0].data;
      if (data && typeof data === 'object') {
        state.highWaterUsers = Math.max(state.highWaterUsers, Object.keys(data.users || {}).length);
        console.log('[db] estado restaurado do Supabase');
        return { ok: true, data };
      }
      console.log(`[db] Supabase conectado, mas ainda sem linha salva (id=${rowId}) — começando do zero.`);
      return { ok: true, data: null };
    } catch (err) {
      state.lastError = describeFetchError(err);
      console.error('[db] Supabase indisponível; usando cópia local:', state.lastError);
      return { ok: false, data: null };
    }
  }

  async function save(db) {
    if (!enabled) return;

    // As duas travas anti-catástrofe. Ver o comentário no topo do arquivo.
    if (!state.everLoaded) {
      state.lastError = 'espelhamento bloqueado: ainda não consegui ler o estado remoto '
        + '(gravar sem ler poderia sobrescrever os dados de todo mundo com um banco vazio)';
      console.error('[db]', state.lastError);
      return;
    }
    const users = Object.keys((db && db.users) || {}).length;
    if (users === 0 && state.highWaterUsers > 0) {
      state.lastError = `espelhamento bloqueado: o banco local está sem usuários, mas o remoto `
        + `já teve ${state.highWaterUsers} — isso só acontece em bug ou boot vazio, não gravo por cima`;
      console.error('[db]', state.lastError);
      return;
    }

    const body = JSON.stringify({ id: rowId, data: db, updated_at: new Date().toISOString() });
    try {
      const res = await fetch(`${baseUrl}/rest/v1/${TABLE}?on_conflict=id`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      state.lastError = null;
      state.lastOkAt = new Date().toISOString();
      state.highWaterUsers = Math.max(state.highWaterUsers, users);
    } catch (err) {
      // O tamanho entra no log de propósito: as imagens moram no banco, e um
      // payload grande demais recusado pelo Supabase é a principal suspeita
      // quando o espelhamento "para de funcionar do nada".
      state.lastError = `${describeFetchError(err)} (payload de ${(body.length / 1024 / 1024).toFixed(1)} MB)`;
      console.error('[db] falha ao espelhar no Supabase:', state.lastError);
    }
  }

  return {
    enabled,
    load,
    save,
    get lastError() {
      return state.lastError;
    },
    get lastOkAt() {
      return state.lastOkAt;
    },
    get everLoaded() {
      return state.everLoaded;
    },
  };
}

module.exports = { createMirror };
