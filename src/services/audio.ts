import type { SoundEvent } from '../game/engine';
import type { Settings } from './storage';

/** Original oscillator patches; never request or download an audio asset. */
export class Synth {
  private context?: AudioContext;
  private master?: GainNode;
  private siren?: OscillatorNode;
  private sirenGain?: GainNode;
  constructor(private settings: Settings) {}
  async unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext(); this.master = this.context.createGain(); this.master.connect(this.context.destination);
        this.siren = this.context.createOscillator(); this.siren.type = 'sine';
        this.sirenGain = this.context.createGain(); this.sirenGain.gain.value = 0;
        this.siren.connect(this.sirenGain); this.sirenGain.connect(this.master); this.siren.start(); this.configure(this.settings);
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Audio is optional, including on restricted mobile browsers. */ }
  }
  configure(settings: Settings) {
    this.settings = settings;
    if (this.master && this.context) this.master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume * .22, this.context.currentTime, .02);
  }
  background(active: boolean, time: number, frightened: boolean) {
    if (!this.context || !this.siren || !this.sirenGain) return;
    this.siren.frequency.setTargetAtTime((frightened ? 160 : 105) + 28 * Math.sin(time * 3), this.context.currentTime, .06);
    this.sirenGain.gain.setTargetAtTime(active ? .09 : 0, this.context.currentTime, .08);
  }
  play(sound: SoundEvent) {
    if (!this.context || !this.master || this.context.state !== 'running') return;
    const patches: Record<SoundEvent, number[]> = {
      dot: [720, 1050], power: [260, 520, 1040], ghost: [430, 860, 1290],
      death: [420, 260, 120, 55], start: [330, 440, 660, 880], fruit: [620, 930, 1240],
      record: [523, 659, 784, 1047, 1319], achievement: [392, 523, 659, 784, 1047, 1319], sync: [440, 660, 880],
    };
    const step = sound === 'dot' ? .035 : sound === 'record' || sound === 'achievement' ? .11 : sound === 'sync' ? .07 : .09;
    patches[sound].forEach((frequency, i) => {
      const oscillator = this.context!.createOscillator(), gain = this.context!.createGain();
      const time = this.context!.currentTime + i * step;
      oscillator.type = sound === 'death' ? 'sawtooth' : sound === 'record' || sound === 'achievement' ? 'triangle' : 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(sound === 'dot' ? .18 : .35, time + .007);
      gain.gain.exponentialRampToValueAtTime(.001, time + step * 1.8);
      oscillator.connect(gain); gain.connect(this.master!); oscillator.start(time); oscillator.stop(time + step * 2);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }
}
