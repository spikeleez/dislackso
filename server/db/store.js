'use strict';

/**
 * O banco: um objeto em memória, gravado em disco e (opcionalmente) espelhado
 * no Supabase.
 *
 * A gravação é agrupada em 250 ms e feita em arquivo temporário + rename. O
 * rename é atômico no sistema de arquivos — sem ele, uma queda no meio da
 * escrita deixaria um JSON truncado, ou seja, todos os dados perdidos.
 *
 * O formato está congelado em docs/CONTRATO.md.
 */

const fs = require('fs');
const path = require('path');
const { normalizeChannel } = require('./shapes');
const { createMirror } = require('./supabase');

/** Agrupa rajadas de alteração numa gravação só. */
const SAVE_DEBOUNCE_MS = 250;

/**
 * Tentativas de leitura do Supabase no boot, com os intervalos entre elas.
 * Existe porque o cenário comum de falha não é o Supabase fora do ar — é o
 * redeploy no Render acordando junto com um projeto Supabase hibernado do
 * plano gratuito. Alguns segundos de paciência resolvem; desistir na
 * primeira tentativa foi o que já apagou os dados de todo mundo.
 */
const RESTORE_RETRY_DELAYS_MS = [2000, 5000, 10000, 15000];

/** Sem sucesso no boot, continuamos tentando em segundo plano neste ritmo. */
const RESTORE_BACKGROUND_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const emptyDb = () => ({ users: {}, guilds: {}, usernames: {}, adminUserId: null, images: {} });

/** Garante as raízes e normaliza os canais de todos os servidores. */
function normalize(db) {
  const out = { ...emptyDb(), ...db };
  out.users = out.users || {};
  out.guilds = out.guilds || {};
  out.usernames = out.usernames || {};
  out.adminUserId = out.adminUserId || null;
  out.images = out.images || {};
  for (const guild of Object.values(out.guilds)) {
    guild.channels = (guild.channels || []).map(normalizeChannel);
  }
  return out;
}

/**
 * Remoto por baixo, local por cima — usado quando o Supabase só respondeu
 * DEPOIS de o servidor já estar no ar acumulando mudanças locais.
 *
 * O merge por chave é seguro aqui porque tudo é indexado por uuid: o que
 * nasceu localmente durante a janela sem Supabase não existe no remoto (sem
 * colisão), e o que existe nos dois lados está mais fresco no local.
 */
function mergeRemoteUnderLocal(remote, local) {
  const merged = normalize(remote);
  for (const key of ['users', 'guilds', 'usernames', 'images']) {
    merged[key] = { ...merged[key], ...local[key] };
  }
  merged.adminUserId = local.adminUserId || merged.adminUserId;
  return merged;
}

function createStore({ dataDir, supabase }) {
  const file = path.join(dataDir, 'db.json');
  const mirror = createMirror(supabase);

  let db = emptyDb();
  try {
    if (fs.existsSync(file)) db = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    console.error('[db] arquivo corrompido, comecando do zero:', err.message);
    db = emptyDb();
  }

  let timer = null;

  /** Escrita imediata e síncrona — só para o desligamento do processo. */
  function flushSync() {
    clearTimeout(timer);
    timer = null;
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[db] falha no flush de desligamento:', err.message);
    }
  }

  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const tmp = `${file}.tmp`;
      fs.writeFile(tmp, JSON.stringify(db, null, 2), (err) => {
        if (err) return console.error('[db] falha ao gravar:', err.message);
        fs.rename(tmp, file, (e) => e && console.error('[db] falha ao trocar:', e.message));
      });
      void mirror.save(db);
    }, SAVE_DEBOUNCE_MS);
  }

  /** Continua tentando ler o remoto depois que o servidor já subiu sem ele. */
  function retryRestoreInBackground() {
    const timerBg = setInterval(() => {
      void mirror.load().then(({ ok, data }) => {
        if (!ok) return;
        clearInterval(timerBg);
        if (data) {
          db = mergeRemoteUnderLocal(data, db);
          console.log('[db] Supabase voltou — estados remoto e local reconciliados.');
        } else {
          console.log('[db] Supabase voltou — sem linha remota, o estado local segue valendo.');
        }
        save(); // agora o mirror.save está destravado e grava o resultado
      });
    }, RESTORE_BACKGROUND_MS);
    // Não segura o processo vivo só por causa das tentativas.
    if (typeof timerBg.unref === 'function') timerBg.unref();
  }

  /**
   * Puxa o estado remoto por cima do local. Roda uma vez, antes de escutar.
   *
   * Insiste algumas vezes antes de desistir (ver RESTORE_RETRY_DELAYS_MS);
   * se mesmo assim não der, o servidor sobe com o que tem no disco e o
   * espelhamento fica BLOQUEADO (ver supabase.js) até uma leitura dar certo
   * — subir sem os dados é degradação aceitável, sobrescrevê-los não é.
   */
  async function restore() {
    if (!mirror.enabled) return;

    for (let attempt = 0; ; attempt++) {
      const { ok, data } = await mirror.load();
      if (ok) {
        if (data) db = normalize(data);
        return;
      }
      const delay = RESTORE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      console.warn(`[db] tentando o Supabase de novo em ${delay / 1000}s (tentativa ${attempt + 2})...`);
      await sleep(delay);
    }

    console.error(
      '[db] ATENÇÃO: subindo sem o estado do Supabase. O espelhamento fica bloqueado até '
      + 'conseguir ler o remoto — novas tentativas seguem em segundo plano.',
    );
    retryRestoreInBackground();
  }

  // O Render manda SIGTERM a cada deploy. Sem este flush, tudo que mudou na
  // janela do debounce (mensagem, foto, token de sessão) evapora no meio da
  // troca de versão — é uma das causas de "subiu atualização, perdi coisas".
  let shuttingDown = false;
  const onShutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    flushSync();
    void Promise.resolve(mirror.save(db)).finally(() => process.exit(0));
    // Se o espelho travar, não seguramos o desligamento para sempre.
    setTimeout(() => process.exit(0), 5000).unref();
    void signal;
  };
  process.once('SIGTERM', onShutdown);
  process.once('SIGINT', onShutdown);

  return {
    get data() {
      return db;
    },
    save,
    restore,
    /** Para o /api/health explicar sozinho por que contas somem num redeploy. */
    health() {
      return {
        guilds: Object.keys(db.guilds).length,
        users: Object.keys(db.users).length,
        supabase: mirror.enabled,
        supabaseError: mirror.lastError,
        supabaseLastOkAt: mirror.lastOkAt,
      };
    },
  };
}

module.exports = { createStore };
