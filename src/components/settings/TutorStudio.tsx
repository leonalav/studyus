import { useEffect, useRef, useState, type ReactNode } from "react";
import "./TutorStudio.css";
import {
  Activity,
  Archive,
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Code2,
  Command,
  Copy,
  Download,
  Gauge,
  GraduationCap,
  History,
  Languages,
  Lock,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TestTube2,
  Trash2,
  Upload,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import {
  DEFAULT_TUTOR,
  MAX_TUTOR_VERSION_CHARS,
  MAX_TUTOR_VERSIONS,
  TUTOR_TOOL_IDS,
  sanitizePreferences,
  type StudyusPreferences,
  type TutorPreferences,
  type TutorToolId,
} from "../../lib/preferences";
import {
  clearTutorSessionLearnerMemory,
  forgetTutorSessionLearnerObservation,
  testTutorStudioPrompt,
} from "../../lib/tutor";
import { disputeHypothesis, getHypotheses } from "../../lib/learning/store";
import { HYPOTHESIS_KIND_REMEDY, type LearnerHypothesis } from "../../lib/learning/types";
import type { CurriculumNodeRecord } from "../../lib/curriculum";
import { useCurricula } from "../../state/curriculumStore";

type StudioSection =
  | "overview" | "identity" | "teaching" | "constitution" | "knowledge"
  | "curriculum" | "memory" | "skills" | "tools" | "assessment"
  | "sessions" | "voice" | "commands" | "triggers" | "privacy"
  | "advanced" | "versions" | "diagnostics" | "test";

const NAV: Array<{ id: StudioSection; label: string; icon: typeof Bot }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "identity", label: "Identity", icon: Bot },
  { id: "teaching", label: "Teaching", icon: GraduationCap },
  { id: "constitution", label: "Constitution", icon: ShieldCheck },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "curriculum", label: "Curriculum", icon: Archive },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "tools", label: "Agent tools", icon: Wrench },
  { id: "assessment", label: "Assessment", icon: ClipboardCheck },
  { id: "sessions", label: "Sessions", icon: Activity },
  { id: "voice", label: "Style & voice", icon: Volume2 },
  { id: "commands", label: "Commands", icon: Command },
  { id: "triggers", label: "Triggers", icon: SlidersHorizontal },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "advanced", label: "Advanced", icon: Code2 },
  { id: "versions", label: "Versions", icon: History },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
  { id: "test", label: "Test tutor", icon: TestTube2 },
];

const TOOL_META: Record<TutorToolId, { label: string; description: string; group: string }> = {
  boardWriting: { label: "Board writing", description: "Titles, notes, bullets, LaTeX and callouts", group: "Chalkboard" },
  boardEditing: { label: "Board editing", description: "Replace, insert, delete and revise existing blocks", group: "Chalkboard" },
  studyWidgets: { label: "Study widgets", description: "Roadmaps, concept cards, questions, hints, examples, retrieval checks and mastery cards", group: "Chalkboard" },
  threads: { label: "Thread creation", description: "Create logged child boards for separable investigations", group: "Chalkboard" },
  knowledgeSearch: { label: "Knowledge search", description: "Retrieve validated excerpts from selected curriculum", group: "Sources" },
  pdfKnowledge: { label: "Imported PDF reading", description: "Use transcribed content from imported curriculum PDFs", group: "Sources" },
  calculator: { label: "Calculator", description: "Deterministic /calculate expression command via math.js", group: "Mathematics" },
  symbolicAlgebra: { label: "Symbolic algebra", description: "Deterministic /simplify and /differentiate commands", group: "Mathematics" },
  geometry: { label: "Geometry", description: "Points, lines, circles, polygons, notation and constructions", group: "Visualizations" },
  diagrams: { label: "Semantic diagrams", description: "Flows, relationships and labeled systems", group: "Visualizations" },
  functionGraphing: { label: "2D function graphing", description: "Functions, roots, extrema, tangents, areas and asymptotes", group: "Visualizations" },
  graphing3d: { label: "3D graphing", description: "Surfaces, curves, point clouds and vector fields", group: "Visualizations" },
  dataVisualization: { label: "Data visualization", description: "Charts, statistical plots, heatmaps, trees and flows", group: "Visualizations" },
  equationRendering: { label: "Equation rendering", description: "Validated standalone KaTeX equation blocks", group: "Visualizations" },
  physics: { label: "Physics diagrams", description: "Mechanics, force, vector, ray and scene visualizations", group: "Science" },
  biology: { label: "Biology diagrams", description: "Cells, DNA, structures and pathway networks", group: "Science" },
  circuits: { label: "Circuit diagrams", description: "Validated electrical component and connection scenes", group: "Science" },
  chemistry: { label: "Chemistry structures", description: "Atoms, bonds, molecules and reaction schemes", group: "Science" },
  graphTheory: { label: "Graph networks", description: "Styled node-edge networks and graph-theory layouts", group: "Visualizations" },
  imageAnalysis: { label: "Image analysis", description: "Send attached images only when the bound model advertises vision", group: "Sources" },
  fileProcessing: { label: "Text and Markdown files", description: "Read bounded .txt and .md attachments as untrusted reference content", group: "Sources" },
};

function flattenCurriculumNodes(
  nodes: CurriculumNodeRecord[],
  result: CurriculumNodeRecord[] = []
): CurriculumNodeRecord[] {
  for (const node of nodes) {
    result.push(node);
    if (node.children?.length) flattenCurriculumNodes(node.children, result);
  }
  return result;
}

export function TutorStudio({ preferences, updatePreferences, onNotify }: {
  preferences: StudyusPreferences;
  updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void;
  onNotify: (text: string) => void;
}) {
  const [section, setSection] = useState<StudioSection>("overview");
  const tutor = preferences.tutor;
  const { curricula } = useCurricula();

  const updateTutor = (updater: (current: TutorPreferences) => TutorPreferences) => {
    updatePreferences((current) => ({ ...current, tutor: updater(current.tutor) }));
  };
  const patchTutor = (patch: Partial<TutorPreferences>) => updateTutor((current) => ({ ...current, ...patch }));

  return (
    <div className="-mx-1 flex h-[min(500px,62vh)] min-h-[390px] overflow-hidden rounded-lg border border-white/[0.07] bg-black/[0.08]">
      <nav aria-label="Tutor Studio" className="w-[132px] shrink-0 overflow-y-auto border-r border-white/[0.07] bg-black/[0.12] p-1.5">
        <div className="mb-2 flex items-center gap-2 rounded-md px-2 py-2">
          <TutorAvatar avatar={tutor.identity.avatar} name={tutor.identity.name} />
          <div className="min-w-0">
            <div className="truncate text-[11.5px] font-semibold text-fg">Tutor Studio</div>
            <div className="truncate text-[9.5px] text-dim">User-owned definition</div>
          </div>
        </div>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              aria-current={section === item.id ? "page" : undefined}
              className={`mb-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[10.5px] transition-colors ${
                section === item.id ? "bg-white/[0.12] text-fg" : "text-dim hover:bg-white/[0.06] hover:text-mut"
              }`}
            >
              <Icon size={11} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto px-3 py-3">
        {section === "overview" && <Overview tutor={tutor} curriculaCount={curricula.length} onOpen={setSection} />}
        {section === "identity" && <IdentityPanel tutor={tutor} updateTutor={updateTutor} onNotify={onNotify} />}
        {section === "teaching" && <TeachingPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "constitution" && <ConstitutionPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "knowledge" && <KnowledgePanel tutor={tutor} updateTutor={updateTutor} curricula={curricula} />}
        {section === "curriculum" && <CurriculumPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "memory" && <MemoryPanel tutor={tutor} updateTutor={updateTutor} onNotify={onNotify} />}
        {section === "skills" && <SkillsPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "tools" && <ToolsPanel tutor={tutor} patchTutor={patchTutor} />}
        {section === "assessment" && <AssessmentPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "sessions" && <SessionsPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "voice" && <VoicePanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "commands" && <CommandsPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "triggers" && <TriggersPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "privacy" && <PrivacyPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "advanced" && <AdvancedPanel tutor={tutor} updateTutor={updateTutor} />}
        {section === "versions" && (
          <VersionsPanel
            tutor={tutor}
            updatePreferences={updatePreferences}
            updateTutor={updateTutor}
            onNotify={onNotify}
          />
        )}
        {section === "diagnostics" && <DiagnosticsPanel />}
        {section === "test" && <TestPanel tutor={tutor} onNotify={onNotify} />}
      </main>
    </div>
  );
}

function Overview({ tutor, curriculaCount, onOpen }: { tutor: TutorPreferences; curriculaCount: number; onOpen: (section: StudioSection) => void }) {
  const enabledTools = TUTOR_TOOL_IDS.filter((id) => tutor.tools[id]).length;
  const cards: Array<[StudioSection, string, string, ReactNode]> = [
    ["identity", "Identity", tutor.identity.name, <TutorAvatar key="avatar" avatar={tutor.identity.avatar} name={tutor.identity.name} />],
    ["knowledge", "Knowledge", `${curriculaCount} imported source${curriculaCount === 1 ? "" : "s"}`, <BookOpen key="book" size={14} />],
    ["memory", "Memory", `${tutor.memory.mode} · ${tutor.memory.minimumEvidence}× evidence`, <Brain key="brain" size={14} />],
    ["tools", "Agent tools", `${enabledTools}/${TUTOR_TOOL_IDS.length} allowed`, <Wrench key="tool" size={14} />],
  ];
  return (
    <>
      <PanelTitle title="Tutor Studio" description="Program the tutor as a durable asset. Models remain replaceable executors." />
      <div className="mb-3 rounded-lg border border-accent/25 bg-accent/[0.06] p-3">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-fg"><ShieldCheck size={13} className="text-accent" /> Your tutor, not a personality preset</div>
        <p className="text-[11px] leading-relaxed text-mut">Identity, rules, sources, curriculum, memory, skills and tool permissions compile into every Tutor turn. Disabled tools are also filtered at runtime.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(([id, label, value, icon]) => (
          <button key={id} onClick={() => onOpen(id)} className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-2.5 text-left hover:bg-white/[0.06]">
            <div className="mb-2 flex h-6 w-6 items-center justify-center rounded bg-white/[0.08] text-mut">{icon}</div>
            <div className="text-[10px] uppercase tracking-wide text-dim">{label}</div>
            <div className="mt-0.5 truncate text-[12px] font-medium text-fg">{value}</div>
          </button>
        ))}
      </div>
      <Subhead>Active behavior</Subhead>
      <div className="rounded-lg border border-white/[0.07] bg-black/15 p-2.5 text-[11px] leading-relaxed text-mut">
        <strong className="text-fg">{tutor.identity.roleTemplate.replace(/-/g, " ")}</strong> · {tutor.teaching.topicStrategy.replace(/-/g, " ")} · {tutor.teaching.socraticMode} Socratic · {tutor.difficulty} difficulty · {tutor.assessment.frequency.replace(/-/g, " ")} assessment
      </div>
    </>
  );
}

function IdentityPanel({ tutor, updateTutor, onNotify }: PanelProps & { onNotify: (text: string) => void }) {
  const avatarInput = useRef<HTMLInputElement>(null);
  const identity = tutor.identity;
  const patch = (next: Partial<typeof identity>) => updateTutor((current) => ({ ...current, identity: { ...current.identity, ...next } }));
  const loadAvatar = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return onNotify("Choose an image for the Tutor avatar");
    if (file.size > 160_000) return onNotify("Avatar must be smaller than 160 KB");
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string" && result.startsWith("data:image/")) patch({ avatar: result });
      else onNotify("That avatar could not be read");
    };
    reader.onerror = () => onNotify("That avatar could not be read");
    reader.readAsDataURL(file);
  };
  return (
    <>
      <PanelTitle title="Tutor identity" description="A stable identity that stays yours when the underlying model changes." />
      <div className="mb-3 flex items-center gap-3 rounded-lg border border-white/[0.08] p-2.5">
        <TutorAvatar avatar={identity.avatar} name={identity.name} large />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-mut">Avatar</div>
          <div className="text-[10px] text-dim">Emoji, initials, URL, or a small local image</div>
        </div>
        <button onClick={() => avatarInput.current?.click()} className="studio-button"><Upload size={11} />Upload</button>
        <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; loadAvatar(file); }} />
      </div>
      <Label>Name</Label><Input value={identity.name} onChange={(name) => patch({ name })} />
      <Label>Description</Label><Textarea value={identity.description} onChange={(description) => patch({ description })} rows={2} />
      <Label>Avatar text or image URL</Label><Input value={identity.avatar.startsWith("data:") ? "Local image" : identity.avatar} disabled={identity.avatar.startsWith("data:")} onChange={(avatar) => patch({ avatar })} />
      <Label>Subjects</Label><CommaField value={identity.subjects} onChange={(subjects) => patch({ subjects })} placeholder="Mathematics, Physics" />
      <Label>Expertise</Label><CommaField value={identity.expertise} onChange={(expertise) => patch({ expertise })} placeholder="Calculus, Mechanics" />
      <div className="grid grid-cols-2 gap-2">
        <FieldGroup label="Learner level"><Select value={identity.learnerLevel} onChange={(learnerLevel) => patch({ learnerLevel: learnerLevel as typeof identity.learnerLevel })} options={["primary", "secondary", "undergraduate", "graduate", "mixed"]} /></FieldGroup>
        <FieldGroup label="Role template"><Select value={identity.roleTemplate} onChange={(roleTemplate) => patch({ roleTemplate: roleTemplate as typeof identity.roleTemplate })} options={["socratic-guide", "exam-coach", "concept-explainer", "research-mentor", "custom"]} /></FieldGroup>
      </div>
      <Label><Languages size={10} className="inline" /> Languages</Label><CommaField value={identity.languages} onChange={(languages) => patch({ languages })} placeholder="English, Vietnamese" />
      <Label>Core identity instructions</Label><Textarea value={identity.coreInstructions} onChange={(coreInstructions) => patch({ coreInstructions })} rows={4} />
    </>
  );
}

const APPROACHES = ["Socratic questioning", "First principles", "Worked examples", "Analogy-first", "Visual explanation", "Retrieval practice", "Project-based learning"];
function TeachingPanel({ tutor, updateTutor }: PanelProps) {
  const policy = tutor.teaching;
  const patch = (next: Partial<typeof policy>) => updateTutor((current) => ({ ...current, teaching: { ...current.teaching, ...next } }));
  const toggleApproach = (approach: string) => patch({ approaches: policy.approaches.includes(approach) ? policy.approaches.filter((item) => item !== approach) : [...policy.approaches, approach] });
  return (
    <>
      <PanelTitle title="Teaching policy" description="Compose pedagogical approaches and decide when the tutor may provide solutions." />
      <Subhead>Approaches</Subhead>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {APPROACHES.map((approach) => <Chip key={approach} active={policy.approaches.includes(approach)} onClick={() => toggleApproach(approach)}>{approach}</Chip>)}
      </div>
      <FieldGroup label="Topic strategy"><Select value={policy.topicStrategy} onChange={(topicStrategy) => patch({ topicStrategy: topicStrategy as typeof policy.topicStrategy })} options={["diagnose-first", "concept-first", "example-first", "practice-first"]} /></FieldGroup>
      <FieldGroup label="Adaptation"><Select value={policy.adaptation} onChange={(adaptation) => patch({ adaptation: adaptation as typeof policy.adaptation })} options={["steady", "responsive", "highly-adaptive"]} /></FieldGroup>
      <FieldGroup label="Socratic behavior"><Select value={policy.socraticMode} onChange={(socraticMode) => patch({ socraticMode: socraticMode as typeof policy.socraticMode })} options={["off", "light", "strict"]} /></FieldGroup>
      <FieldGroup label="Solution policy"><Select value={policy.solutionPolicy} onChange={(solutionPolicy) => patch({ solutionPolicy: solutionPolicy as typeof policy.solutionPolicy })} options={["never-first", "after-attempt", "on-request", "always-available"]} /></FieldGroup>
      <FieldGroup label="Second explanation"><Select value={policy.secondaryExplanation} onChange={(secondaryExplanation) => patch({ secondaryExplanation: secondaryExplanation as typeof policy.secondaryExplanation })} options={["analogy", "worked-example", "visual", "first-principles", "different-words"]} /></FieldGroup>
      <Subhead>Difficulty calibration</Subhead>
      <Segment value={tutor.difficulty} onChange={(difficulty) => updateTutor((current) => ({ ...current, difficulty: difficulty as typeof tutor.difficulty }))} options={["easier", "adaptive", "harder"]} />
    </>
  );
}

function ConstitutionPanel({ tutor, updateTutor }: PanelProps) {
  const patch = (key: keyof TutorPreferences["constitution"], value: string[]) => updateTutor((current) => ({ ...current, constitution: { ...current.constitution, [key]: value } }));
  return (
    <>
      <PanelTitle title="Tutor constitution" description="Hard rules outrank preferences; situational rules activate only in their stated context." />
      <RuleEditor title="Hard rules" hint="One non-negotiable rule per line" value={tutor.constitution.hardRules} onChange={(value) => patch("hardRules", value)} />
      <RuleEditor title="Preferences" hint="Default behavior that may yield to the learner's request" value={tutor.constitution.preferences} onChange={(value) => patch("preferences", value)} />
      <RuleEditor title="Situational behavior" hint="Write each rule with its condition" value={tutor.constitution.situational} onChange={(value) => patch("situational", value)} />
    </>
  );
}

function KnowledgePanel({ tutor, updateTutor, curricula }: PanelProps & { curricula: ReturnType<typeof useCurricula>["curricula"] }) {
  const knowledge = tutor.knowledge;
  const patch = (next: Partial<typeof knowledge>) => updateTutor((current) => ({ ...current, knowledge: { ...current.knowledge, ...next } }));
  const toggleSource = (id: string) => {
    const isSelected = knowledge.selectedSourceIds.includes(id);
    const selected = isSelected
      ? knowledge.selectedSourceIds.filter((sourceId) => sourceId !== id)
      : [...knowledge.selectedSourceIds, id];
    const sourceNodeIds = new Set(flattenCurriculumNodes(curricula.find((source) => source.id === id)?.nodes ?? []).map((node) => node.id));
    patch({
      selectedSourceIds: selected,
      selectedNodeIds: isSelected ? knowledge.selectedNodeIds.filter((nodeId) => !sourceNodeIds.has(nodeId)) : knowledge.selectedNodeIds,
      sourcePriority: [...knowledge.sourcePriority.filter((sourceId) => selected.includes(sourceId)), ...selected.filter((sourceId) => !knowledge.sourcePriority.includes(sourceId))],
    });
  };
  const moveSource = (id: string, direction: -1 | 1) => {
    const next = [...knowledge.sourcePriority];
    const index = next.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ sourcePriority: next });
  };
  const toggleNode = (id: string, sourceId: string) => {
    const isSelected = knowledge.selectedNodeIds.includes(id);
    patch({
      selectedNodeIds: isSelected ? knowledge.selectedNodeIds.filter((nodeId) => nodeId !== id) : [...knowledge.selectedNodeIds, id],
      selectedSourceIds: isSelected || knowledge.selectedSourceIds.includes(sourceId) ? knowledge.selectedSourceIds : [...knowledge.selectedSourceIds, sourceId],
      sourcePriority: isSelected || knowledge.sourcePriority.includes(sourceId) ? knowledge.sourcePriority : [...knowledge.sourcePriority, sourceId],
    });
  };
  return (
    <>
      <PanelTitle title="Knowledge boundaries" description="Choose which imported sources enter Tutor context and how source priority and citations behave." />
      <FieldGroup label="Source access"><Select value={knowledge.accessMode} onChange={(accessMode) => patch({ accessMode: accessMode as typeof knowledge.accessMode })} options={["session", "selected-first", "selected-only", "all"]} /></FieldGroup>
      <FieldGroup label="Citation policy"><Select value={knowledge.citationPolicy} onChange={(citationPolicy) => patch({ citationPolicy: citationPolicy as typeof knowledge.citationPolicy })} options={["always", "when-used", "on-request", "never"]} /></FieldGroup>
      <SwitchRow label="Allow general model knowledge" hint="Keep it clearly separate from supplied source evidence" checked={knowledge.allowGeneralKnowledge} onChange={(allowGeneralKnowledge) => patch({ allowGeneralKnowledge })} />
      <Label>Boundaries and authority</Label><Textarea value={knowledge.boundaries} onChange={(boundaries) => patch({ boundaries })} rows={3} />
      <Subhead>Imported PDF sources · highest priority first</Subhead>
      {curricula.length === 0 && <Empty text="No curriculum PDFs are imported yet. Add them from Curriculum." />}
      <div className="space-y-1.5">
        {[...curricula].sort((a, b) => {
          const ar = knowledge.sourcePriority.indexOf(a.id); const br = knowledge.sourcePriority.indexOf(b.id);
          return (ar < 0 ? 999 : ar) - (br < 0 ? 999 : br);
        }).map((source) => {
          const selected = knowledge.selectedSourceIds.includes(source.id);
          return (
            <div key={source.id} className="rounded-md border border-white/[0.08] bg-white/[0.025] p-2">
              <div className="flex items-center gap-2">
                <button onClick={() => toggleSource(source.id)} className={`grid h-4 w-4 place-items-center rounded border ${selected ? "border-accent bg-accent text-white" : "border-white/20"}`}>{selected && <Check size={10} />}</button>
                <div className="min-w-0 flex-1"><div className="truncate text-[11.5px] text-fg">{source.name}</div><div className="text-[9.5px] text-dim">{source.pageCount} pages · {source.extractionStatus.replace(/_/g, " ")}</div></div>
                {selected && <><IconButton label="Move up" onClick={() => moveSource(source.id, -1)}><ChevronUp size={11} /></IconButton><IconButton label="Move down" onClick={() => moveSource(source.id, 1)}><ChevronDown size={11} /></IconButton></>}
              </div>
              {selected && flattenCurriculumNodes(source.nodes).slice(0, 30).map((node) => (
                <button key={node.id} onClick={() => toggleNode(node.id, source.id)} className="mt-1 flex w-full items-center gap-1.5 text-left text-[9.5px] text-dim hover:text-mut" style={{ paddingLeft: `${24 + Math.min(node.depth, 4) * 10}px` }}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${knowledge.selectedNodeIds.includes(node.id) ? "border-accent bg-accent" : "border-white/15"}`} />
                  <span className="truncate">{node.sectionNumber ? `${node.sectionNumber} ` : ""}{node.title}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-3 rounded-md border border-white/[0.07] bg-black/15 p-2 text-[10px] text-dim">External web search is unavailable in this build. Tutor Studio will never present model recall as a live web result.</div>
    </>
  );
}

function CurriculumPanel({ tutor, updateTutor }: PanelProps) {
  const value = tutor.curriculum;
  const patch = (next: Partial<typeof value>) => updateTutor((current) => ({ ...current, curriculum: { ...current.curriculum, ...next } }));
  const [newPhase, setNewPhase] = useState("");
  const move = (index: number, direction: -1 | 1) => {
    const next = [...value.sequence]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ sequence: next });
  };
  return (
    <>
      <PanelTitle title="Curriculum behavior" description="Program a per-topic pedagogical sequence around the selected source material." />
      <SwitchRow label="Use curriculum sequencing" hint="When off, selected sources may still ground answers without imposing phases" checked={value.enabled} onChange={(enabled) => patch({ enabled })} />
      <SwitchRow label="Require mastery check" hint="Check transfer before moving to the next phase" checked={value.requireMasteryCheck} onChange={(requireMasteryCheck) => patch({ requireMasteryCheck })} />
      <Subhead>Topic sequence</Subhead>
      <div className="space-y-1">
        {value.sequence.map((phase, index) => (
          <div key={`${phase}-${index}`} className="flex items-center gap-1.5 rounded border border-white/[0.07] px-2 py-1.5">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-white/[0.08] text-[9px] text-dim">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-fg">{phase}</span>
            <IconButton label="Move up" onClick={() => move(index, -1)}><ChevronUp size={10} /></IconButton>
            <IconButton label="Move down" onClick={() => move(index, 1)}><ChevronDown size={10} /></IconButton>
            <IconButton label="Remove" onClick={() => patch({ sequence: value.sequence.filter((_, itemIndex) => itemIndex !== index) })}><X size={10} /></IconButton>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5"><Input value={newPhase} onChange={setNewPhase} placeholder="Add phase" /><button className="studio-button" onClick={() => { if (newPhase.trim()) { patch({ sequence: [...value.sequence, newPhase.trim()] }); setNewPhase(""); } }}><Plus size={11} />Add</button></div>
      <Label>Per-topic instructions</Label><Textarea value={value.perTopicInstructions} onChange={(perTopicInstructions) => patch({ perTopicInstructions })} rows={4} />
    </>
  );
}

/** How a hypothesis status should read to the person it is about. */
const HYPOTHESIS_STATUS_LABEL: Record<LearnerHypothesis["status"], string> = {
  suspected: "Being checked",
  supported: "Seen more than once",
  resolved: "No longer applies",
  disputed: "You disagreed",
};

/**
 * What the tutor currently believes about the learner, and the button that
 * lets them say no.
 *
 * Until this existed the structured learner model was invisible: claims about a
 * person were used to route their instruction and there was no surface on which
 * they could see, let alone contest, any of it. Two things make the difference
 * between a learner model and a permanent record — the learner can read it, and
 * the learner can reject an entry. A disputed hypothesis never enters prompt
 * context again, and no later observation revives it.
 *
 * Resolved claims stay listed rather than disappearing, because seeing a
 * misconception marked "no longer applies" is a piece of evidence about
 * progress that a learner has earned and should get to keep.
 */
function HypothesesSection() {
  const [hypotheses, setHypotheses] = useState<LearnerHypothesis[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      setHypotheses(await getHypotheses());
    } catch {
      setHypotheses([]);
    }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const dispute = async (hypothesis: LearnerHypothesis) => {
    const note = window.prompt(
      `Tell the tutor why this is wrong (optional). It will stop using this and will not raise it again.\n\n"${hypothesis.statement}"`,
      ""
    );
    // A null return is the learner cancelling the dialog, which is not the same
    // as disputing with an empty note.
    if (note === null) return;
    await disputeHypothesis(hypothesis.hypothesisId, note);
    await refresh();
  };

  return (
    <>
      <Subhead>What the tutor thinks · {hypotheses.length}</Subhead>
      {loading ? (
        <Empty text="Loading…" />
      ) : hypotheses.length === 0 ? (
        <Empty text="No standing hypotheses. The tutor has not formed a testable claim about you yet." />
      ) : (
        <div className="space-y-1.5">
          {hypotheses.slice(0, 20).map((hypothesis) => (
            <div key={hypothesis.hypothesisId} className="rounded-md border border-white/[0.07] p-2">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[9px] uppercase tracking-wide text-dim">
                    {hypothesis.kind.replace(/_/g, " ")} · {HYPOTHESIS_STATUS_LABEL[hypothesis.status]} · {hypothesis.skillId}
                  </div>
                  <div className="mt-0.5 text-[10.5px] leading-relaxed text-mut">{hypothesis.statement}</div>
                  <div className="mt-1 text-[9.5px] leading-relaxed text-dim">
                    How it gets checked: {hypothesis.nextBestTest}
                  </div>
                  <div className="mt-1 text-[9.5px] leading-relaxed text-dim">
                    {HYPOTHESIS_KIND_REMEDY[hypothesis.kind]}
                  </div>
                  {hypothesis.disputeNote ? (
                    <div className="mt-1 text-[9.5px] italic leading-relaxed text-dim">
                      You said: {hypothesis.disputeNote}
                    </div>
                  ) : null}
                </div>
                {hypothesis.learnerDisputed ? null : (
                  <IconButton label="I disagree with this" onClick={() => void dispute(hypothesis)}>
                    <X size={11} />
                  </IconButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MemoryPanel({ tutor, updateTutor, onNotify }: PanelProps & { onNotify: (text: string) => void }) {
  const [hypotheses, setHypotheses] = useState<LearnerHypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const memory = tutor.memory;
  const patch = (next: Partial<typeof memory>) => updateTutor((current) => ({ ...current, memory: { ...current.memory, ...next } }));
  const refresh = async () => { setLoading(true); setHypotheses(await getHypotheses()); setLoading(false); };
  useEffect(() => { void refresh(); }, []);
  return (
    <>
      <PanelTitle title="Learner memory" description="Inspectable, revisable learner evidence owned by the learner—not by the model." />
      <FieldGroup label="Memory scope"><Select value={memory.mode} onChange={(mode) => patch({ mode: mode as typeof memory.mode })} options={["off", "session", "persistent"]} /></FieldGroup>
      <SwitchRow label="Learn from sessions" hint="Consume validated Tutor diagnoses under the evidence threshold" checked={memory.learnFromSessions} onChange={(learnFromSessions) => patch({ learnFromSessions })} />
      <SwitchRow label="Use memory in prompts" hint="Still subject to the privacy permission" checked={memory.includeInPrompt} onChange={(includeInPrompt) => patch({ includeInPrompt })} />
      <div className="grid grid-cols-2 gap-x-2"><SwitchRow label="Misconceptions" checked={memory.rememberMisconceptions} onChange={(rememberMisconceptions) => patch({ rememberMisconceptions })} /><SwitchRow label="Weak areas" checked={memory.rememberWeakAreas} onChange={(rememberWeakAreas) => patch({ rememberWeakAreas })} /></div>
      <SwitchRow label="Calibration patterns" checked={memory.rememberCalibration} onChange={(rememberCalibration) => patch({ rememberCalibration })} />
      <div className="grid grid-cols-2 gap-2">
        <FieldGroup label="Minimum evidence"><Select value={String(memory.minimumEvidence)} onChange={(value) => patch({ minimumEvidence: Number(value) as 1 | 2 | 3 })} options={["1", "2", "3"]} /></FieldGroup>
        <FieldGroup label="Retention"><Select value={String(memory.retentionDays)} onChange={(value) => patch({ retentionDays: Number(value) as typeof memory.retentionDays })} options={["30", "90", "180", "365", "0"]} labels={{ "0": "Forever" }} /></FieldGroup>
      </div>
      <HypothesesSection />
      <Subhead>Structured hypotheses · {hypotheses.length}</Subhead>
      {loading ? <Empty text="Loading hypotheses…" /> : hypotheses.length === 0 ? <Empty text="No standing hypotheses about this learner." /> : (
        <div className="space-y-1.5">
          {hypotheses.slice(0, 30).map((entry) => (
            <div key={entry.hypothesisId} className="flex gap-2 rounded-md border border-white/[0.07] p-2">
              <div className="min-w-0 flex-1"><div className="text-[9px] uppercase tracking-wide text-dim">{entry.kind.replace(/_/g, " ")} · {entry.status}</div><div className="mt-0.5 text-[10.5px] leading-relaxed text-mut">{entry.statement}</div></div>
              <IconButton label="Forget hypothesis" onClick={() => void disputeHypothesis(entry.hypothesisId, "Learner disagreed").then(() => { forgetTutorSessionLearnerObservation(entry.statement); return refresh(); })}><Trash2 size={11} /></IconButton>
            </div>
          ))}
        </div>
      )}
      <button className="studio-button mt-2 text-red-300" onClick={() => { if (window.confirm("Forget all standing learner hypotheses? This cannot be undone.")) void clearTutorSessionLearnerMemory(); onNotify("Session memory cleared"); }}><Trash2 size={11} />Forget session memory</button>
    </>
  );
}

function SkillsPanel({ tutor, updateTutor }: PanelProps) {
  const [name, setName] = useState(""); const [instructions, setInstructions] = useState("");
  const setSkills = (skills: TutorPreferences["skills"]) => updateTutor((current) => ({ ...current, skills }));
  return (
    <>
      <PanelTitle title="Skills" description="Reusable instruction modules that travel with this tutor definition." />
      <div className="space-y-1.5">{tutor.skills.map((skill) => (
        <ListCard key={skill.id} title={skill.name} detail={skill.instructions} enabled={skill.enabled} onToggle={() => setSkills(tutor.skills.map((item) => item.id === skill.id ? { ...item, enabled: !item.enabled } : item))} onDelete={() => setSkills(tutor.skills.filter((item) => item.id !== skill.id))} />
      ))}</div>
      <Subhead>Add skill</Subhead><Input value={name} onChange={setName} placeholder="Skill name" /><div className="mt-1.5"><Textarea value={instructions} onChange={setInstructions} placeholder="When and how the tutor should use it" rows={3} /></div>
      <button className="studio-button mt-2" onClick={() => { if (name.trim() && instructions.trim()) { setSkills([...tutor.skills, { id: `skill-${Date.now()}`, name: name.trim(), instructions: instructions.trim(), enabled: true }]); setName(""); setInstructions(""); } }}><Plus size={11} />Add skill</button>
    </>
  );
}

function ToolsPanel({ tutor, patchTutor }: { tutor: TutorPreferences; patchTutor: (patch: Partial<TutorPreferences>) => void }) {
  const groups = [...new Set(TUTOR_TOOL_IDS.map((id) => TOOL_META[id].group))];
  return (
    <>
      <PanelTitle title="Agent tools" description="Permissions for actual Chalkboard-mode capabilities. Runtime filtering enforces every switch." />
      {groups.map((group) => <div key={group}><Subhead>{group}</Subhead>{TUTOR_TOOL_IDS.filter((id) => TOOL_META[id].group === group).map((id) => <SwitchRow key={id} label={TOOL_META[id].label} hint={TOOL_META[id].description} checked={tutor.tools[id]} onChange={(enabled) => patchTutor({ tools: { ...tutor.tools, [id]: enabled } })} />)}</div>)}
      <Subhead>Unavailable by design</Subhead>
      <StatusRow label="External web search" detail="No audited search provider is configured" />
      <StatusRow label="Python execution" detail="Excluded from Tutor Studio scope" />
      <StatusRow label="Code execution" detail="Excluded from Tutor Studio scope" />
    </>
  );
}

function AssessmentPanel({ tutor, updateTutor }: PanelProps) {
  const value = tutor.assessment;
  const patch = (next: Partial<typeof value>) => updateTutor((current) => ({ ...current, assessment: { ...current.assessment, ...next } }));
  return <><PanelTitle title="Assessment policy" description="Control formative checks inside tutoring sessions; the dedicated test suite remains independent." />
    <FieldGroup label="Frequency"><Select value={value.frequency} onChange={(frequency) => patch({ frequency: frequency as typeof value.frequency })} options={["only-when-asked", "occasional", "each-topic"]} /></FieldGroup>
    <FieldGroup label="Question style"><Select value={value.questionStyle} onChange={(questionStyle) => patch({ questionStyle: questionStyle as typeof value.questionStyle })} options={["short-answer", "mixed", "exam-style", "proof-and-reasoning"]} /></FieldGroup>
    <FieldGroup label="Feedback timing"><Select value={value.feedbackTiming} onChange={(feedbackTiming) => patch({ feedbackTiming: feedbackTiming as typeof value.feedbackTiming })} options={["immediate", "after-retry", "at-end"]} /></FieldGroup>
    <FieldGroup label="Retry policy"><Select value={value.retryPolicy} onChange={(retryPolicy) => patch({ retryPolicy: retryPolicy as typeof value.retryPolicy })} options={["hint-then-retry", "retry-once", "show-correction"]} /></FieldGroup>
    <FieldGroup label="Grading style"><Select value={value.gradingStyle} onChange={(gradingStyle) => patch({ gradingStyle: gradingStyle as typeof value.gradingStyle })} options={["supportive", "strict", "rubric-led"]} /></FieldGroup>
    <Label>Rubric instructions</Label><Textarea value={value.rubricInstructions} onChange={(rubricInstructions) => patch({ rubricInstructions })} rows={4} />
  </>;
}

function SessionsPanel({ tutor, updateTutor }: PanelProps) {
  const value = tutor.sessions;
  const patch = (next: Partial<typeof value>) => updateTutor((current) => { const sessions = { ...current.sessions, ...next }; return { ...current, sessions, sessionLength: sessions.sessionLength, breakEvery: sessions.breakEvery, autoNotes: sessions.autoNotes }; });
  return <><PanelTitle title="Session lifecycle" description="Opening, continuity, pacing, notes and closing behavior." />
    <FieldGroup label="Opening behavior"><Select value={value.opening} onChange={(opening) => patch({ opening: opening as typeof value.opening })} options={["ask-goal", "resume", "quick-diagnostic", "start-directly"]} /></FieldGroup>
    <FieldGroup label="Continuity"><Select value={value.continuity} onChange={(continuity) => patch({ continuity: continuity as typeof value.continuity })} options={["resume-context", "fresh-each-time"]} /></FieldGroup>
    <FieldGroup label="Closing behavior"><Select value={value.closing} onChange={(closing) => patch({ closing: closing as typeof value.closing })} options={["recap", "exit-ticket", "next-steps", "none"]} /></FieldGroup>
    <Range label={`Session target · ${value.sessionLength} min`} value={value.sessionLength} min={10} max={90} onChange={(sessionLength) => patch({ sessionLength })} />
    <Range label={`Break reminder · ${value.breakEvery} min`} value={value.breakEvery} min={10} max={60} onChange={(breakEvery) => patch({ breakEvery })} />
    <SwitchRow label="Auto-notes" hint="Ask the tutor to maintain concise reusable board notes" checked={value.autoNotes} onChange={(autoNotes) => patch({ autoNotes })} />
  </>;
}

function VoicePanel({ tutor, updateTutor }: PanelProps) {
  const value = tutor.voice;
  const patch = (next: Partial<typeof value>) => updateTutor((current) => { const voice = { ...current.voice, ...next }; return { ...current, voice, voiceReplies: voice.voiceReplies }; });
  return <><PanelTitle title="Style & voice" description="Communication controls without reducing the tutor to a personality preset." />
    <SwitchRow label="Voice replies" hint="Read Tutor replies aloud in StudyRoom" checked={value.voiceReplies} onChange={(voiceReplies) => patch({ voiceReplies })} />
    <FieldGroup label="Tone"><Select value={value.tone} onChange={(tone) => patch({ tone: tone as typeof value.tone })} options={["warm", "neutral", "formal", "direct", "encouraging"]} /></FieldGroup>
    <FieldGroup label="Speaking pace"><Select value={value.pace} onChange={(pace) => patch({ pace: pace as typeof value.pace })} options={["slow", "measured", "normal", "brisk"]} /></FieldGroup>
    <Range label={`Response detail · ${value.verbosity}/100`} value={value.verbosity} onChange={(verbosity) => patch({ verbosity })} />
    <Range label={`Humor · ${value.humor}/100`} value={value.humor} onChange={(humor) => patch({ humor })} />
    <SwitchRow label="Read equations aloud" hint="Ask the agent to verbalize notation when voice is used" checked={value.readEquations} onChange={(readEquations) => patch({ readEquations })} />
  </>;
}

function CommandsPanel({ tutor, updateTutor }: PanelProps) {
  const [command, setCommand] = useState("/"); const [instruction, setInstruction] = useState("");
  const setCommands = (commands: TutorPreferences["commands"]) => updateTutor((current) => ({ ...current, commands }));
  return <><PanelTitle title="Custom commands" description="Slash commands compile into the Tutor system policy. Math tool commands are listed under Agent tools." />
    <div className="space-y-1.5">{tutor.commands.map((item) => <ListCard key={item.id} title={item.command} detail={item.instruction} enabled={item.enabled} onToggle={() => setCommands(tutor.commands.map((candidate) => candidate.id === item.id ? { ...candidate, enabled: !candidate.enabled } : candidate))} onDelete={() => setCommands(tutor.commands.filter((candidate) => candidate.id !== item.id))} />)}</div>
    <Subhead>Add command</Subhead><Input value={command} onChange={setCommand} placeholder="/command" /><div className="mt-1.5"><Textarea value={instruction} onChange={setInstruction} placeholder="Exact behavior when invoked" rows={3} /></div>
    <button className="studio-button mt-2" onClick={() => { const normalized = command.trim().startsWith("/") ? command.trim() : `/${command.trim()}`; if (normalized.length > 1 && instruction.trim()) { setCommands([...tutor.commands, { id: `cmd-${Date.now()}`, command: normalized, instruction: instruction.trim(), enabled: true }]); setCommand("/"); setInstruction(""); } }}><Plus size={11} />Add command</button>
  </>;
}

function TriggersPanel({ tutor, updateTutor }: PanelProps) {
  const [condition, setCondition] = useState(""); const [action, setAction] = useState("");
  const setTriggers = (triggers: TutorPreferences["triggers"]) => updateTutor((current) => ({ ...current, triggers }));
  return <><PanelTitle title="Behavior triggers" description="Conditional agent behavior evaluated from the current conversation context." />
    <div className="space-y-1.5">{tutor.triggers.map((item) => <ListCard key={item.id} title={`When ${item.condition}`} detail={item.action} enabled={item.enabled} onToggle={() => setTriggers(tutor.triggers.map((candidate) => candidate.id === item.id ? { ...candidate, enabled: !candidate.enabled } : candidate))} onDelete={() => setTriggers(tutor.triggers.filter((candidate) => candidate.id !== item.id))} />)}</div>
    <Subhead>Add trigger</Subhead><Input value={condition} onChange={setCondition} placeholder="Condition in the conversation" /><div className="mt-1.5"><Textarea value={action} onChange={setAction} placeholder="Action the tutor should take" rows={3} /></div>
    <button className="studio-button mt-2" onClick={() => { if (condition.trim() && action.trim()) { setTriggers([...tutor.triggers, { id: `trigger-${Date.now()}`, condition: condition.trim(), action: action.trim(), enabled: true }]); setCondition(""); setAction(""); } }}><Plus size={11} />Add trigger</button>
  </>;
}

function PrivacyPanel({ tutor, updateTutor }: PanelProps) {
  const value = tutor.privacy;
  const patch = (next: Partial<typeof value>) => updateTutor((current) => ({ ...current, privacy: { ...current.privacy, ...next } }));
  return <><PanelTitle title="Privacy & ownership" description="Definitions live locally in saved preferences and learner memory remains inspectable and deletable." />
    <div className="mb-3 rounded-md border border-emerald-400/20 bg-emerald-400/[0.05] p-2.5 text-[10.5px] leading-relaxed text-mut"><Lock size={11} className="mr-1 inline text-emerald-300" />Tutor definitions are model-independent. Only context explicitly permitted below enters a bound model request.</div>
    <SwitchRow label="Learner model in prompts" hint="Allow saved misconceptions and weak areas as revisable context" checked={value.allowLearnerModelInPrompts} onChange={(allowLearnerModelInPrompts) => patch({ allowLearnerModelInPrompts })} />
    <SwitchRow label="Curriculum text in prompts" hint="Required for grounded imported-source answers" checked={value.allowCurriculumInPrompts} onChange={(allowCurriculumInPrompts) => patch({ allowCurriculumInPrompts })} />
    <SwitchRow label="Image data in prompts" hint="Also requires Image analysis permission and a vision model" checked={value.allowImageDataInPrompts} onChange={(allowImageDataInPrompts) => patch({ allowImageDataInPrompts })} />
    <SwitchRow label="Text file data in prompts" hint="Also requires Text and Markdown files permission" checked={value.allowFileDataInPrompts} onChange={(allowFileDataInPrompts) => patch({ allowFileDataInPrompts })} />
    <SwitchRow label="Share profile name" hint="Off by default; subject and level remain part of Tutor identity" checked={value.includeProfileIdentity} onChange={(includeProfileIdentity) => patch({ includeProfileIdentity })} />
  </>;
}

function AdvancedPanel({ tutor, updateTutor }: PanelProps) {
  const value = tutor.advanced;
  const patch = (next: Partial<typeof value>) => updateTutor((current) => ({ ...current, advanced: { ...current.advanced, ...next } }));
  return <><PanelTitle title="Advanced instructions" description="Model-call controls and additional owner instructions. Core safety and schema rules always remain higher priority." />
    <FieldGroup label="Tool autonomy"><Select value={value.autonomy} onChange={(autonomy) => patch({ autonomy: autonomy as typeof value.autonomy })} options={["ask-first", "balanced", "proactive"]} /></FieldGroup>
    <Range label={`Temperature · ${(value.temperature / 100).toFixed(2)}`} value={value.temperature} onChange={(temperature) => patch({ temperature })} />
    <Range label={`Maximum response · ${value.maxResponseTokens} tokens`} value={value.maxResponseTokens} min={512} max={8192} step={128} onChange={(maxResponseTokens) => patch({ maxResponseTokens })} />
    <Range label={`Request timeout · ${value.requestTimeoutSeconds} sec`} value={value.requestTimeoutSeconds} min={15} max={20} step={1} onChange={(requestTimeoutSeconds) => patch({ requestTimeoutSeconds })} />
    <Label>Additional system instructions</Label><Textarea value={value.additionalInstructions} onChange={(additionalInstructions) => patch({ additionalInstructions })} rows={8} placeholder="Instructions appended below the core Tutor contract" />
  </>;
}

function VersionsPanel({ tutor, updatePreferences, updateTutor, onNotify }: PanelProps & { updatePreferences: (updater: (current: StudyusPreferences) => StudyusPreferences) => void; onNotify: (text: string) => void }) {
  const importRef = useRef<HTMLInputElement>(null);
  const serialize = () => JSON.stringify({ ...tutor, versions: [] });
  const saveVersion = () => {
    const serializedDefinition = serialize();
    if (serializedDefinition.length > MAX_TUTOR_VERSION_CHARS) {
      onNotify("This Tutor definition is too large to snapshot; export it instead");
      return;
    }
    const label = window.prompt("Version label", `Version ${tutor.versions.length + 1}`)?.trim(); if (!label) return;
    updateTutor((current) => ({ ...current, versions: [{ id: `version-${Date.now()}`, label, createdAt: new Date().toISOString(), serializedDefinition }, ...current.versions].slice(0, MAX_TUTOR_VERSIONS) }));
    onNotify(`Saved Tutor version “${label}”`);
  };
  const cloneCurrent = () => {
    const serializedDefinition = serialize();
    if (serializedDefinition.length > MAX_TUTOR_VERSION_CHARS) {
      onNotify("This Tutor definition is too large to clone safely; export it instead");
      return;
    }
    updateTutor((current) => ({
      ...current,
      identity: { ...current.identity, id: `tutor-${Date.now()}`, name: `${current.identity.name} Copy` },
      versions: [{ id: `version-${Date.now()}`, label: `Before cloning ${current.identity.name}`, createdAt: new Date().toISOString(), serializedDefinition }, ...current.versions].slice(0, MAX_TUTOR_VERSIONS),
    }));
    onNotify("Cloned Tutor definition as the current Tutor");
  };
  const restore = (serializedDefinition: string) => {
    try {
      const parsed = JSON.parse(serializedDefinition);
      updatePreferences((current) => {
        const restored = sanitizePreferences({ ...current, tutor: { ...parsed, versions: current.tutor.versions } });
        return restored;
      });
      onNotify("Tutor version restored");
    } catch { onNotify("This Tutor version is invalid"); }
  };
  const exportTutor = () => {
    const blob = new Blob([JSON.stringify({ kind: "studyus-tutor", version: 1, tutor: { ...tutor, versions: [] } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${tutor.identity.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "tutor"}.studyus-tutor.json`; anchor.click(); URL.revokeObjectURL(url);
    onNotify("Tutor definition exported");
  };
  const importTutor = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      onNotify("Tutor definition must be smaller than 1 MB");
      return;
    }
    try {
      const payload: unknown = JSON.parse(await file.text());
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid Tutor definition");
      const wrapper = payload as { kind?: unknown; version?: unknown; tutor?: unknown };
      const hasWrapperMetadata = "kind" in wrapper || "version" in wrapper || "tutor" in wrapper;
      if (hasWrapperMetadata && (wrapper.kind !== "studyus-tutor" || wrapper.version !== 1)) {
        throw new Error("Unsupported Tutor definition format");
      }
      const imported = hasWrapperMetadata ? wrapper.tutor : payload;
      if (!imported || typeof imported !== "object" || Array.isArray(imported)) throw new Error("Invalid Tutor definition");
      const definition = imported as Record<string, unknown>;
      if (!["schemaVersion", "identity", "teaching", "styles", "activeStyleId"].some((key) => key in definition)) {
        throw new Error("Invalid Tutor definition shape");
      }
      updatePreferences((current) => sanitizePreferences({ ...current, tutor: { ...definition, versions: current.tutor.versions } }));
      onNotify("Tutor definition imported");
    } catch { onNotify("Could not import that Tutor definition"); }
  };
  return <><PanelTitle title="Versions & portability" description="Snapshot, restore, clone, import and export the user-owned tutor without its model binding." />
    <div className="mb-3 grid grid-cols-2 gap-1.5">
      <button className="studio-button justify-center" onClick={saveVersion}><Save size={11} />Save version</button>
      <button className="studio-button justify-center" onClick={exportTutor}><Download size={11} />Export</button>
      <button className="studio-button justify-center" onClick={() => importRef.current?.click()}><Upload size={11} />Import</button>
      <button className="studio-button justify-center" onClick={cloneCurrent}><Copy size={11} />Clone as current</button>
      <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void importTutor(file); }} />
    </div>
    <Subhead>Saved versions · {tutor.versions.length}</Subhead>
    {tutor.versions.length === 0 ? <Empty text="No snapshots yet." /> : <div className="space-y-1.5">{tutor.versions.map((version) => <div key={version.id} className="flex items-center gap-2 rounded-md border border-white/[0.07] p-2"><div className="min-w-0 flex-1"><div className="truncate text-[11px] text-fg">{version.label}</div><div className="text-[9px] text-dim">{new Date(version.createdAt).toLocaleString()}</div></div><button className="studio-button" onClick={() => restore(version.serializedDefinition)}><RotateCcw size={10} />Restore</button><IconButton label="Delete version" onClick={() => updateTutor((current) => ({ ...current, versions: current.versions.filter((item) => item.id !== version.id) }))}><Trash2 size={10} /></IconButton></div>)}</div>}
    <Subhead>Reset definition</Subhead><button className="studio-button text-red-300" onClick={() => { if (window.confirm("Reset the Tutor definition to defaults? Learner memory is not deleted.")) updateTutor(() => ({ ...DEFAULT_TUTOR, versions: tutor.versions })); }}><Trash2 size={11} />Reset Tutor Studio</button>
  </>;
}

interface TutorDiagnostic {
  modelId: string;
  latencyMs: number;
  outcome: string;
  tokenTotal: number | null;
  failureClass: string;
  timestamp: string;
}

function DiagnosticsPanel() {
  const [entries, setEntries] = useState<TutorDiagnostic[]>([]);
  const [traceEntries, setTraceEntries] = useState<Array<{
    id: string;
    sessionId: string;
    learnerId: string;
    totalMs: number;
    phaseCount: number;
    phases: Array<{ phase: string; ms: number }>;
    createdAt: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setLoading(true);
    try {
      const { getDb } = await import("../../db/database");
      const db = await getDb();
      const result = db.exec(`
        SELECT model_id, latency_ms, outcome, token_counts_json, failure_class, timestamp
        FROM agent_calls
        WHERE role = 'tutor'
        ORDER BY timestamp DESC
        LIMIT 50;
      `);
      const next = (result[0]?.values ?? []).map((row) => {
        let tokenTotal: number | null = null;
        try {
          const parsed = JSON.parse(String(row[3] || "{}")) as { total?: unknown };
          if (typeof parsed.total === "number" && Number.isFinite(parsed.total)) tokenTotal = parsed.total;
        } catch {}
        return {
          modelId: String(row[0] ?? "Unknown model"),
          latencyMs: Number(row[1]) || 0,
          outcome: String(row[2] ?? "unknown"),
          tokenTotal,
          failureClass: String(row[4] ?? ""),
          timestamp: String(row[5] ?? ""),
        };
      });
      setEntries(next);
      // Read the most recent turn traces. Phase list surfaces what each turn
      // actually did — policy, grounding, llm-call, ground-mastery, the four
      // surviving enforcers, contract, persist, end.
      const { getRecentTurnTraces } = await import("../../lib/learning/tracing");
      const traces = await getRecentTurnTraces(20);
      setTraceEntries(traces.map((record) => ({
        id: record.id,
        sessionId: record.sessionId,
        learnerId: record.learnerId,
        totalMs: Math.round(record.trace.totalMs),
        phaseCount: record.trace.phases.length,
        phases: record.trace.phases.map((phase) => ({ phase: phase.phase, ms: Math.round(phase.ms) })),
        createdAt: record.createdAt,
      })));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  const successes = entries.filter((entry) => entry.outcome === "success").length;
  return <>
    <PanelTitle title="Tutor diagnostics" description="Inspect the latest 50 persisted live Tutor model calls. Isolated Studio previews are intentionally excluded." />
    <div className="mb-3 grid grid-cols-3 gap-1.5">
      <Metric label="Calls" value={String(entries.length)} />
      <Metric label="Successful" value={entries.length ? `${Math.round((successes / entries.length) * 100)}%` : "—"} />
      <Metric label="Latest latency" value={entries[0] ? `${entries[0].latencyMs} ms` : "—"} />
    </div>
    <button className="studio-button mb-2" disabled={loading} onClick={() => void refresh()}><RotateCcw size={11} className={loading ? "animate-spin" : ""} />Refresh</button>
    {loading ? <Empty text="Loading Tutor diagnostics…" /> : entries.length === 0 ? <Empty text="No live Tutor calls have been recorded yet." /> : (
      <div className="space-y-1.5">
        {entries.map((entry, index) => (
          <div key={`${entry.timestamp}-${index}`} className="rounded-md border border-white/[0.07] p-2">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${entry.outcome === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-fg">{entry.modelId}</span>
              <span className="text-[9px] uppercase tracking-wide text-dim">{entry.outcome}</span>
            </div>
            <div className="mt-1 text-[9.5px] text-dim">{entry.latencyMs} ms{entry.tokenTotal !== null ? ` · ${entry.tokenTotal} tokens` : ""}{entry.timestamp ? ` · ${new Date(entry.timestamp).toLocaleString()}` : ""}</div>
            {entry.failureClass && <div className="mt-1 text-[9.5px] text-red-300">{entry.failureClass}</div>}
          </div>
        ))}
      </div>
    )}
    <Subhead>Recent traces · {traceEntries.length}</Subhead>
    {traceEntries.length === 0 ? (
      <Empty text="No turn traces persisted yet." />
    ) : (
      <div className="space-y-1.5">
        {traceEntries.map((trace) => (
          <div key={trace.id} className="rounded-md border border-white/[0.07] p-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-fg">{trace.sessionId}</span>
              <span className="text-[9px] uppercase tracking-wide text-dim">{trace.totalMs} ms · {trace.phaseCount} phases</span>
            </div>
            <div className="mt-1 text-[9.5px] text-dim">{new Date(trace.createdAt).toLocaleString()}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {trace.phases.map((phase) => (
                <span
                  key={phase.phase}
                  className="rounded bg-white/[0.06] px-1 py-[1px] font-mono text-[9px] text-mut"
                  title={`${phase.phase} · ${phase.ms} ms`}
                >
                  {phase.phase}:{phase.ms}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    )}
  </>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-white/[0.07] bg-white/[0.025] p-2"><div className="text-[9px] uppercase tracking-wide text-dim">{label}</div><div className="mt-0.5 text-[12px] font-medium text-fg">{value}</div></div>;
}

function TestPanel({ tutor, onNotify }: { tutor: TutorPreferences; onNotify: (text: string) => void }) {
  const [prompt, setPrompt] = useState("I keep confusing velocity with acceleration. Help me understand without giving everything away.");
  const [response, setResponse] = useState(""); const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const run = async () => {
    controller.current?.abort(); const next = new AbortController(); controller.current = next; setRunning(true); setResponse("");
    try { setResponse(await testTutorStudioPrompt(prompt, tutor, next.signal)); } catch (error) { if (!next.signal.aborted) onNotify(error instanceof Error ? error.message : "Tutor test failed"); } finally { if (controller.current === next) { controller.current = null; setRunning(false); } }
  };
  useEffect(() => () => controller.current?.abort(), []);
  return <><PanelTitle title="Test tutor" description="Isolated model preview: no session, memory, source retrieval, or board operation is saved or applied." />
    <Label>Sample learner prompt</Label><Textarea value={prompt} onChange={setPrompt} rows={5} />
    <button className="studio-button mt-2 bg-accent text-white" disabled={running || !prompt.trim()} onClick={() => void run()}>{running ? <Activity size={11} className="animate-spin" /> : <TestTube2 size={11} />}{running ? "Testing…" : "Run model test"}</button>
    <Subhead>Preview response</Subhead><div className="min-h-24 rounded-lg border border-white/[0.08] bg-black/20 p-3 text-[11.5px] leading-relaxed text-mut">{response || "The bound Tutor model's response will appear here."}</div>
    <div className="mt-2 text-[9.5px] text-dim">The playground tests identity and policy instructions only. Tool permissions are tested in live Chalkboard turns where runtime enforcement applies.</div>
  </>;
}

interface PanelProps { tutor: TutorPreferences; updateTutor: (updater: (current: TutorPreferences) => TutorPreferences) => void }
function PanelTitle({ title, description }: { title: string; description: string }) { return <div className="mb-3"><h2 className="text-[14px] font-semibold text-fg">{title}</h2><p className="mt-0.5 text-[10.5px] leading-relaxed text-dim">{description}</p></div>; }
function Subhead({ children }: { children: ReactNode }) { return <div className="mb-1.5 mt-3 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-dim">{children}</div>; }
function Label({ children }: { children: ReactNode }) { return <label className="mb-1 mt-2 block text-[10px] font-medium text-mut">{children}</label>; }
function Input({ value, onChange, placeholder, disabled }: { value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean }) { return <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-md border border-white/[0.1] bg-black/20 px-2 py-1.5 text-[11px] text-fg outline-none placeholder:text-dim focus:border-accent/60 disabled:opacity-50" />; }
function Textarea({ value, onChange, placeholder, rows }: { value: string; onChange: (value: string) => void; placeholder?: string; rows: number }) { return <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={rows} className="w-full resize-y rounded-md border border-white/[0.1] bg-black/20 px-2 py-1.5 text-[11px] leading-relaxed text-fg outline-none placeholder:text-dim focus:border-accent/60" />; }
function Select({ value, onChange, options, labels }: { value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-white/[0.1] bg-[#242424] px-2 py-1.5 text-[10.5px] text-fg outline-none">{options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option.replace(/-/g, " ")}</option>)}</select>; }
function FieldGroup({ label, children }: { label: string; children: ReactNode }) { return <div className="mb-2"><Label>{label}</Label>{children}</div>; }
function CommaField({ value, onChange, placeholder }: { value: string[]; onChange: (value: string[]) => void; placeholder?: string }) { return <Input value={value.join(", ")} onChange={(text) => onChange(text.split(",").map((item) => item.trim()).filter(Boolean))} placeholder={placeholder} />; }
function RuleEditor({ title, hint, value, onChange }: { title: string; hint: string; value: string[]; onChange: (value: string[]) => void }) { return <div className="mb-3"><Label>{title}</Label><div className="mb-1 text-[9px] text-dim">{hint}</div><Textarea rows={5} value={value.join("\n")} onChange={(text) => onChange(text.split("\n").map((line) => line.trim()).filter(Boolean))} /></div>; }
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button onClick={onClick} className={`rounded-full border px-2 py-1 text-[9.5px] ${active ? "border-accent/70 bg-accent/[0.12] text-fg" : "border-white/[0.1] text-dim hover:text-mut"}`}>{children}</button>; }
function Segment({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) { return <div className="flex rounded-md bg-black/25 p-0.5">{options.map((option) => <button key={option} onClick={() => onChange(option)} className={`flex-1 rounded px-2 py-1 text-[10px] ${value === option ? "bg-white/[0.14] text-fg" : "text-dim"}`}>{option}</button>)}</div>; }
function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) { return <div className="flex items-center gap-2 rounded-md px-0.5 py-2"><div className="min-w-0 flex-1"><div className="text-[11px] text-fg">{label}</div>{hint && <div className="text-[9.5px] leading-snug text-dim">{hint}</div>}</div><button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`h-[18px] w-[32px] shrink-0 rounded-full p-[2px] ${checked ? "bg-accent" : "bg-[#4a4a48]"}`}><span className={`block h-[14px] w-[14px] rounded-full bg-white transition-transform ${checked ? "translate-x-[14px]" : ""}`} /></button></div>; }
function Range({ label, value, onChange, min = 0, max = 100, step = 1 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) { return <div className="py-2"><div className="mb-1 text-[10.5px] text-mut">{label}</div><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-accent" /></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-md border border-dashed border-white/[0.1] p-3 text-center text-[10px] text-dim">{text}</div>; }
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) { return <button onClick={onClick} aria-label={label} title={label} className="grid h-6 w-6 shrink-0 place-items-center rounded text-dim hover:bg-white/[0.08] hover:text-fg">{children}</button>; }
function ListCard({ title, detail, enabled, onToggle, onDelete }: { title: string; detail: string; enabled: boolean; onToggle: () => void; onDelete: () => void }) { return <div className="flex items-start gap-2 rounded-md border border-white/[0.07] p-2"><button onClick={onToggle} className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${enabled ? "border-accent bg-accent text-white" : "border-white/20"}`}>{enabled && <Check size={10} />}</button><div className="min-w-0 flex-1"><div className="text-[11px] text-fg">{title}</div><div className="mt-0.5 text-[9.5px] leading-relaxed text-dim">{detail}</div></div><IconButton label="Delete" onClick={onDelete}><Trash2 size={10} /></IconButton></div>; }
function StatusRow({ label, detail }: { label: string; detail: string }) { return <div className="flex items-center gap-2 rounded-md px-0.5 py-2 opacity-60"><div className="min-w-0 flex-1"><div className="text-[11px] text-mut">{label}</div><div className="text-[9.5px] text-dim">{detail}</div></div><span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[8.5px] uppercase tracking-wide text-dim">Unavailable</span></div>; }
function TutorAvatar({ avatar, name, large }: { avatar: string; name: string; large?: boolean }) { const size = large ? "h-12 w-12 text-[16px]" : "h-7 w-7 text-[11px]"; const isImage = /^(?:data:image\/|https?:\/\/)/i.test(avatar); return <div className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-lg bg-accent/15 font-semibold text-accent`}>{isImage ? <img src={avatar} alt={`${name} avatar`} className="h-full w-full object-cover" /> : (avatar.trim() || name.slice(0, 1) || "T").slice(0, 3)}</div>; }
