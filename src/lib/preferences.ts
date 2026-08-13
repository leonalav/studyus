export const PREFERENCES_STORAGE_KEY = "studyus.preferences.v1";
export const PREFERENCES_CHANGED_EVENT = "studyus:preferences-changed";

export type ThemePreference = "system" | "dark" | "light";
export type FontPreference = "system" | "grotesk" | "inter" | "serif" | "mono";
export type DensityPreference = "comfortable" | "compact";
export type NotificationChannel = "in-app" | "desktop" | "both" | "email";
export type NotificationEventId = "testReady" | "sessionComplete";
export type SummaryCadence = "off" | "daily" | "weekly" | "monthly";
export type TutorDifficulty = "easier" | "adaptive" | "harder";

export interface AppearancePreferences {
  theme: ThemePreference;
  font: FontPreference;
  density: DensityPreference;
  textSize: number;
  reducedMotion: boolean;
  highContrast: boolean;
  dyslexiaFriendly: boolean;
  captions: boolean;
}

export interface NotificationRule {
  enabled: boolean;
  channel: NotificationChannel;
}

export interface NotificationPreferences {
  events: Record<NotificationEventId, NotificationRule>;
  summary: { cadence: SummaryCadence; channel: NotificationChannel };
}

/** Legacy shape accepted only for migration from the former personality presets. */
export interface TutorStylePreference {
  id: string;
  name: string;
  tone: string;
  approach: string;
  verbosity: number;
  patience: number;
  challenge: number;
  humor: number;
  preview: string;
  built?: boolean;
}

export const TUTOR_TOOL_IDS = [
  "boardWriting",
  "boardEditing",
  "threads",
  "knowledgeSearch",
  "pdfKnowledge",
  "calculator",
  "symbolicAlgebra",
  "geometry",
  "diagrams",
  "functionGraphing",
  "graphing3d",
  "dataVisualization",
  "equationRendering",
  "physics",
  "biology",
  "circuits",
  "chemistry",
  "graphTheory",
  "imageAnalysis",
  "fileProcessing",
] as const;
export type TutorToolId = typeof TUTOR_TOOL_IDS[number];
export type TutorToolPermissions = Record<TutorToolId, boolean>;
export const MAX_TUTOR_VERSIONS = 4;
export const MAX_TUTOR_VERSION_CHARS = 750_000;

export interface TutorIdentity {
  id: string;
  name: string;
  description: string;
  avatar: string;
  subjects: string[];
  expertise: string[];
  learnerLevel: "primary" | "secondary" | "undergraduate" | "graduate" | "mixed";
  languages: string[];
  roleTemplate: "socratic-guide" | "exam-coach" | "concept-explainer" | "research-mentor" | "custom";
  coreInstructions: string;
}

export interface TutorTeachingPolicy {
  approaches: string[];
  topicStrategy: "diagnose-first" | "concept-first" | "example-first" | "practice-first";
  adaptation: "steady" | "responsive" | "highly-adaptive";
  socraticMode: "off" | "light" | "strict";
  solutionPolicy: "never-first" | "after-attempt" | "on-request" | "always-available";
  secondaryExplanation: "analogy" | "worked-example" | "visual" | "first-principles" | "different-words";
}

export interface TutorConstitution {
  hardRules: string[];
  preferences: string[];
  situational: string[];
}

export interface TutorKnowledgePolicy {
  accessMode: "session" | "selected-first" | "selected-only" | "all";
  selectedSourceIds: string[];
  selectedNodeIds: string[];
  sourcePriority: string[];
  citationPolicy: "always" | "when-used" | "on-request" | "never";
  boundaries: string;
  allowGeneralKnowledge: boolean;
}

export interface TutorCurriculumPolicy {
  enabled: boolean;
  sequence: string[];
  perTopicInstructions: string;
  requireMasteryCheck: boolean;
}

export interface TutorMemoryPolicy {
  mode: "off" | "session" | "persistent";
  includeInPrompt: boolean;
  learnFromSessions: boolean;
  rememberMisconceptions: boolean;
  rememberWeakAreas: boolean;
  rememberCalibration: boolean;
  minimumEvidence: 1 | 2 | 3;
  retentionDays: 30 | 90 | 180 | 365 | 0;
}

export interface TutorSkill {
  id: string;
  name: string;
  instructions: string;
  enabled: boolean;
}

export interface TutorAssessmentPolicy {
  frequency: "only-when-asked" | "occasional" | "each-topic";
  questionStyle: "short-answer" | "mixed" | "exam-style" | "proof-and-reasoning";
  feedbackTiming: "immediate" | "after-retry" | "at-end";
  retryPolicy: "hint-then-retry" | "retry-once" | "show-correction";
  gradingStyle: "supportive" | "strict" | "rubric-led";
  rubricInstructions: string;
}

export interface TutorSessionPolicy {
  opening: "ask-goal" | "resume" | "quick-diagnostic" | "start-directly";
  closing: "recap" | "exit-ticket" | "next-steps" | "none";
  continuity: "resume-context" | "fresh-each-time";
  sessionLength: number;
  breakEvery: number;
  autoNotes: boolean;
}

export interface TutorVoicePolicy {
  voiceReplies: boolean;
  tone: "warm" | "neutral" | "formal" | "direct" | "encouraging";
  verbosity: number;
  pace: "slow" | "measured" | "normal" | "brisk";
  humor: number;
  readEquations: boolean;
}

export interface TutorCommand {
  id: string;
  command: string;
  instruction: string;
  enabled: boolean;
}

export interface TutorTrigger {
  id: string;
  condition: string;
  action: string;
  enabled: boolean;
}

export interface TutorPrivacyPolicy {
  allowLearnerModelInPrompts: boolean;
  allowCurriculumInPrompts: boolean;
  allowImageDataInPrompts: boolean;
  allowFileDataInPrompts: boolean;
  includeProfileIdentity: boolean;
}

export interface TutorAdvancedPolicy {
  additionalInstructions: string;
  temperature: number;
  maxResponseTokens: number;
  requestTimeoutSeconds: number;
  autonomy: "ask-first" | "balanced" | "proactive";
}

export interface TutorVersion {
  id: string;
  label: string;
  createdAt: string;
  serializedDefinition: string;
}

/**
 * The Tutor Studio definition is the user-owned asset. Model bindings are kept
 * elsewhere, so replacing a model never replaces this identity, policy, memory,
 * curriculum selection, skill, command, permission, or version history.
 */
export interface TutorPreferences {
  schemaVersion: 2;
  identity: TutorIdentity;
  teaching: TutorTeachingPolicy;
  constitution: TutorConstitution;
  knowledge: TutorKnowledgePolicy;
  curriculum: TutorCurriculumPolicy;
  memory: TutorMemoryPolicy;
  skills: TutorSkill[];
  tools: TutorToolPermissions;
  assessment: TutorAssessmentPolicy;
  sessions: TutorSessionPolicy;
  voice: TutorVoicePolicy;
  commands: TutorCommand[];
  triggers: TutorTrigger[];
  privacy: TutorPrivacyPolicy;
  advanced: TutorAdvancedPolicy;
  versions: TutorVersion[];
  difficulty: TutorDifficulty;
  /** Backward-compatible runtime mirrors. Kept synchronized by sanitization. */
  sessionLength: number;
  breakEvery: number;
  voiceReplies: boolean;
  autoNotes: boolean;
}

export interface ProfilePreferences {
  fullName: string;
  email: string;
  timezone: string;
}

export interface SavedModelEndpoint {
  id: string;
  label: string;
  provider: "openai" | "anthropic" | "custom" | "studyus";
  baseUrl: string;
  model: string;
  keyMasked: string;
  active: boolean;
  /** Explicit endpoint capability. It is verified by the endpoint test when enabled. */
  vision: boolean;
}

export interface StudyusPreferences {
  appearance: AppearancePreferences;
  notifications: NotificationPreferences;
  tutor: TutorPreferences;
  profile: ProfilePreferences;
  modelEndpoints: SavedModelEndpoint[];
}

const DEFAULT_TOOLS: TutorToolPermissions = Object.fromEntries(
  TUTOR_TOOL_IDS.map((id) => [id, true])
) as unknown as TutorToolPermissions;

export const DEFAULT_TUTOR: TutorPreferences = {
  schemaVersion: 2,
  identity: {
    id: "tutor-studio-default",
    name: "My Tutor",
    description: "A rigorous, adaptive tutor that teaches for durable understanding.",
    avatar: "T",
    subjects: ["Mathematics", "Physics", "Chemistry", "Biology"],
    expertise: [],
    learnerLevel: "mixed",
    languages: ["English"],
    roleTemplate: "socratic-guide",
    coreInstructions: "Build understanding, preserve the learner's agency, and be precise about uncertainty.",
  },
  teaching: {
    approaches: ["Socratic questioning", "First principles", "Worked examples"],
    topicStrategy: "diagnose-first",
    adaptation: "highly-adaptive",
    socraticMode: "light",
    solutionPolicy: "after-attempt",
    secondaryExplanation: "visual",
  },
  constitution: {
    hardRules: [
      "Never invent curriculum evidence or citations.",
      "Do not reveal a full solution before the configured solution policy permits it.",
      "State uncertainty plainly instead of fabricating facts.",
    ],
    preferences: ["Prefer one useful question over several vague questions.", "Keep chalkboard notes reusable and well organized."],
    situational: ["If the learner explicitly requests a diagram, draw it before asking a gating question."],
  },
  knowledge: {
    accessMode: "selected-first",
    selectedSourceIds: [],
    selectedNodeIds: [],
    sourcePriority: [],
    citationPolicy: "when-used",
    boundaries: "Use imported curriculum as authoritative for course-specific definitions, notation, and scope.",
    allowGeneralKnowledge: true,
  },
  curriculum: {
    enabled: true,
    sequence: ["Diagnose", "Explain", "Worked example", "Guided practice", "Independent practice", "Recap"],
    perTopicInstructions: "Do not advance until the learner can explain the key idea in their own words or solve a short transfer check.",
    requireMasteryCheck: true,
  },
  memory: {
    mode: "persistent",
    includeInPrompt: true,
    learnFromSessions: true,
    rememberMisconceptions: true,
    rememberWeakAreas: true,
    rememberCalibration: false,
    minimumEvidence: 2,
    retentionDays: 180,
  },
  skills: [
    { id: "skill-explain", name: "Explain another way", instructions: "When an explanation does not land, switch representation rather than repeating it.", enabled: true },
    { id: "skill-transfer", name: "Transfer check", instructions: "After a key concept, use a short materially different example to check transfer.", enabled: true },
  ],
  tools: DEFAULT_TOOLS,
  assessment: {
    frequency: "occasional",
    questionStyle: "mixed",
    feedbackTiming: "after-retry",
    retryPolicy: "hint-then-retry",
    gradingStyle: "rubric-led",
    rubricInstructions: "Credit correct reasoning and method, distinguish conceptual errors from arithmetic slips, and state the next improvement criterion.",
  },
  sessions: {
    opening: "ask-goal",
    closing: "recap",
    continuity: "resume-context",
    sessionLength: 30,
    breakEvery: 20,
    autoNotes: true,
  },
  voice: {
    voiceReplies: false,
    tone: "encouraging",
    verbosity: 52,
    pace: "normal",
    humor: 18,
    readEquations: false,
  },
  commands: [
    { id: "cmd-hint", command: "/hint", instruction: "Give exactly one next-step hint without completing the solution.", enabled: true },
    { id: "cmd-recap", command: "/recap", instruction: "Summarize the durable ideas and the learner's next step on the board.", enabled: true },
  ],
  triggers: [
    { id: "trigger-stuck", condition: "The learner repeats the same failed approach twice", action: "Change representation and offer one targeted hint.", enabled: true },
  ],
  privacy: {
    allowLearnerModelInPrompts: true,
    allowCurriculumInPrompts: true,
    allowImageDataInPrompts: true,
    allowFileDataInPrompts: true,
    includeProfileIdentity: false,
  },
  advanced: {
    additionalInstructions: "",
    temperature: 40,
    maxResponseTokens: 4096,
    requestTimeoutSeconds: 180,
    autonomy: "balanced",
  },
  versions: [],
  difficulty: "adaptive",
  sessionLength: 30,
  breakEvery: 20,
  voiceReplies: false,
  autoNotes: true,
};

export const DEFAULT_PREFERENCES: StudyusPreferences = {
  appearance: {
    theme: "system",
    font: "grotesk",
    density: "comfortable",
    textSize: 100,
    reducedMotion: false,
    highContrast: false,
    dyslexiaFriendly: false,
    captions: true,
  },
  notifications: {
    events: {
      testReady: { enabled: true, channel: "in-app" },
      sessionComplete: { enabled: true, channel: "in-app" },
    },
    summary: { cadence: "weekly", channel: "in-app" },
  },
  tutor: DEFAULT_TUTOR,
  profile: {
    fullName: "Learner",
    email: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  },
  modelEndpoints: [],
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function enumValue<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (typeof value === "string" || typeof value === "number") && allowed.includes(value as T)
    ? value as T
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function stringList(value: unknown, fallback: string[], maxItems = 40, maxLength = 500): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const clean = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean);
  return [...new Set(clean)].slice(0, maxItems);
}

function sanitizeRule(value: unknown, fallback: NotificationRule): NotificationRule {
  const rule = object(value);
  return {
    enabled: booleanValue(rule.enabled, fallback.enabled),
    channel: enumValue(rule.channel, ["in-app", "desktop", "both", "email"], fallback.channel),
  };
}

function sanitizeEndpoint(value: unknown): SavedModelEndpoint | null {
  const endpoint = object(value);
  const id = textValue(endpoint.id, "", 100).trim();
  const label = textValue(endpoint.label, "", 120).trim();
  const baseUrl = textValue(endpoint.baseUrl, "", 2000).trim();
  const model = textValue(endpoint.model, "", 300).trim();
  if (!id || !label || !baseUrl || !model) return null;
  return {
    id,
    label,
    provider: enumValue(endpoint.provider, ["openai", "anthropic", "custom", "studyus"], "custom"),
    baseUrl,
    model,
    keyMasked: textValue(endpoint.keyMasked, "not set", 80),
    active: booleanValue(endpoint.active, false),
    vision: booleanValue(endpoint.vision, /vision|gpt-4o|gpt-4\.1|claude-3|claude-4|gemini/i.test(model)),
  };
}

function sanitizeSkill(value: unknown): TutorSkill | null {
  const entry = object(value);
  const id = textValue(entry.id, "", 100).trim();
  const name = textValue(entry.name, "", 100).trim();
  const instructions = textValue(entry.instructions, "", 2000).trim();
  return id && name && instructions ? { id, name, instructions, enabled: booleanValue(entry.enabled, true) } : null;
}

function sanitizeCommand(value: unknown): TutorCommand | null {
  const entry = object(value);
  const id = textValue(entry.id, "", 100).trim();
  const commandRaw = textValue(entry.command, "", 80).trim().replace(/\s+/g, "-");
  const command = commandRaw ? (commandRaw.startsWith("/") ? commandRaw : `/${commandRaw}`) : "";
  const instruction = textValue(entry.instruction, "", 1000).trim();
  return id && command.length > 1 && instruction ? { id, command, instruction, enabled: booleanValue(entry.enabled, true) } : null;
}

function sanitizeTrigger(value: unknown): TutorTrigger | null {
  const entry = object(value);
  const id = textValue(entry.id, "", 100).trim();
  const condition = textValue(entry.condition, "", 1000).trim();
  const action = textValue(entry.action, "", 1000).trim();
  return id && condition && action ? { id, condition, action, enabled: booleanValue(entry.enabled, true) } : null;
}

function sanitizeVersion(value: unknown): TutorVersion | null {
  const entry = object(value);
  const id = textValue(entry.id, "", 100).trim();
  const label = textValue(entry.label, "", 120).trim();
  const createdAt = textValue(entry.createdAt, "", 80).trim();
  const serializedDefinition = typeof entry.serializedDefinition === "string" &&
    entry.serializedDefinition.length <= MAX_TUTOR_VERSION_CHARS
    ? entry.serializedDefinition
    : "";
  return id && label && createdAt && serializedDefinition ? { id, label, createdAt, serializedDefinition } : null;
}

function legacyTutorSeed(tutor: Record<string, unknown>): Partial<TutorPreferences> {
  if (!Array.isArray(tutor.styles)) return {};
  const styles = tutor.styles.map(object).filter((candidate) => (
    textValue(candidate.id, "", 100).trim().length > 0
    && textValue(candidate.name, "", 80).trim().length > 0
  ));
  const activeId = textValue(tutor.activeStyleId, "", 100);
  const style = styles.find((candidate) => candidate.id === activeId) ?? styles[0];
  if (!style) return {};
  const approach = textValue(style.approach, "Socratic questioning", 100);
  return {
    identity: { ...DEFAULT_TUTOR.identity, name: textValue(style.name, DEFAULT_TUTOR.identity.name, 80) },
    teaching: { ...DEFAULT_TUTOR.teaching, approaches: [approach] },
    voice: {
      ...DEFAULT_TUTOR.voice,
      tone: enumValue(String(style.tone ?? "").toLowerCase(), ["warm", "neutral", "formal", "direct", "encouraging"], DEFAULT_TUTOR.voice.tone),
      verbosity: numberValue(style.verbosity, DEFAULT_TUTOR.voice.verbosity, 0, 100),
      humor: numberValue(style.humor, DEFAULT_TUTOR.voice.humor, 0, 100),
    },
  };
}

function sanitizeTutor(value: unknown): TutorPreferences {
  const tutor = object(value);
  const legacy = legacyTutorSeed(tutor);
  const identity = object(tutor.identity ?? legacy.identity);
  const teaching = object(tutor.teaching ?? legacy.teaching);
  const constitution = object(tutor.constitution);
  const knowledge = object(tutor.knowledge);
  const curriculum = object(tutor.curriculum);
  const memory = object(tutor.memory);
  const tools = object(tutor.tools);
  const assessment = object(tutor.assessment);
  const sessions = object(tutor.sessions);
  const voice = object(tutor.voice ?? legacy.voice);
  const privacy = object(tutor.privacy);
  const advanced = object(tutor.advanced);

  // Legacy top-level values remain authoritative during one-time migration.
  const sessionLength = numberValue(sessions.sessionLength ?? tutor.sessionLength, DEFAULT_TUTOR.sessions.sessionLength, 10, 90);
  const breakEvery = numberValue(sessions.breakEvery ?? tutor.breakEvery, DEFAULT_TUTOR.sessions.breakEvery, 10, 60);
  const voiceReplies = booleanValue(voice.voiceReplies ?? tutor.voiceReplies, DEFAULT_TUTOR.voice.voiceReplies);
  const autoNotes = booleanValue(sessions.autoNotes ?? tutor.autoNotes, DEFAULT_TUTOR.sessions.autoNotes);
  const parsedRequestTimeout = numberValue(
    advanced.requestTimeoutSeconds,
    DEFAULT_TUTOR.advanced.requestTimeoutSeconds,
    15,
    180
  );
  // Migrate the former default in persisted preferences. Learners who already
  // have 60 seconds saved should receive the longer deadline immediately.
  const requestTimeoutSeconds = parsedRequestTimeout === 60 ? 180 : parsedRequestTimeout;

  const parsedTools = Object.fromEntries(TUTOR_TOOL_IDS.map((id) => [
    id,
    booleanValue(tools[id], DEFAULT_TUTOR.tools[id]),
  ])) as TutorToolPermissions;

  const selectedSourceIds = stringList(knowledge.selectedSourceIds, [], 50, 120);
  const selectedNodeIds = stringList(knowledge.selectedNodeIds, [], 200, 120);
  const sourcePriority = stringList(knowledge.sourcePriority, selectedSourceIds, 50, 120)
    .filter((id) => selectedSourceIds.includes(id));
  selectedSourceIds.forEach((id) => { if (!sourcePriority.includes(id)) sourcePriority.push(id); });

  return {
    schemaVersion: 2,
    identity: {
      id: textValue(identity.id, DEFAULT_TUTOR.identity.id, 100).trim() || DEFAULT_TUTOR.identity.id,
      name: textValue(identity.name, DEFAULT_TUTOR.identity.name, 80).trim() || DEFAULT_TUTOR.identity.name,
      description: textValue(identity.description, DEFAULT_TUTOR.identity.description, 600),
      avatar: textValue(identity.avatar, DEFAULT_TUTOR.identity.avatar, 250_000),
      subjects: stringList(identity.subjects, DEFAULT_TUTOR.identity.subjects, 30, 80),
      expertise: stringList(identity.expertise, DEFAULT_TUTOR.identity.expertise, 40, 100),
      learnerLevel: enumValue(identity.learnerLevel, ["primary", "secondary", "undergraduate", "graduate", "mixed"], DEFAULT_TUTOR.identity.learnerLevel),
      languages: stringList(identity.languages, DEFAULT_TUTOR.identity.languages, 20, 60),
      roleTemplate: enumValue(identity.roleTemplate, ["socratic-guide", "exam-coach", "concept-explainer", "research-mentor", "custom"], DEFAULT_TUTOR.identity.roleTemplate),
      coreInstructions: textValue(identity.coreInstructions, DEFAULT_TUTOR.identity.coreInstructions, 4000),
    },
    teaching: {
      approaches: stringList(teaching.approaches, DEFAULT_TUTOR.teaching.approaches, 20, 100),
      topicStrategy: enumValue(teaching.topicStrategy, ["diagnose-first", "concept-first", "example-first", "practice-first"], DEFAULT_TUTOR.teaching.topicStrategy),
      adaptation: enumValue(teaching.adaptation, ["steady", "responsive", "highly-adaptive"], DEFAULT_TUTOR.teaching.adaptation),
      socraticMode: enumValue(teaching.socraticMode, ["off", "light", "strict"], DEFAULT_TUTOR.teaching.socraticMode),
      solutionPolicy: enumValue(teaching.solutionPolicy, ["never-first", "after-attempt", "on-request", "always-available"], DEFAULT_TUTOR.teaching.solutionPolicy),
      secondaryExplanation: enumValue(teaching.secondaryExplanation, ["analogy", "worked-example", "visual", "first-principles", "different-words"], DEFAULT_TUTOR.teaching.secondaryExplanation),
    },
    constitution: {
      hardRules: stringList(constitution.hardRules, DEFAULT_TUTOR.constitution.hardRules, 30, 600),
      preferences: stringList(constitution.preferences, DEFAULT_TUTOR.constitution.preferences, 30, 600),
      situational: stringList(constitution.situational, DEFAULT_TUTOR.constitution.situational, 30, 600),
    },
    knowledge: {
      accessMode: enumValue(knowledge.accessMode, ["session", "selected-first", "selected-only", "all"], DEFAULT_TUTOR.knowledge.accessMode),
      selectedSourceIds,
      selectedNodeIds,
      sourcePriority,
      citationPolicy: enumValue(knowledge.citationPolicy, ["always", "when-used", "on-request", "never"], DEFAULT_TUTOR.knowledge.citationPolicy),
      boundaries: textValue(knowledge.boundaries, DEFAULT_TUTOR.knowledge.boundaries, 3000),
      allowGeneralKnowledge: booleanValue(knowledge.allowGeneralKnowledge, DEFAULT_TUTOR.knowledge.allowGeneralKnowledge),
    },
    curriculum: {
      enabled: booleanValue(curriculum.enabled, DEFAULT_TUTOR.curriculum.enabled),
      sequence: stringList(curriculum.sequence, DEFAULT_TUTOR.curriculum.sequence, 20, 100),
      perTopicInstructions: textValue(curriculum.perTopicInstructions, DEFAULT_TUTOR.curriculum.perTopicInstructions, 3000),
      requireMasteryCheck: booleanValue(curriculum.requireMasteryCheck, DEFAULT_TUTOR.curriculum.requireMasteryCheck),
    },
    memory: {
      mode: enumValue(memory.mode, ["off", "session", "persistent"], DEFAULT_TUTOR.memory.mode),
      includeInPrompt: booleanValue(memory.includeInPrompt, DEFAULT_TUTOR.memory.includeInPrompt),
      learnFromSessions: booleanValue(memory.learnFromSessions, DEFAULT_TUTOR.memory.learnFromSessions),
      rememberMisconceptions: booleanValue(memory.rememberMisconceptions, DEFAULT_TUTOR.memory.rememberMisconceptions),
      rememberWeakAreas: booleanValue(memory.rememberWeakAreas, DEFAULT_TUTOR.memory.rememberWeakAreas),
      rememberCalibration: booleanValue(memory.rememberCalibration, DEFAULT_TUTOR.memory.rememberCalibration),
      minimumEvidence: enumValue(memory.minimumEvidence, [1, 2, 3] as const, DEFAULT_TUTOR.memory.minimumEvidence),
      retentionDays: enumValue(memory.retentionDays, [30, 90, 180, 365, 0] as const, DEFAULT_TUTOR.memory.retentionDays),
    },
    skills: (Array.isArray(tutor.skills) ? tutor.skills : DEFAULT_TUTOR.skills).map(sanitizeSkill).filter((item): item is TutorSkill => item !== null).slice(0, 30),
    tools: parsedTools,
    assessment: {
      frequency: enumValue(assessment.frequency, ["only-when-asked", "occasional", "each-topic"], DEFAULT_TUTOR.assessment.frequency),
      questionStyle: enumValue(assessment.questionStyle, ["short-answer", "mixed", "exam-style", "proof-and-reasoning"], DEFAULT_TUTOR.assessment.questionStyle),
      feedbackTiming: enumValue(assessment.feedbackTiming, ["immediate", "after-retry", "at-end"], DEFAULT_TUTOR.assessment.feedbackTiming),
      retryPolicy: enumValue(assessment.retryPolicy, ["hint-then-retry", "retry-once", "show-correction"], DEFAULT_TUTOR.assessment.retryPolicy),
      gradingStyle: enumValue(assessment.gradingStyle, ["supportive", "strict", "rubric-led"], DEFAULT_TUTOR.assessment.gradingStyle),
      rubricInstructions: textValue(assessment.rubricInstructions, DEFAULT_TUTOR.assessment.rubricInstructions, 4000),
    },
    sessions: {
      opening: enumValue(sessions.opening, ["ask-goal", "resume", "quick-diagnostic", "start-directly"], DEFAULT_TUTOR.sessions.opening),
      closing: enumValue(sessions.closing, ["recap", "exit-ticket", "next-steps", "none"], DEFAULT_TUTOR.sessions.closing),
      continuity: enumValue(sessions.continuity, ["resume-context", "fresh-each-time"], DEFAULT_TUTOR.sessions.continuity),
      sessionLength,
      breakEvery,
      autoNotes,
    },
    voice: {
      voiceReplies,
      tone: enumValue(voice.tone, ["warm", "neutral", "formal", "direct", "encouraging"], DEFAULT_TUTOR.voice.tone),
      verbosity: numberValue(voice.verbosity, DEFAULT_TUTOR.voice.verbosity, 0, 100),
      pace: enumValue(voice.pace, ["slow", "measured", "normal", "brisk"], DEFAULT_TUTOR.voice.pace),
      humor: numberValue(voice.humor, DEFAULT_TUTOR.voice.humor, 0, 100),
      readEquations: booleanValue(voice.readEquations, DEFAULT_TUTOR.voice.readEquations),
    },
    commands: (Array.isArray(tutor.commands) ? tutor.commands : DEFAULT_TUTOR.commands).map(sanitizeCommand).filter((item): item is TutorCommand => item !== null).slice(0, 30),
    triggers: (Array.isArray(tutor.triggers) ? tutor.triggers : DEFAULT_TUTOR.triggers).map(sanitizeTrigger).filter((item): item is TutorTrigger => item !== null).slice(0, 30),
    privacy: {
      allowLearnerModelInPrompts: booleanValue(privacy.allowLearnerModelInPrompts, DEFAULT_TUTOR.privacy.allowLearnerModelInPrompts),
      allowCurriculumInPrompts: booleanValue(privacy.allowCurriculumInPrompts, DEFAULT_TUTOR.privacy.allowCurriculumInPrompts),
      allowImageDataInPrompts: booleanValue(privacy.allowImageDataInPrompts, DEFAULT_TUTOR.privacy.allowImageDataInPrompts),
      allowFileDataInPrompts: booleanValue(privacy.allowFileDataInPrompts, DEFAULT_TUTOR.privacy.allowFileDataInPrompts),
      includeProfileIdentity: booleanValue(privacy.includeProfileIdentity, DEFAULT_TUTOR.privacy.includeProfileIdentity),
    },
    advanced: {
      additionalInstructions: textValue(advanced.additionalInstructions, DEFAULT_TUTOR.advanced.additionalInstructions, 8000),
      temperature: numberValue(advanced.temperature, DEFAULT_TUTOR.advanced.temperature, 0, 100),
      maxResponseTokens: numberValue(advanced.maxResponseTokens, DEFAULT_TUTOR.advanced.maxResponseTokens, 512, 8192),
      requestTimeoutSeconds,
      autonomy: enumValue(advanced.autonomy, ["ask-first", "balanced", "proactive"], DEFAULT_TUTOR.advanced.autonomy),
    },
    versions: (Array.isArray(tutor.versions) ? tutor.versions : []).map(sanitizeVersion).filter((item): item is TutorVersion => item !== null).slice(0, MAX_TUTOR_VERSIONS),
    difficulty: enumValue(tutor.difficulty, ["easier", "adaptive", "harder"], DEFAULT_TUTOR.difficulty),
    sessionLength,
    breakEvery,
    voiceReplies,
    autoNotes,
  };
}

/** Parse untrusted persisted data and merge it with safe defaults. */
export function sanitizePreferences(value: unknown): StudyusPreferences {
  const root = object(value);
  const appearance = object(root.appearance);
  const notifications = object(root.notifications);
  const events = object(notifications.events);
  const summary = object(notifications.summary);
  const profile = object(root.profile);

  const endpoints = Array.isArray(root.modelEndpoints)
    ? root.modelEndpoints.map(sanitizeEndpoint).filter((endpoint): endpoint is SavedModelEndpoint => endpoint !== null).slice(0, 30)
    : [];
  if (endpoints.length > 0 && !endpoints.some((endpoint) => endpoint.active)) endpoints[0].active = true;
  if (endpoints.filter((endpoint) => endpoint.active).length > 1) {
    let foundActive = false;
    endpoints.forEach((endpoint) => {
      if (endpoint.active && foundActive) endpoint.active = false;
      if (endpoint.active) foundActive = true;
    });
  }

  return {
    appearance: {
      theme: enumValue(appearance.theme, ["system", "dark", "light"], DEFAULT_PREFERENCES.appearance.theme),
      font: enumValue(appearance.font, ["system", "grotesk", "inter", "serif", "mono"], DEFAULT_PREFERENCES.appearance.font),
      density: enumValue(appearance.density, ["comfortable", "compact"], DEFAULT_PREFERENCES.appearance.density),
      textSize: numberValue(appearance.textSize, DEFAULT_PREFERENCES.appearance.textSize, 80, 140),
      reducedMotion: booleanValue(appearance.reducedMotion, DEFAULT_PREFERENCES.appearance.reducedMotion),
      highContrast: booleanValue(appearance.highContrast, DEFAULT_PREFERENCES.appearance.highContrast),
      dyslexiaFriendly: booleanValue(appearance.dyslexiaFriendly, DEFAULT_PREFERENCES.appearance.dyslexiaFriendly),
      captions: booleanValue(appearance.captions, DEFAULT_PREFERENCES.appearance.captions),
    },
    notifications: {
      events: {
        testReady: sanitizeRule(events.testReady, DEFAULT_PREFERENCES.notifications.events.testReady),
        sessionComplete: sanitizeRule(events.sessionComplete, DEFAULT_PREFERENCES.notifications.events.sessionComplete),
      },
      summary: {
        cadence: enumValue(summary.cadence, ["off", "daily", "weekly", "monthly"], DEFAULT_PREFERENCES.notifications.summary.cadence),
        channel: enumValue(summary.channel, ["in-app", "desktop", "both", "email"], DEFAULT_PREFERENCES.notifications.summary.channel),
      },
    },
    tutor: sanitizeTutor(root.tutor),
    profile: {
      fullName: textValue(profile.fullName, DEFAULT_PREFERENCES.profile.fullName, 120),
      email: textValue(profile.email, DEFAULT_PREFERENCES.profile.email, 320),
      timezone: textValue(profile.timezone, DEFAULT_PREFERENCES.profile.timezone, 120),
    },
    modelEndpoints: endpoints,
  };
}

export function loadPreferences(): StudyusPreferences {
  if (typeof window === "undefined") return sanitizePreferences(DEFAULT_PREFERENCES);
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return raw ? sanitizePreferences(JSON.parse(raw)) : sanitizePreferences(DEFAULT_PREFERENCES);
  } catch {
    return sanitizePreferences(DEFAULT_PREFERENCES);
  }
}

export function applyAppearancePreferences(appearance: AppearancePreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const systemDark = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : true;
  const resolvedTheme = appearance.theme === "system" ? (systemDark ? "dark" : "light") : appearance.theme;

  root.dataset.themePreference = appearance.theme;
  root.dataset.theme = resolvedTheme;
  root.dataset.font = appearance.dyslexiaFriendly ? "dyslexic" : appearance.font;
  root.dataset.density = appearance.density;
  root.dataset.motion = appearance.reducedMotion ? "reduced" : "full";
  root.dataset.contrast = appearance.highContrast ? "high" : "normal";
  root.dataset.captions = appearance.captions ? "on" : "off";
  root.style.setProperty("--app-text-scale", String(appearance.textSize / 100));
  root.style.colorScheme = resolvedTheme;
}

export function savePreferences(value: StudyusPreferences): StudyusPreferences {
  const next = sanitizePreferences(value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The preferences still apply for this page even if storage is blocked.
    }
  }
  applyAppearancePreferences(next.appearance);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<StudyusPreferences>(PREFERENCES_CHANGED_EVENT, { detail: next }));
  }
  return next;
}

/** Apply saved preferences before React paints and keep System theme in sync. */
export function initializePreferences(): () => void {
  const preferences = loadPreferences();
  applyAppearancePreferences(preferences.appearance);
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemThemeChanged = () => {
    const current = loadPreferences();
    if (current.appearance.theme === "system") applyAppearancePreferences(current.appearance);
  };
  media.addEventListener?.("change", onSystemThemeChanged);
  return () => media.removeEventListener?.("change", onSystemThemeChanged);
}

function bullets(label: string, entries: string[]): string {
  return entries.length ? `${label}:\n${entries.map((entry) => `- ${entry}`).join("\n")}` : `${label}: none configured.`;
}

/** Compile the durable Tutor Studio definition into enforceable agent policy. */
export function buildTutorPreferenceReminder(preferences: TutorPreferences = loadPreferences().tutor): string {
  const enabledTools = TUTOR_TOOL_IDS.filter((id) => preferences.tools[id]);
  const disabledTools = TUTOR_TOOL_IDS.filter((id) => !preferences.tools[id]);
  const activeSkills = preferences.skills.filter((skill) => skill.enabled);
  const activeCommands = preferences.commands.filter((command) => command.enabled);
  const activeTriggers = preferences.triggers.filter((trigger) => trigger.enabled);
  const cite = {
    always: "Cite supplied curriculum handles whenever answering a curriculum-grounded claim.",
    "when-used": "Cite supplied curriculum handles whenever their content materially informs the response.",
    "on-request": "Use supplied curriculum internally and cite handles when the learner requests sources.",
    never: "Do not print citation handles in learner-facing prose, while still obeying evidence_refs validation.",
  }[preferences.knowledge.citationPolicy];

  return [
    "USER-OWNED TUTOR STUDIO DEFINITION (subordinate to application safety, evidence, and output-schema rules):",
    `IDENTITY: ${preferences.identity.name} — ${preferences.identity.description}`,
    `Role template: ${preferences.identity.roleTemplate}; target level: ${preferences.identity.learnerLevel}; languages: ${preferences.identity.languages.join(", ") || "unspecified"}.`,
    `Subjects: ${preferences.identity.subjects.join(", ") || "general"}. Expertise: ${preferences.identity.expertise.join(", ") || "not constrained"}.`,
    `Core identity instructions: ${preferences.identity.coreInstructions || "none"}`,
    `TEACHING: approaches ${preferences.teaching.approaches.join(", ") || "none"}; topic strategy ${preferences.teaching.topicStrategy}; adaptation ${preferences.teaching.adaptation}; Socratic mode ${preferences.teaching.socraticMode}; solution policy ${preferences.teaching.solutionPolicy}; secondary explanation ${preferences.teaching.secondaryExplanation}.`,
    bullets("CONSTITUTION — hard rules", preferences.constitution.hardRules),
    bullets("CONSTITUTION — preferences", preferences.constitution.preferences),
    bullets("CONSTITUTION — situational behavior", preferences.constitution.situational),
    `KNOWLEDGE: access ${preferences.knowledge.accessMode}; general knowledge ${preferences.knowledge.allowGeneralKnowledge ? "allowed with uncertainty clearly separated from supplied sources" : "not allowed — stay inside supplied curriculum and say when it is insufficient"}. ${cite}`,
    `Knowledge boundaries: ${preferences.knowledge.boundaries || "none specified"}`,
    preferences.curriculum.enabled
      ? `CURRICULUM SEQUENCE: ${preferences.curriculum.sequence.join(" → ") || "not specified"}. ${preferences.curriculum.perTopicInstructions} Mastery check: ${preferences.curriculum.requireMasteryCheck ? "required" : "optional"}.`
      : "CURRICULUM POLICY: disabled; do not impose a configured topic sequence.",
    `MEMORY: ${preferences.memory.mode}; learning from sessions ${preferences.memory.learnFromSessions ? "enabled" : "disabled"}; learner-model context ${preferences.memory.includeInPrompt && preferences.privacy.allowLearnerModelInPrompts ? "allowed" : "withheld"}. Never mention hidden memory as certain fact; treat it as revisable evidence.`,
    bullets("ENABLED SKILLS", activeSkills.map((skill) => `${skill.name}: ${skill.instructions}`)),
    `TOOL PERMISSIONS: enabled ${enabledTools.join(", ") || "none"}. Disabled ${disabledTools.join(", ") || "none"}. Never emit an operation requiring a disabled tool. Python and code execution are not available. External web search is not available in this build.`,
    `ASSESSMENT: ${preferences.assessment.frequency}; ${preferences.assessment.questionStyle}; feedback ${preferences.assessment.feedbackTiming}; retry ${preferences.assessment.retryPolicy}; grading ${preferences.assessment.gradingStyle}. Rubric: ${preferences.assessment.rubricInstructions || "no custom rubric"}.`,
    `SESSION: open ${preferences.sessions.opening}; close ${preferences.sessions.closing}; continuity ${preferences.sessions.continuity}; target ${preferences.sessions.sessionLength} minutes; break after about ${preferences.sessions.breakEvery} minutes.`,
    preferences.sessions.autoNotes
      ? "Auto-notes are enabled: keep the chalkboard organized around concise, reusable key points."
      : "Auto-notes are disabled: do not add summary/key-point blocks unless asked.",
    `DIFFICULTY: ${preferences.difficulty}. Treat this as a real calibration target while preserving correctness and assistance-policy limits.`,
    `VOICE/STYLE: tone ${preferences.voice.tone}; verbosity ${preferences.voice.verbosity}/100; pace ${preferences.voice.pace}; humor ${preferences.voice.humor}/100; read equations aloud ${preferences.voice.readEquations ? "yes" : "no"}.`,
    bullets("CUSTOM COMMANDS", activeCommands.map((command) => `${command.command}: ${command.instruction}`)),
    bullets("BEHAVIOR TRIGGERS", activeTriggers.map((trigger) => `WHEN ${trigger.condition}, THEN ${trigger.action}`)),
    `TOOL AUTONOMY: ${preferences.advanced.autonomy}. Runtime response budget: ${preferences.advanced.maxResponseTokens} tokens with a ${preferences.advanced.requestTimeoutSeconds}-second request timeout.`,
    preferences.advanced.additionalInstructions ? `ADVANCED USER INSTRUCTIONS: ${preferences.advanced.additionalInstructions}` : "",
  ].filter(Boolean).join("\n\n");
}
