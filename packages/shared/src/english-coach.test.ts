import { describe, expect, it } from "vitest";
import {
  englishCoachCorrectionSpeech,
  englishCoachModelHistory,
  formatEnglishCoachTurn,
  parseEnglishCoachResponse,
  shouldRetryCoachTranscription,
  suppressRedundantCoachCorrection,
} from "./english-coach";

describe("shouldRetryCoachTranscription", () => {
  it("retries an unrelated script such as Whisper's Hangul misclassification", () => {
    expect(shouldRetryCoachTranscription("하나 하나", true)).toBe(true);
    expect(shouldRetryCoachTranscription("こんにちは", false)).toBe(true);
  });

  it("keeps English and the learner's allowed Chinese transcript", () => {
    expect(shouldRetryCoachTranscription("Hello!", true)).toBe(false);
    expect(shouldRetryCoachTranscription("Olá, tudo bem?", false)).toBe(false);
    expect(shouldRetryCoachTranscription("我不知道怎么说", true)).toBe(false);
  });

  it("treats Chinese as unexpected when Chinese input is not enabled", () => {
    expect(shouldRetryCoachTranscription("你好", false)).toBe(true);
  });
});

describe("parseEnglishCoachResponse", () => {
  it("parses a Chinese translation, note, and English reply", () => {
    const turn = parseEnglishCoachResponse(
      "<NATURAL>I would like a cup of coffee.</NATURAL>" +
        "<FEEDBACK>Use “would like” for a polite request.</FEEDBACK>" +
        "<REPLY>Sure. Do you take milk in your coffee?</REPLY>",
    );
    expect(turn).toEqual({
      natural: "I would like a cup of coffee.",
      feedback: "Use “would like” for a polite request.",
      reply: "Sure. Do you take milk in your coffee?",
    });
  });

  it("parses in-progress fields without leaking partial tags", () => {
    expect(
      parseEnglishCoachResponse(
        "<NATURAL>I went to the library.</NATURAL><FEEDBACK>Use the past tense.</FEE",
        false,
      ),
    ).toEqual({
      natural: "I went to the library.",
      feedback: "Use the past tense.",
      reply: "",
    });
  });

  it("does not merge fields when a small model misses a closing tag", () => {
    expect(
      parseEnglishCoachResponse(
        "<NATURAL>I went home.<FEEDBACK>Use the past tense.</FEEDBACK>" +
          "<REPLY>Were you tired?</REPLY>",
      ),
    ).toEqual({
      natural: "I went home.",
      feedback: "Use the past tense.",
      reply: "Were you tired?",
    });
  });

  it("accepts a labelled fallback from a small model", () => {
    expect(
      parseEnglishCoachResponse(
        "NATURAL: I have lived here for two years.\n" +
          "FEEDBACK: Use the present perfect for an action that continues now.\n" +
          "REPLY: What do you like most about living here?",
      ),
    ).toEqual({
      natural: "I have lived here for two years.",
      feedback: "Use the present perfect for an action that continues now.",
      reply: "What do you like most about living here?",
    });
  });

  it("degrades an unstructured answer to a reply", () => {
    expect(parseEnglishCoachResponse("Could you say that one more time?")).toEqual({
      natural: "",
      feedback: "",
      reply: "Could you say that one more time?",
    });
  });
});

describe("suppressRedundantCoachCorrection", () => {
  it("drops a repeated no-op correction and generic praise", () => {
    expect(
      suppressRedundantCoachCorrection(
        {
          natural: "Hello.",
          feedback: "That sounded natural.",
          reply: "Hello! How are you?",
        },
        "hello",
      ),
    ).toEqual({
      natural: "",
      feedback: "",
      reply: "Hello! How are you?",
    });
  });

  it("keeps a real correction", () => {
    const turn = {
      natural: "I went there yesterday.",
      feedback: "Use the past tense for a finished action.",
      reply: "What did you do there?",
    };
    expect(suppressRedundantCoachCorrection(turn, "I go there yesterday")).toEqual(turn);
  });
});

describe("English coach presentation", () => {
  const turn = {
    natural: "I am looking forward to the weekend.",
    feedback: "Use “look forward to” followed by a noun or an -ing form.",
    reply: "What are you planning to do?",
  };

  it("stores all three sections as readable conversation content", () => {
    expect(formatEnglishCoachTurn(turn)).toContain("**Natural English:**");
    expect(formatEnglishCoachTurn(turn)).toContain("**Coach's note:**");
    expect(formatEnglishCoachTurn(turn)).toContain("**Reply:**");
  });

  it("keeps model-facing history in the protocol shape", () => {
    expect(englishCoachModelHistory(turn)).toBe(
      `<NATURAL>${turn.natural}</NATURAL>` +
        `<FEEDBACK>${turn.feedback}</FEEDBACK>` +
        `<REPLY>${turn.reply}</REPLY>`,
    );
  });

  it("speaks the natural sentence but never the feedback or protocol tags", () => {
    const speech = englishCoachCorrectionSpeech(turn);
    expect(speech).toContain(turn.natural);
    expect(speech).not.toContain(turn.feedback);
    expect(speech).not.toMatch(/NATURAL|FEEDBACK|REPLY/);
  });
});
