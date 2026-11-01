"use client";
import { playingStore, projectStore, timeStore } from "./store";
import { totalDuration } from "./timing";
import { fileUrl } from "./render";

/** Drives playback: the voice-over <audio> is the clock while it's playing. */
class Player {
  audio: HTMLAudioElement | null = null;
  private raf = 0;
  private anchorT = 0;
  private anchorPerf = 0;

  attach(audioPath: string) {
    this.pause();
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
    }
    const src = fileUrl(audioPath);
    if (!this.audio.src.endsWith(src)) this.audio.src = src;
  }

  get duration() {
    const p = projectStore.get();
    return p ? totalDuration(p) : 0;
  }

  play() {
    const p = projectStore.get();
    if (!p || !this.audio) return;
    let t = timeStore.get();
    if (t >= this.duration - 0.02) t = 0;
    this.seek(t);
    this.anchorT = t;
    this.anchorPerf = performance.now();
    if (t < p.audioDuration) this.audio.play().catch(() => {});
    playingStore.set(true);
    const tick = () => {
      const a = this.audio!;
      let now: number;
      if (!a.paused && !a.ended) {
        now = a.currentTime;
        this.anchorT = now;
        this.anchorPerf = performance.now();
      } else {
        now = this.anchorT + (performance.now() - this.anchorPerf) / 1000;
      }
      if (now >= this.duration) {
        timeStore.set(this.duration);
        this.pause();
        return;
      }
      timeStore.set(now);
      this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
    playingStore.set(false);
  }

  toggle() {
    if (playingStore.get()) this.pause();
    else this.play();
  }

  seek(t: number) {
    const d = this.duration;
    t = Math.max(0, Math.min(d, t));
    timeStore.set(t);
    this.anchorT = t;
    this.anchorPerf = performance.now();
    const p = projectStore.get();
    if (this.audio && p) {
      if (t < p.audioDuration) {
        this.audio.currentTime = t;
        if (playingStore.get() && this.audio.paused) this.audio.play().catch(() => {});
      } else this.audio.pause();
    }
  }
}

export const player = new Player();
