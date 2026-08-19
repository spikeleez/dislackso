import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useRoom } from '@/stores/room';
import { Tile } from './Tile';
import { resolveFocus, useStageEntries } from './useStageEntries';

/**
 * A área de vídeo da sala.
 *
 * Dois modos: grade (todo mundo do mesmo tamanho) e destaque (uma tela
 * grande, o resto numa fita embaixo). A troca entre eles é animada pelo
 * `layout` do Motion — os tiles *deslizam* de um arranjo para o outro em vez
 * de sumirem e reaparecerem.
 */
export function VoiceStage() {
  const entries = useStageEntries();
  const focusId = useRoom((s) => s.focusId);
  const focus = useRoom((s) => s.focus);
  const fullscreenId = useRoom((s) => s.fullscreenId);
  const focused = resolveFocus(entries, focusId);

  const strip = focused ? entries.filter((e) => e.id !== focused.id) : [];

  return (
    // `overflow-hidden` só aqui, no container mais externo — é o suficiente
    // pra conter um tile que sofra um FLIP exagerado durante a transição de
    // layout (Motion recalcula a grade quando alguém entra/sai) e visualmente
    // "escaparia" da área da chamada por um instante; sem isto, numa janela
    // transparente ele fica flutuando fora do app até a próxima repintura.
    // Não repetir isso nos containers internos: cada célula já tem seu
    // próprio corte (ver Tile.tsx), e cortar de novo no nível da grade
    // também corta conteúdo que só está *apertado*, não escapando de verdade
    // — foi o que cortava o topo dos avatares numa grade baixa.
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
      {focused ? (
        <>
          {/*
            `grid` (e não um `div` qualquer) de propósito: um bloco comum não
            estica o Tile lá dentro — ele vira do tamanho do próprio conteúdo,
            e o `<video>` (que só sabe preencher 100% de uma altura que exista
            de verdade) cai pra altura intrínseca. O resultado era o vídeo
            aparecendo pequeno, encostado no topo, com um vão vazio embaixo
            até a fita de participantes. Grid estica a única célula por
            padrão — o mesmo motivo pelo qual o modo grade abaixo já não
            sofre disso.
          */}
          <div className="grid min-h-0 flex-1">
            <Tile key={focused.id} entry={focused} focused fullscreen={focused.id === fullscreenId} />
          </div>

          {strip.length > 0 && (
            /*
              Três decisões deliberadas nesta fita:
              - a altura externa (h-30) é maior que a das células (h-26) de
                propósito: é o orçamento da barra de rolagem horizontal. Sem
                ele, a barra aparecia POR CIMA dos tiles, roubava altura e
                forçava um scroll vertical que não deveria existir;
              - `w-max` + `mx-auto` no miolo: com poucos participantes a fita
                fica centralizada sob o destaque; com muitos ela cresce além
                da largura e o scroll horizontal assume — centralizar direto
                no container rolável cortaria o começo da lista;
              - cada célula é `grid`, não `div`: célula de grid estica o Tile
                para ocupar os 16:9 inteiros. Num bloco comum ele colapsava
                para a altura do conteúdo — o "amassado com espaço sobrando".
            */
            <div className="h-30 shrink-0 overflow-x-auto overflow-y-hidden">
              <div className="mx-auto flex h-26 w-max gap-2">
                <AnimatePresence initial={false}>
                  {strip.map((entry) => (
                    <div key={entry.id} className="grid aspect-video h-full shrink-0">
                      <Tile
                        entry={entry}
                        focused={false}
                        compact
                        fullscreen={entry.id === fullscreenId}
                        clickable
                        onClick={() => focus(entry.id)}
                      />
                    </div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </>
      ) : (
        <motion.div
          layout
          className={cn(
            'grid min-h-0 flex-1 gap-2',
            entries.length === 1 && 'grid-cols-1',
            entries.length === 2 && 'grid-cols-2',
            entries.length > 2 && 'grid-cols-2 xl:grid-cols-3',
          )}
        >
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <Tile key={entry.id} entry={entry} focused={false} fullscreen={entry.id === fullscreenId} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
