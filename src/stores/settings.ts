import { create } from 'zustand';
import { storage, KEYS } from '@/lib/storage';
import { contrastOn, hexToRgba } from '@/lib/format';
import { isDesktop } from '@/lib/platform';

export const THEMES = [
  { id: 'escuro', name: 'Escuro', colors: ['#17181b', '#2b2d31', '#313338'] },
  { id: 'meianoite', name: 'Meia-noite', colors: ['#000000', '#101114', '#1e1f24'] },
  { id: 'nebula', name: 'Nébula', colors: ['#14121f', '#221d34', '#322a4f'] },
  { id: 'claro', name: 'Claro', colors: ['#e3e5e8', '#f7f8f9', '#ffffff'] },
] as const;

export const ACCENTS = [
  '#5865f2', '#3ba55c', '#eb459e', '#faa61a',
  '#ed4245', '#00a8fc', '#9b59b6', '#1abc9c',
] as const;

export interface SettingsValues {
  // aparência
  theme: string;
  accent: string;
  radius: number;
  glass: number;
  // movimento
  motion: 'on' | 'off';
  motionSpeed: number;
  gpu: 'on' | 'off';
  // transmissão
  quality: string;
  contentHint: 'motion' | 'detail';
  autoFocus: boolean;
  selfPreview: boolean;
  shareSystemAudio: boolean;
  // áudio
  micId: string;
  speakerId: string;
  micGain: number;
  rnnoise: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  micMode: 'voz' | 'ptt';
  duckVoiceOnShare: string | boolean;
  /**
   * Mudo e ensurdecido são escolhas que PERSISTEM entre chamadas: os botões
   * ficam fixos no cartão da conta, valem fora de sala, e entrar numa call
   * respeita como eles estavam — quem saiu mutado entra mutado, quem estava
   * pra falar entra falando.
   */
  micMuted: boolean;
  soundOff: boolean;
  // atalhos
  muteKey: string;
  screenKey: string;
  pttKey: string;
  annotKey: string;
  // aplicativo
  autoUpdate: boolean;
  feedbackSounds: boolean;
  // anotações
  annotAllow: boolean;
  annotFade: number;
  annotColor: string;
  annotSize: number;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: 'escuro', accent: '#5865f2', radius: 1, glass: 0.74,
  motion: 'on', motionSpeed: 1, gpu: 'on',
  quality: '1080p60', contentHint: 'motion', autoFocus: true, selfPreview: true, shareSystemAudio: true,
  micId: '', speakerId: '', micGain: 1, rnnoise: true,
  echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  micMode: 'voz', duckVoiceOnShare: 'duck25', micMuted: false, soundOff: false,
  muteKey: 'KeyM', screenKey: 'KeyS', pttKey: 'Space', annotKey: 'KeyP',
  autoUpdate: true, feedbackSounds: true,
  annotAllow: true, annotFade: 8, annotColor: '#ff3b5c', annotSize: 4,
};

interface SettingsStore extends SettingsValues {
  set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void;
  patch(values: Partial<SettingsValues>): void;
  reset(): void;
}

/**
 * Persistência à mão, e não com o middleware `persist`, de propósito: o
 * middleware envelopa o estado em `{ state, version }` e o 3.x gravou um
 * objeto plano em `dsx:settings`. Manter o formato é o que faz quem já usa o
 * app abrir a 4.0 com as preferências dele intactas.
 */
function loadStored(): SettingsValues {
  return { ...DEFAULT_SETTINGS, ...storage.get<Partial<SettingsValues>>(KEYS.settings, {}) };
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  ...loadStored(),

  set(key, value) {
    if (get()[key] === value) return;
    set({ [key]: value } as Partial<SettingsStore>);
    persistAndApply(get());
  },

  patch(values) {
    set(values as Partial<SettingsStore>);
    persistAndApply(get());
  },

  reset() {
    set({ ...DEFAULT_SETTINGS });
    persistAndApply(get());
  },
}));

function persistAndApply(state: SettingsStore): void {
  // O store tem métodos além dos valores; grava só o que é preferência.
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    values[key] = state[key as keyof SettingsValues];
  }
  storage.set(KEYS.settings, values);
  applySettings(values as unknown as SettingsValues);
}

/** Escreve as preferências no `<html>` — daí o CSS faz todo o resto. */
export function applySettings(v: SettingsValues = useSettings.getState()): void {
  const root = document.documentElement;
  root.dataset.theme = v.theme;
  root.dataset.motion = v.motion;
  root.dataset.gpu = v.gpu;
  if (isDesktop()) root.dataset.desktop = '1';

  root.style.setProperty('--color-accent', v.accent);
  root.style.setProperty('--color-accent-soft', hexToRgba(v.accent, 0.16));
  root.style.setProperty('--color-accent-fg', contrastOn(v.accent));
  root.style.setProperty('--radius-scale', String(v.radius));
  root.style.setProperty('--glass-alpha', String(v.glass));
  root.style.setProperty('--speed', v.motion === 'off' ? '0.001' : String(v.motionSpeed));
}

/** Leitura fora do React (o motor de mídia usa isso). */
export const settings = (): SettingsValues => useSettings.getState();
