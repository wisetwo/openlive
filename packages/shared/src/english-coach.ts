export interface EnglishCoachTurn {
  natural: string;
  feedback: string;
  reply: string;
}

export type SessionKind = "live" | "english-coach";

const TAGS = ["NATURAL", "FEEDBACK", "REPLY"] as const;

/**
 * Multilingual ASR can classify a very short English word as an unrelated
 * language (for example "hello" → Hangul). In that suspicious case the coach
 * retries the same audio with English-only Whisper.
 */
export function shouldRetryCoachTranscription(text: string, allowChinese: boolean): boolean {
  for (const char of text) {
    if (!/\p{Letter}/u.test(char)) continue;
    if (/\p{Script=Latin}/u.test(char)) continue;
    if (allowChinese && /\p{Script=Han}/u.test(char)) continue;
    return true;
  }
  return false;
}

export const ENGLISH_COACH_PROMPT = `You are a warm, practical English speaking coach in a hands-free voice conversation.

The user's message is a transcript produced by a local speech recognizer. It auto-detects Chinese and English for each utterance, but it can mishear words, punctuation, code-switching, names, and short audio. Never confidently "correct" wording that may plausibly be a transcription error. If the transcript is unclear, contradictory, or nonsensical, leave NATURAL and FEEDBACK empty and ask one short, simple clarification question in REPLY. You may briefly quote what you think you heard.

When the user speaks Chinese or mixes Chinese with English:
- Put a faithful, natural English version of the whole intended utterance in NATURAL.
- Put at most one short, useful learning note in FEEDBACK. Do not repeat the translation there.
- Continue the conversation in English in REPLY.

When the user speaks English:
- If there is a meaningful grammar, word-choice, or naturalness improvement, put the improved full utterance in NATURAL and explain only the most important change in one short English sentence in FEEDBACK.
- If the English is already natural, leave both NATURAL and FEEDBACK empty. Do not repeat the user's sentence.
- Do not over-correct style, dialect, contractions, or harmless spoken phrasing.
- Continue the conversation in English in REPLY.

Keep REPLY conversational and easy to say aloud, usually one to three short sentences. Match the learner's apparent level. All generated content must be English. Do not grade pronunciation: you only receive text and cannot hear phonetic details. Do not use markdown, bullets, headings, emoji, or any text outside this exact format:
<NATURAL>...</NATURAL>
<FEEDBACK>...</FEEDBACK>
<REPLY>...</REPLY>`;

function cleanField(value: string): string {
  return value
    .replace(/<\/?(?:NATURAL|FEEDBACK|REPLY)\b[^>]*>/gi, "")
    .replace(/<\/?(?:NATURAL|FEEDBACK|REPLY)?[^>]*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function taggedField(text: string, tag: (typeof TAGS)[number]): string {
  const open = new RegExp(`<${tag}>`, "i").exec(text);
  if (!open) return "";
  const from = open.index + open[0].length;
  const rest = text.slice(from);
  const close = new RegExp(`</${tag}>`, "i").exec(rest);
  const nextField = /<(?:NATURAL|FEEDBACK|REPLY)>/i.exec(rest);
  const ends = [close?.index, nextField?.index].filter(
    (index): index is number => index !== undefined,
  );
  const end = ends.length > 0 ? Math.min(...ends) : rest.length;
  return cleanField(rest.slice(0, end));
}

function labelledField(text: string, label: (typeof TAGS)[number]): string {
  const match = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]+)`, "i").exec(text);
  return cleanField(match?.[1] ?? "");
}

/** Parse both complete and in-progress model output. */
export function parseEnglishCoachResponse(raw: string, final = true): EnglishCoachTurn {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!text) return { natural: "", feedback: "", reply: "" };

  const hasTags = TAGS.some((tag) => new RegExp(`<${tag}>`, "i").test(text));
  let natural = taggedField(text, "NATURAL");
  let feedback = taggedField(text, "FEEDBACK");
  let reply = taggedField(text, "REPLY");

  if (final) {
    natural ||= labelledField(text, "NATURAL");
    feedback ||= labelledField(text, "FEEDBACK");
    reply ||= labelledField(text, "REPLY");
    if (!hasTags && !natural && !feedback && !reply) reply = cleanField(text);
  }

  return { natural, feedback, reply };
}

function comparableSpeech(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{Punctuation}\p{Symbol}\s]+/gu, "");
}

export function suppressRedundantCoachCorrection(
  turn: EnglishCoachTurn,
  userText: string,
): EnglishCoachTurn {
  const repeated =
    Boolean(turn.natural) &&
    comparableSpeech(turn.natural) === comparableSpeech(userText);
  const genericPraise = /^(?:that (?:sounded|sounds|was) natural|no corrections? (?:are )?needed)$/i.test(
    turn.feedback.replace(/[.!]+$/g, "").trim(),
  );
  if (!repeated && !(genericPraise && !turn.natural)) return turn;
  return {
    ...turn,
    natural: repeated ? "" : turn.natural,
    feedback: genericPraise ? "" : turn.feedback,
  };
}

export function formatEnglishCoachTurn(turn: EnglishCoachTurn): string {
  const parts: string[] = [];
  if (turn.natural) parts.push(`**Natural English:** ${turn.natural}`);
  if (turn.feedback) parts.push(`**Coach's note:** ${turn.feedback}`);
  if (turn.reply) parts.push(`**Reply:** ${turn.reply}`);
  return parts.join("\n\n");
}

export function englishCoachModelHistory(turn: EnglishCoachTurn): string {
  return (
    `<NATURAL>${turn.natural}</NATURAL>` +
    `<FEEDBACK>${turn.feedback}</FEEDBACK>` +
    `<REPLY>${turn.reply}</REPLY>`
  );
}

export function englishCoachCorrectionSpeech(turn: EnglishCoachTurn): string {
  return turn.natural ? `Try: ${turn.natural}` : "";
}

export function coachTurnFromText(text: string): EnglishCoachTurn | null {
  if (!/<(?:NATURAL|FEEDBACK|REPLY)>/i.test(text) && !/^(?:NATURAL|FEEDBACK|REPLY)\s*:/m.test(text)) return null;
  const turn = parseEnglishCoachResponse(text);
  return turn.natural || turn.feedback || turn.reply ? turn : null;
}
