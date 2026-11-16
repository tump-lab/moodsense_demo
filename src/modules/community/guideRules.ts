/**
 * Group-chat safety rules, used by the app (GroupRoomScreen).
 * Kept free of React Native imports so the rules can run under plain Node.
 *
 * Every message a member sends is screened in two layers, and either one can trigger the private
 * safety sheet (higher recall over fewer alerts):
 *   1. Keyword rules (CRISIS_PATTERNS): on the phone, instant, work offline.
 *   2. LLM screen (RISK_SCREEN_SYSTEM_PROMPT): rates the message R0-R3 when hosted AI is on.
 * The safety sheet is shown only to the sender; nothing is posted into the room. The guide still
 * answers in the room only when addressed with @Guide.
 */

export const GUIDE_NAME = 'Guide';

/** R0 none, R1 passive thoughts of death, R2 active thoughts without a plan, R3 plan, intent, or self-harm. */
export type RiskLevel = 0 | 1 | 2 | 3;

export const CRISIS_PATTERNS: readonly RegExp[] = [
  /\bkill(ing)?\s+my\s*self\b/i,
  /\bsuicid/i,
  /\bend(ing)?\s+(my|it)\s+(life|all)\b/i,
  /\bwant(ed)?\s+to\s+die\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bself[-\s]?harm/i,
  /\bhurt(ing)?\s+my\s*self\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  /\boverdos/i,
];

/** A keyword match does not say how severe the message is, so it is treated as R2 unless the LLM rates it higher. */
export const RULE_HIT_LEVEL: RiskLevel = 2;

export function matchesCrisisRules(text: string): boolean {
  return CRISIS_PATTERNS.some((p) => p.test(text));
}

export function mentionsGuide(text: string): boolean {
  return new RegExp(`@${GUIDE_NAME}\\b`, 'i').test(text);
}

/** Rule layer only: crisis language, else a reply when addressed with @Guide. */
export function guideActionFor(text: string): 'none' | 'crisis' | 'reply' {
  if (matchesCrisisRules(text)) return 'crisis';
  if (mentionsGuide(text)) return 'reply';
  return 'none';
}

export const RISK_SCREEN_SYSTEM_PROMPT = `You screen one message that a member posted in a peer support group chat in a mental-health app. Rate how much the message indicates risk of suicide or self-harm for the person who wrote it.
Levels:
0 = No indication of suicidal thoughts or self-harm. This includes everyday stress, sadness, loneliness, venting, and figures of speech such as "this exam is killing me" or "I could die of embarrassment".
1 = Passive thoughts of death or of not being here, with no thought of acting on them (for example wishing to fall asleep and not wake up, wishing to disappear, feeling everyone would be better off without them).
2 = Active thoughts of suicide or self-harm, without a stated plan or intent.
3 = A plan, intent, preparation, or a recent or ongoing act of self-harm or suicide attempt.
Read indirect, understated, or joking wording for what it means. If you are unsure between two levels, choose the higher one.
Reply with ONLY a JSON object of the form {"level": 0} with the level as a number.`;

export function buildRiskScreenMessages(text: string): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: RISK_SCREEN_SYSTEM_PROMPT },
    { role: 'user', content: `Message:\n"""${text}"""` },
  ];
}

/** Reads {"level": n} from the model's reply; null when there is no usable level. */
export function parseRiskLevel(raw: string): RiskLevel | null {
  const m = raw.match(/"level"\s*:\s*"?([0-3])\b/);
  if (!m) return null;
  return Number(m[1]) as RiskLevel;
}

/** Either layer can raise the level; the rule layer alone yields RULE_HIT_LEVEL. */
export function combineRisk(ruleHit: boolean, llmLevel: RiskLevel | null): RiskLevel {
  return Math.max(ruleHit ? RULE_HIT_LEVEL : 0, llmLevel ?? 0) as RiskLevel;
}
