import {
  englishCoachCorrectionSpeech,
  parseEnglishCoachResponse,
  suppressRedundantCoachCorrection,
  type EnglishCoachTurn,
} from "@openlive/shared";
import { SentenceChunker } from "./voiceText";

/** Stream coach XML into speakable lines: "Try: …" once NATURAL closes, then REPLY. */
export class CoachSpeechPump {
  private acc = "";
  private userText = "";
  private naturalQueued = false;
  private replySent = 0;
  private chunker = new SentenceChunker();
  turn: EnglishCoachTurn = { natural: "", feedback: "", reply: "" };

  reset(userText: string) {
    this.acc = "";
    this.userText = userText;
    this.naturalQueued = false;
    this.replySent = 0;
    this.chunker.flush();
    this.turn = { natural: "", feedback: "", reply: "" };
  }

  private parsed(final: boolean): EnglishCoachTurn {
    return suppressRedundantCoachCorrection(parseEnglishCoachResponse(this.acc, final), this.userText);
  }

  push(delta: string): string[] {
    this.acc += delta;
    this.turn = this.parsed(false);
    const out: string[] = [];
    if (!this.naturalQueued && this.turn.natural && /<\/NATURAL>/i.test(this.acc)) {
      this.naturalQueued = true;
      const cue = englishCoachCorrectionSpeech(this.turn);
      if (cue) out.push(cue);
    }
    const pending = this.turn.reply.slice(this.replySent);
    this.replySent = this.turn.reply.length;
    out.push(...this.chunker.push(pending));
    return out;
  }

  flush(): string[] {
    this.turn = this.parsed(true);
    const out: string[] = [];
    if (!this.naturalQueued) {
      this.naturalQueued = true;
      const cue = englishCoachCorrectionSpeech(this.turn);
      if (cue) out.push(cue);
    }
    const pending = this.turn.reply.slice(this.replySent);
    this.replySent = this.turn.reply.length;
    out.push(...this.chunker.push(pending));
    const tail = this.chunker.flush();
    if (tail) out.push(tail);
    return out;
  }
}
