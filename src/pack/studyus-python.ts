/**
 * The shipped Studyus Python pack — first arc (M10):
 * variables → conditionals → loops → functions → lists → strings → dicts.
 *
 * §18 honesty: the plan's launch pack was to be OpenStax CC BY material, with
 * per-document license verification recorded in BUILD_LOG.md. This repository
 * build could not fetch and verify any OpenStax document, so every program
 * and text here is original to Studyus (the worked-example programs follow
 * the specification's own Appendix B). No unverified licensed text ships.
 *
 * Every expected output here is a recorded outcome produced by a
 * deterministic reference model — the PrecomputedRuntime contract (§9.1).
 */

import type {
  HiddenTest,
  Misconception,
  Rubric,
  Skill,
  Tier3Content,
  TraceStep,
} from "../core/types";
import type { Pack, ReferenceResult, Template } from "../core/template";
import type { CustomDetectorRegistry } from "../core/grading";

export const PACK_ID = "studyus-python-first-arc";

/* ── helpers ── */

const step = (line: number, vars: Record<string, string>, stdout: string[], note?: string): TraceStep => ({
  line,
  vars,
  stdout,
  note,
});

const countOccurrences = (source: string, pattern: RegExp): number => (source.match(pattern) ?? []).length;

/* ── misconceptions (§7.7) ── */

export const MISCONCEPTIONS: Misconception[] = [
  {
    id: "rebinding-original",
    name: "rebinding keeps the original value",
    detector: { kind: "custom", name: "vars-original-value" },
    remediation: "rebinding",
    help: "An assignment rebinds the name. After `a = a + b`, the old value of a is gone — the name now points at the new result.",
  },
  {
    id: "boundary-included",
    name: "comparison boundary treated as included",
    detector: { kind: "custom", name: "boundary-as-big" },
    remediation: "strict-comparison",
    help: "`>` is strict: at exactly the boundary the condition is false, and the else branch runs.",
  },
  {
    id: "range-includes-upper",
    name: "range upper bound assumed inclusive",
    detector: { kind: "custom", name: "sum-includes-upper" },
    remediation: "range-upper-exclusive",
    help: "range(n) yields 0 … n−1. It stops *before* its argument — the endpoint never runs.",
  },
  {
    id: "range-starts-at-one",
    name: "range assumed to start at 1",
    detector: { kind: "custom", name: "sums-from-one" },
    remediation: "range-start",
    help: "range(n) starts at 0. If the accumulator starts somewhere else, the first value added is still 0.",
  },
  {
    id: "returns-none",
    name: "expects the call itself to be printed",
    detector: { kind: "exact-response", value: "None" },
    remediation: "return-values",
    help: "A function call evaluates to its return value. print shows that value — nothing else appears unless the function prints.",
  },
  {
    id: "append-returns-list",
    name: "append assumed to return the list",
    detector: { kind: "custom", name: "append-gives-list" },
    remediation: "in-place-methods",
    help: "append mutates the list in place and returns None. The list grows; the method hands back nothing.",
  },
  {
    id: "len-before-append",
    name: "length taken before the append lands",
    detector: { kind: "custom", name: "len-too-early" },
    remediation: "statement-order",
    help: "Statements run top to bottom. An append on line 2 is already reflected by a len on line 4.",
  },
  {
    id: "string-mutated-in-place",
    name: "string assumed to change where it stands",
    detector: { kind: "custom", name: "string-changed-in-place" },
    remediation: "immutability",
    help: "Strings are immutable. upper/lower/capitalize return a brand-new string and leave the original untouched.",
  },
  {
    id: "dict-overwrite",
    name: "dictionary update read as overwrite",
    detector: { kind: "custom", name: "dict-was-overwritten" },
    remediation: "read-then-write",
    help: "`d[k] = d[k] + x` reads the old value first, then stores the sum. Nothing is lost unless you skip the read.",
  },
  {
    id: "dict-unchanged",
    name: "dictionary update assumed to have no effect",
    detector: { kind: "custom", name: "dict-stayed-put" },
    remediation: "assignment-sticks",
    help: "Assigning into a dictionary key really does change the dictionary — the next lookup sees the new value.",
  },
];

const num = (text: string): number | null => {
  const matches = text.trim().replace(/\r/g, "").match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return null;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : null;
};

/** named detector functions registered by this pack (§7.7) */
export const CUSTOM_DETECTORS: CustomDetectorRegistry = {
  "vars-original-value": (text, _expected, p) => num(text) === p.x,
  "boundary-as-big": (text, _expected, p) =>
    p.v === p.t && text.trim().replace(/\r/g, "").toLowerCase() === String(p.label ?? "big").toLowerCase(),
  "sum-includes-upper": (text, expected, p) => {
    if (expected.kind !== "stdout") return false;
    const got = num(text);
    const exp = num(expected.text);
    return got !== null && exp !== null && got - exp === Number(p.n);
  },
  "sums-from-one": (text, expected, p) => {
    if (expected.kind !== "stdout") return false;
    const n = Number(p.n);
    const fromOne = (n * (n + 1)) / 2;
    return num(text) === fromOne && num(expected.text) !== fromOne;
  },
  "append-gives-list": (text, _expected, p) => {
    const list = `[${p.a}, ${p.b}, ${p.c}]`;
    const lines = text.trim().replace(/\r/g, "").split("\n").map((l) => l.trim());
    return lines[0] === list && lines[1] === list;
  },
  "len-too-early": (text, _expected, p) => {
    const lines = text.trim().replace(/\r/g, "").split("\n").map((l) => l.trim());
    return lines[0] === `[${p.a}, ${p.b}]` && lines[1] === "2";
  },
  "string-changed-in-place": (text, expected, p) => {
    if (expected.kind !== "stdout") return false;
    const lines = text.trim().replace(/\r/g, "").split("\n").map((l) => l.trim());
    const changed = String(p["method"] === "upper" ? String(p.w).toUpperCase() : p["method"] === "lower" ? String(p.w).toLowerCase() : capitalize(String(p.w)));
    return lines[0] === changed;
  },
  "dict-was-overwritten": (text, _expected, p) => {
    const lines = text.trim().replace(/\r/g, "").split("\n").map((l) => l.trim());
    return lines[0] === String(p.delta);
  },
  "dict-stayed-put": (text, _expected, p) => {
    const lines = text.trim().replace(/\r/g, "").split("\n").map((l) => l.trim());
    return lines[0] === String(p.v1);
  },
};

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/* ── skills (§7.3) — one connected DAG, no orphans ── */

const skill = (s: Skill): Skill => s;

export const SKILLS: Skill[] = [
  skill({
    id: "py.vars.assignment",
    title: "Binding and rebinding names",
    tier: 1,
    prerequisites: [],
    concepts: ["assignment", "names", "state"],
    misconceptions: ["rebinding-original"],
    pack: PACK_ID,
    beats: ["predict", "explain", "modify", "write"],
  }),
  skill({
    id: "py.cond.if-else",
    title: "Choosing with if and else",
    tier: 1,
    prerequisites: ["py.vars.assignment"],
    concepts: ["branching", "comparisons"],
    misconceptions: ["boundary-included"],
    pack: PACK_ID,
    beats: ["predict", "explain", "modify", "write"],
  }),
  skill({
    id: "py.loops.for-range",
    title: "Accumulating over a range",
    tier: 1,
    prerequisites: ["py.vars.assignment"],
    concepts: ["iteration", "accumulator", "range"],
    misconceptions: ["range-includes-upper", "range-starts-at-one"],
    pack: PACK_ID,
    beats: ["predict", "explain", "modify", "write"],
  }),
  skill({
    id: "py.funcs.def-return",
    title: "Functions that return values",
    tier: 1,
    prerequisites: ["py.vars.assignment"],
    concepts: ["functions", "return", "calls"],
    misconceptions: ["returns-none"],
    pack: PACK_ID,
    beats: ["predict", "explain", "modify", "write"],
  }),
  skill({
    id: "py.lists.grow",
    title: "Growing a list in place",
    tier: 1,
    prerequisites: ["py.loops.for-range"],
    concepts: ["lists", "mutation", "length"],
    misconceptions: ["append-returns-list", "len-before-append"],
    pack: PACK_ID,
    beats: ["predict", "explain", "modify", "write"],
  }),
  skill({
    id: "py.strings.methods",
    title: "Strings come back new",
    tier: 1,
    prerequisites: ["py.funcs.def-return"],
    concepts: ["strings", "immutability", "methods"],
    misconceptions: ["string-mutated-in-place"],
    pack: PACK_ID,
    beats: ["predict", "explain", "modify", "write"],
  }),
  skill({
    id: "py.dicts.count",
    title: "Counting with a dictionary",
    tier: 1,
    prerequisites: ["py.lists.grow"],
    concepts: ["dictionaries", "lookup", "accumulation"],
    misconceptions: ["dict-overwrite", "dict-unchanged"],
    pack: PACK_ID,
    beats: ["predict", "explain", "modify", "write"],
  }),
];

/* ── templates (§10.2) — one per skill, parameterized, all four beats ── */

const templates: Template[] = [
  /* 1 · variables */
  {
    id: "py.vars.assignment.rebind.v1",
    skill: "py.vars.assignment",
    tier: 1,
    params: {
      x: { kind: "int", min: 1, max: 9 },
      y: { kind: "int", min: 1, max: 9 },
      op: { kind: "choice", of: ["+", "-", "*"] },
    },
    predict: {
      program: "a = {{x}}\nb = {{y}}\na = a {{op}} b\nprint(a)",
      questionText: "What does this print?",
      reference: (b): ReferenceResult => {
        const result = b.op === "+" ? Number(b.x) + Number(b.y) : b.op === "-" ? Number(b.x) - Number(b.y) : Number(b.x) * Number(b.y);
        return {
          stdout: String(result),
          trace: [
            step(1, { a: String(b.x) }, []),
            step(2, { a: String(b.x), b: String(b.y) }, []),
            step(3, { a: String(result), b: String(b.y) }, [], `a is rebound — the old value ${b.x} is gone`),
            step(4, { a: String(result), b: String(b.y) }, [String(result)]),
          ],
        };
      },
      choices: (b) => {
        const result = b.op === "+" ? Number(b.x) + Number(b.y) : b.op === "-" ? Number(b.x) - Number(b.y) : Number(b.x) * Number(b.y);
        return [
          { id: "a", text: String(result) },
          { id: "b", text: String(b.x) },
          { id: "c", text: String(b.y) },
          { id: "d", text: String(result + 1) },
        ];
      },
    },
    explain: {
      rubric: (b): Rubric => ({
        groups: [
          { oneOf: ["stores", "binds", "assigns", "saves"] },
          { oneOf: ["combines", "adds", "subtracts", "multiplies", "operation", "arithmetic"] },
          { oneOf: ["prints", "shows", "final value", "result"] },
        ],
        mustNotInclude: ["line by line"],
        exemplar: `It stores two numbers in names, ${b.op === "+" ? "adds them" : b.op === "-" ? "subtracts the second from the first" : "multiplies them"}, rebinds the first name to the result, and prints it.`,
      }),
    },
    modify: {
      programWithHoles: "a = {{x}}\nb = {{y}}\na = ___\nprint(a)",
      holes: () => [{ id: "expr", accept: ["b - a", "b-a", "-a + b", "b -a", "b- a"] }],
      targetBehaviour: "Print the value of b minus a.",
      stdout: (b) => String(Number(b.y) - Number(b.x)),
    },
    write: {
      specification:
        "Write a program that reads two integers, one per line, and prints their difference: the first minus the second. Print nothing else.",
      signatureHint: "You'll need two input() calls, one after the other.",
      hiddenTests: (): HiddenTest[] => [
        { stdin: "7\n3", stdout: "4" },
        { stdin: "3\n7", stdout: "-4" },
        { stdin: "5\n5", stdout: "0" },
        { stdin: "10\n1", stdout: "9" },
      ],
      checks: [
        { id: "reads-two", label: "reads two integers from input", test: (s) => countOccurrences(s, /int\s*\(\s*input\s*\(/g) >= 2 },
        { id: "subtracts", label: "subtracts one value from the other", test: (s) => /-/.test(s) },
        { id: "prints-once", label: "prints exactly one line", test: (s) => countOccurrences(s, /print\s*\(/g) === 1 },
      ],
      referenceSolution: "first = int(input())\nsecond = int(input())\nprint(first - second)",
    },
  },

  /* 2 · conditionals */
  {
    id: "py.cond.if-else.threshold.v1",
    skill: "py.cond.if-else",
    tier: 1,
    params: {
      v: { kind: "int", min: 1, max: 12 },
      t: { kind: "int", min: 1, max: 10 },
      label: { kind: "choice", of: ["big", "high"] },
    },
    predict: {
      program: 'value = {{v}}\nif value > {{t}}:\n    print("{{label}}")\nelse:\n    print("small")',
      questionText: "Which word does this print?",
      reference: (b): ReferenceResult => {
        const out = Number(b.v) > Number(b.t) ? String(b.label) : "small";
        return {
          stdout: out,
          trace: [
            step(1, { value: String(b.v) }, []),
            step(2, { value: String(b.v) }, [], `${b.v} > ${b.t} is ${Number(b.v) > Number(b.t)}`),
            step(out === "small" ? 5 : 3, { value: String(b.v) }, [out]),
          ],
        };
      },
      choices: (b) => [
        { id: "a", text: String(b.label) },
        { id: "b", text: "small" },
        { id: "c", text: "nothing prints" },
        { id: "d", text: "an error" },
      ],
    },
    explain: {
      rubric: (): Rubric => ({
        groups: [
          { oneOf: ["compares", "checks", "tests", "threshold"] },
          { oneOf: ["depending", "one of two", "either", "otherwise", "branch"] },
          { oneOf: ["prints", "word", "label"] },
        ],
        mustNotInclude: ["line by line"],
        exemplar: "It compares a value against a threshold and prints one of two words depending on the comparison.",
      }),
    },
    modify: {
      programWithHoles: 'value = {{v}}\nif value ___ {{t}}:\n    print("{{label}}")\nelse:\n    print("small")',
      holes: () => [{ id: "cmp", accept: [">=", ">= "] }],
      targetBehaviour: "Print the label when value is greater than or equal to the threshold.",
      stdout: (b) => (Number(b.v) >= Number(b.t) ? String(b.label) : "small"),
    },
    write: {
      specification:
        "Read one integer from input. If it is even, print \"even\"; otherwise print \"odd\". Print nothing else.",
      signatureHint: "The modulo operator (%) tells you the remainder after dividing by 2.",
      hiddenTests: (): HiddenTest[] => [
        { stdin: "4", stdout: "even" },
        { stdin: "7", stdout: "odd" },
        { stdin: "0", stdout: "even" },
        { stdin: "-3", stdout: "odd" },
      ],
      checks: [
        { id: "reads", label: "reads an integer from input", test: (s) => /int\s*\(\s*input\s*\(/.test(s) },
        { id: "modulo", label: "tests evenness with modulo", test: (s) => /%\s*2/.test(s) },
        { id: "branch", label: "has both an if and an else branch", test: (s) => /\bif\b/.test(s) && /\belse\b/.test(s) },
      ],
      referenceSolution: 'n = int(input())\nif n % 2 == 0:\n    print("even")\nelse:\n    print("odd")',
    },
  },

  /* 3 · loops over range — the worked example (Appendix B) */
  {
    id: "py.loops.for-range.accumulate.v1",
    skill: "py.loops.for-range",
    tier: 1,
    params: {
      n: { kind: "int", min: 2, max: 15 },
      start: { kind: "int", min: 0, max: 12 },
      label: { kind: "choice", of: ["total", "sum_so_far", "running"] },
    },
    predict: {
      program: "{{label}} = {{start}}\nfor i in range({{n}}):\n    {{label}} += i\nprint({{label}})",
      questionText: "What does this print?",
      reference: (b): ReferenceResult => {
        const n = Number(b.n);
        const start = Number(b.start);
        const label = String(b.label);
        let acc = start;
        const trace: TraceStep[] = [step(1, { [label]: String(acc) }, [])];
        for (let i = 0; i < n; i += 1) {
          acc += i;
          trace.push(step(3, { i: String(i), [label]: String(acc) }, [], i === n - 1 ? `range(${n}) stops before ${n}` : undefined));
        }
        trace.push(step(4, { [label]: String(acc) }, [String(acc)]));
        return { stdout: String(acc), trace };
      },
      choices: (b) => {
        const n = Number(b.n);
        const start = Number(b.start);
        const value = start + (n * (n - 1)) / 2;
        return [
          { id: "a", text: String(value) },
          { id: "b", text: String(value + n) },
          { id: "c", text: String((n * (n + 1)) / 2) },
          { id: "d", text: String(value - 1) },
        ];
      },
    },
    explain: {
      rubric: (b): Rubric => {
        const n = Number(b.n);
        const start = Number(b.start);
        return {
          groups: [
            { oneOf: ["adds", "sums", "accumulates", "totals"] },
            { oneOf: [`${start} to ${start + n - 1}`, `first ${n}`, "range"] },
          ],
          mustNotInclude: ["prints each", "one at a time"],
          exemplar: `It adds up the numbers from ${start} to ${start + n - 1} and prints the total.`,
        };
      },
    },
    modify: {
      programWithHoles: "{{label}} = 0\nfor i in range(___):\n    {{label}} += ___\nprint({{label}})",
      holes: (b) => {
        const n = Number(b.n);
        return [
          { id: "bound", accept: [String(n + 1), `${n} + 1`, `1 + ${n}`, `${n}+1`, `1+${n}`] },
          { id: "addend", accept: ["i"] },
        ];
      },
      targetBehaviour: "Sum the numbers from 1 to {{n}} inclusive, then print the result.",
      stdout: (b) => String((Number(b.n) * (Number(b.n) + 1)) / 2),
    },
    write: {
      specification:
        "Write a program that reads an integer n from input and prints the sum of all integers from 1 to n inclusive. Print nothing else.",
      signatureHint: "range(1, n + 1) visits exactly the numbers 1 … n.",
      hiddenTests: (): HiddenTest[] => [
        { stdin: "5", stdout: "15" },
        { stdin: "1", stdout: "1" },
        { stdin: "0", stdout: "0" },
        { stdin: "100", stdout: "5050" },
      ],
      checks: [
        { id: "reads", label: "reads an integer n from input", test: (s) => /int\s*\(\s*input\s*\(/.test(s) },
        {
          id: "covers-range",
          label: "covers every integer from 1 to n (or uses a closed-form sum)",
          test: (s) => /for\s+\w+\s+in\s+range/.test(s) || /n\s*\*\s*\(\s*n\s*\+\s*1\s*\)/.test(s),
        },
        { id: "prints-once", label: "prints exactly one line", test: (s) => countOccurrences(s, /print\s*\(/g) === 1 },
      ],
      referenceSolution: "n = int(input())\ntotal = 0\nfor i in range(1, n + 1):\n    total += i\nprint(total)",
    },
  },

  /* 4 · functions */
  {
    id: "py.funcs.def-return.scale.v1",
    skill: "py.funcs.def-return",
    tier: 1,
    params: {
      x: { kind: "int", min: 2, max: 12 },
      k: { kind: "int", min: 2, max: 9 },
      c: { kind: "int", min: 0, max: 3 },
      fname: { kind: "choice", of: ["scale", "shift"] },
    },
    predict: {
      program: "def {{fname}}(n):\n    result = n * {{k}} + {{c}}\n    return result\n\nprint({{fname}}({{x}}))",
      questionText: "What does this print?",
      reference: (b): ReferenceResult => {
        const value = Number(b.x) * Number(b.k) + Number(b.c);
        return {
          stdout: String(value),
          trace: [
            step(1, {}, [], `defines ${b.fname} — the body doesn't run yet`),
            step(5, {}, [], `calling ${b.fname}(${b.x})`),
            step(2, { n: String(b.x), result: String(value) }, []),
            step(3, { n: String(b.x), result: String(value) }, [], "the call evaluates to the returned value"),
            step(5, {}, [String(value)]),
          ],
        };
      },
      choices: (b) => {
        const value = Number(b.x) * Number(b.k) + Number(b.c);
        return [
          { id: "a", text: String(value) },
          { id: "b", text: "None" },
          { id: "c", text: String(Number(b.x) * Number(b.k)) },
          { id: "d", text: String(value + Number(b.x)) },
        ];
      },
    },
    explain: {
      rubric: (): Rubric => ({
        groups: [
          { oneOf: ["defines", "function"] },
          { oneOf: ["scales", "multiplies", "transforms", "computes", "adds"] },
          { oneOf: ["prints", "returns", "call", "result"] },
        ],
        mustNotInclude: ["line by line"],
        exemplar: "It defines a function that scales a number and adds a constant, then prints what one call to it returns.",
      }),
    },
    modify: {
      programWithHoles: "def {{fname}}(n):\n    result = n * {{k}} ___ {{c}}\n    return result\n\nprint({{fname}}({{x}}))",
      holes: () => [{ id: "op", accept: ["-"] }],
      targetBehaviour: "Make the function subtract the constant instead of adding it, then print the call's result.",
      stdout: (b) => String(Number(b.x) * Number(b.k) - Number(b.c)),
    },
    write: {
      specification:
        "Define a function called triple that takes one number and returns three times that number. Then read an integer from input and print the result of calling triple on it. Print nothing else.",
      signatureHint: "def triple(n): — and the caller does the printing.",
      hiddenTests: (): HiddenTest[] => [
        { stdin: "4", stdout: "12" },
        { stdin: "0", stdout: "0" },
        { stdin: "7", stdout: "21" },
        { stdin: "-2", stdout: "-6" },
      ],
      checks: [
        { id: "defines", label: "defines a function named triple", test: (s) => /def\s+triple\s*\(/.test(s) },
        { id: "returns", label: "returns the value instead of printing it inside", test: (s) => /\breturn\b/.test(s) },
        { id: "reads", label: "reads an integer from input", test: (s) => /int\s*\(\s*input\s*\(/.test(s) },
        { id: "prints-once", label: "prints exactly one line", test: (s) => countOccurrences(s, /print\s*\(/g) === 1 },
      ],
      referenceSolution: "def triple(n):\n    return n * 3\n\nprint(triple(int(input())))",
    },
  },

  /* 5 · lists */
  {
    id: "py.lists.grow.append.v1",
    skill: "py.lists.grow",
    tier: 1,
    params: {
      a: { kind: "int", min: 1, max: 9 },
      b: { kind: "int", min: 1, max: 9 },
      c: { kind: "int", min: 1, max: 9 },
    },
    predict: {
      program: "nums = [{{a}}, {{b}}]\nnums.append({{c}})\nprint(nums)\nprint(len(nums))",
      questionText: "Predict both printed lines.",
      reference: (b): ReferenceResult => {
        const list = `[${b.a}, ${b.b}, ${b.c}]`;
        return {
          stdout: `${list}\n3`,
          trace: [
            step(1, { nums: `[${b.a}, ${b.b}]` }, []),
            step(2, { nums: list }, [], "append mutates in place and returns None"),
            step(3, { nums: list }, [list]),
            step(4, { nums: list }, [list, "3"]),
          ],
        };
      },
      choices: (b) => [
        { id: "a", text: `[${b.a}, ${b.b}, ${b.c}] then 3` },
        { id: "b", text: `[${b.a}, ${b.b}, ${b.c}] then [${b.a}, ${b.b}, ${b.c}]` },
        { id: "c", text: `[${b.a}, ${b.b}] then 2` },
        { id: "d", text: "None then 3" },
      ],
    },
    explain: {
      rubric: (): Rubric => ({
        groups: [
          { oneOf: ["list"] },
          { oneOf: ["appends", "adds", "grows", "one more", "in place"] },
          { oneOf: ["prints", "length", "len", "how long", "count"] },
        ],
        mustNotInclude: ["returns a new list"],
        exemplar: "It builds a two-item list, appends one more item in place, then prints the list and how long it has become.",
      }),
    },
    modify: {
      programWithHoles: "nums = [{{a}}, {{b}}]\nnums.append(___)\nprint(nums)\nprint(len(nums))",
      holes: () => [
        {
          id: "sum-fill",
          accept: ["nums[0] + nums[1]", "nums[0]+nums[1]", "nums[1] + nums[0]", "nums[1]+nums[0]"],
        },
      ],
      targetBehaviour: "Make it append the sum of the first two items, then print the list and its length.",
      stdout: (b) => `[${b.a}, ${b.b}, ${Number(b.a) + Number(b.b)}]\n3`,
    },
    write: {
      specification:
        "Read three integers, one per line. Store them in a list in the order read, then print the list on the first line and the sum of its items on the second. Print nothing else.",
      signatureHint: "Start with an empty list and append each int(input()) — sum() does the adding.",
      hiddenTests: (): HiddenTest[] => [
        { stdin: "1\n2\n3", stdout: "[1, 2, 3]\n6" },
        { stdin: "4\n4\n4", stdout: "[4, 4, 4]\n12" },
        { stdin: "0\n0\n0", stdout: "[0, 0, 0]\n0" },
        { stdin: "10\n1\n2", stdout: "[10, 1, 2]\n13" },
      ],
      checks: [
        {
          id: "reads-three",
          label: "reads three integers from input",
          test: (s) =>
            countOccurrences(s, /int\s*\(\s*input\s*\(/g) >= 3 ||
            (/\bfor\b|\bwhile\b/.test(s) && /int\s*\(\s*input\s*\(/.test(s)),
        },
        { id: "collects", label: "collects them into a list", test: (s) => /=\s*\[/.test(s) || /\.append\s*\(/.test(s) },
        { id: "sums", label: "adds the items up", test: (s) => /\bsum\s*\(/.test(s) || /(\w+)\s*\+\s*(\w+)/.test(s) },
        { id: "prints-two", label: "prints exactly two lines", test: (s) => countOccurrences(s, /print\s*\(/g) === 2 },
      ],
      referenceSolution: "nums = []\nfor _ in range(3):\n    nums.append(int(input()))\nprint(nums)\nprint(sum(nums))",
    },
  },

  /* 6 · strings */
  {
    id: "py.strings.methods.new-string.v1",
    skill: "py.strings.methods",
    tier: 1,
    params: {
      w: { kind: "choice", of: ["hi", "code", "loop", "list", "data", "byte", "grid", "path", "core", "flow", "node", "stack", "queue", "token", "value", "index", "array", "tuple", "scope", "frame"] },
      method: { kind: "choice", of: ["upper", "lower", "capitalize"] },
      r: { kind: "int", min: 1, max: 4 },
    },
    predict: {
      program: 'word = "{{w}}"\nchanged = word.{{method}}()\nprint(word)\nprint(changed)\nprint(word * {{r}})',
      questionText: "Predict all three printed lines.",
      reference: (b): ReferenceResult => {
        const w = String(b.w);
        const changed = b.method === "upper" ? w.toUpperCase() : b.method === "lower" ? w.toLowerCase() : capitalize(w);
        const rep = w.repeat(Number(b.r));
        return {
          stdout: `${w}\n${changed}\n${rep}`,
          trace: [
            step(1, { word: `"${w}"` }, []),
            step(2, { word: `"${w}"`, changed: `"${changed}"` }, [], "the method returns a new string — word is untouched"),
            step(3, { word: `"${w}"`, changed: `"${changed}"` }, [w]),
            step(4, { word: `"${w}"`, changed: `"${changed}"` }, [w, changed]),
            step(5, { word: `"${w}"`, changed: `"${changed}"` }, [w, changed, rep], "repetition builds yet another new string"),
          ],
        };
      },
      choices: (b) => {
        const w = String(b.w);
        const changed = b.method === "upper" ? w.toUpperCase() : b.method === "lower" ? w.toLowerCase() : capitalize(w);
        return [
          { id: "a", text: `${w} / ${changed} / ${w.repeat(Number(b.r))}` },
          { id: "b", text: `${changed} / ${changed} / ${w.repeat(Number(b.r))}` },
          { id: "c", text: `${w} / ${w} / ${w}` },
          { id: "d", text: `${changed} / ${w} / ${changed}` },
        ];
      },
    },
    explain: {
      rubric: (): Rubric => ({
        groups: [
          { oneOf: ["string"] },
          { oneOf: ["returns", "new", "brand new", "copy", "produces"] },
          { oneOf: ["original", "unchanged", "stays", "itself", "untouched"] },
        ],
        mustNotInclude: ["changes the original"],
        exemplar: "It shows that a string method returns a brand-new string while the original stays exactly as it was.",
      }),
    },
    modify: {
      programWithHoles: 'word = "{{w}}"\nchanged = word.{{method}}()\nprint(___)\nprint(changed)',
      holes: () => [{ id: "first-print", accept: ["changed"] }],
      targetBehaviour: "Print the changed string twice and never print the original.",
      stdout: (b) => {
        const w = String(b.w);
        const changed = b.method === "upper" ? w.toUpperCase() : b.method === "lower" ? w.toLowerCase() : capitalize(w);
        return `${changed}\n${changed}`;
      },
    },
    write: {
      specification:
        "Read one word from input. Print the word in uppercase on the first line and its length on the second. Print nothing else.",
      signatureHint: ".upper() returns the transformed copy; len() counts characters.",
      hiddenTests: (): HiddenTest[] => [
        { stdin: "hi", stdout: "HI\n2" },
        { stdin: "Code", stdout: "CODE\n4" },
        { stdin: "a", stdout: "A\n1" },
        { stdin: "abc", stdout: "ABC\n3" },
      ],
      checks: [
        { id: "reads", label: "reads the word from input", test: (s) => /input\s*\(/.test(s) },
        { id: "upper", label: "transforms it with .upper()", test: (s) => /\.upper\s*\(/.test(s) },
        { id: "length", label: "reports its length with len()", test: (s) => /\blen\s*\(/.test(s) },
        { id: "prints-two", label: "prints exactly two lines", test: (s) => countOccurrences(s, /print\s*\(/g) === 2 },
      ],
      referenceSolution: "word = input()\nprint(word.upper())\nprint(len(word))",
    },
  },

  /* 7 · dicts */
  {
    id: "py.dicts.count.update.v1",
    skill: "py.dicts.count",
    tier: 1,
    params: {
      pair: { kind: "choice", of: ["ada,lin", "mia,kai", "sol,rex"] },
      v1: { kind: "int", min: 1, max: 9 },
      v2: { kind: "int", min: 1, max: 9 },
      delta: { kind: "int", min: 1, max: 5 },
    },
    derived: (b) => {
      const [k1, k2] = String(b.pair).split(",");
      return { k1, k2 };
    },
    predict: {
      program:
        'scores = {"{{k1}}": {{v1}}, "{{k2}}": {{v2}}}\nscores["{{k1}}"] = scores["{{k1}}"] + {{delta}}\nprint(scores["{{k1}}"])\nprint(scores["{{k2}}"])',
      questionText: "Predict both printed lines.",
      reference: (b): ReferenceResult => {
        const [k1, k2] = String(b.pair).split(",");
        const raised = Number(b.v1) + Number(b.delta);
        return {
          stdout: `${raised}\n${b.v2}`,
          trace: [
            step(1, { scores: `{"${k1}": ${b.v1}, "${k2}": ${b.v2}}` }, []),
            step(2, { scores: `{"${k1}": ${raised}, "${k2}": ${b.v2}}` }, [], "reads the old value first, then stores the sum"),
            step(3, { scores: `{"${k1}": ${raised}, "${k2}": ${b.v2}}` }, [String(raised)]),
            step(4, { scores: `{"${k1}": ${raised}, "${k2}": ${b.v2}}` }, [String(raised), String(b.v2)]),
          ],
        };
      },
      choices: (b) => {
        const raised = Number(b.v1) + Number(b.delta);
        return [
          { id: "a", text: `${raised} then ${b.v2}` },
          { id: "b", text: `${b.delta} then ${b.v2}` },
          { id: "c", text: `${b.v1} then ${b.v2}` },
          { id: "d", text: `${raised} then ${raised}` },
        ];
      },
    },
    explain: {
      rubric: (): Rubric => ({
        groups: [
          { oneOf: ["stores", "dictionary", "maps", "by name", "lookup"] },
          { oneOf: ["raises", "adds", "increases", "updates", "one"] },
          { oneOf: ["prints", "both", "values", "looks up"] },
        ],
        mustNotInclude: ["line by line"],
        exemplar: "It stores two scores by name, raises one of them by building on its old value, then prints both.",
      }),
    },
    modify: {
      programWithHoles:
        'scores = {"{{k1}}": {{v1}}, "{{k2}}": {{v2}}}\nscores[___] = scores[___] + {{delta}}\nprint(scores["{{k1}}"])\nprint(scores["{{k2}}"])',
      holes: (b) => {
        const [, k2] = String(b.pair).split(",");
        const accept = [`"${k2}"`, `'${k2}'`, k2];
        return [
          { id: "target-key", accept },
          { id: "source-key", accept },
        ];
      },
      targetBehaviour: "Make the second entry receive the raise instead, then print both values.",
      stdout: (b) => `${b.v1}\n${Number(b.v2) + Number(b.delta)}`,
    },
    write: {
      specification:
        "Create an empty dictionary. Read three words, one per line, counting how many times each appears (a loop with .get works well). Print how many distinct words you saw. Print nothing else.",
      signatureHint: "counts.get(word, 0) hands you the old count — or 0 the first time.",
      hiddenTests: (): HiddenTest[] => [
        { stdin: "a\na\na", stdout: "1" },
        { stdin: "a\nb\na", stdout: "2" },
        { stdin: "a\nb\nc", stdout: "3" },
        { stdin: "x\nx\ny", stdout: "2" },
      ],
      checks: [
        { id: "empty-dict", label: "starts from an empty dictionary", test: (s) => /\w+\s*=\s*\{\s*\}/.test(s) },
        {
          id: "reads-three",
          label: "reads three words from input",
          test: (s) => countOccurrences(s, /input\s*\(/g) >= 3 || (/\bfor\b|\bwhile\b/.test(s) && /input\s*\(/.test(s)),
        },
        { id: "counts", label: "counts with .get (or an equivalent lookup)", test: (s) => /\.get\s*\(/.test(s) || /\bin\b/.test(s) },
        { id: "prints-once", label: "prints exactly one line", test: (s) => countOccurrences(s, /print\s*\(/g) === 1 },
      ],
      referenceSolution:
        "counts = {}\nfor _ in range(3):\n    word = input()\n    counts[word] = counts.get(word, 0) + 1\nprint(len(counts))",
    },
  },
];

/* ── Tier 3 — no checkable outcome, no gate (Law 8) ── */

export const TIER3: Tier3Content[] = [
  {
    id: "tier3.model-choice",
    title: "Which model would you choose — and why?",
    concepts: ["judgement", "model selection", "trade-offs"],
    body: [
      "Two teams fit different models to the same messy dataset. Team A picks the one with the best score on their split; Team B picks a simpler one they can explain to the people affected by its decisions. Both can defend their choice.",
      "The honest answer to \"which approach is better\" is: it depends — on how much data you have, what a mistake costs, who has to trust the output, and how long the model must live. Judgement here is a skill you build by arguing cases, not by memorising rules.",
      "As you read, form your own view: when would you take Team A's side, and when Team B's? What evidence would change your mind?",
    ],
    disclaimer: "",
  },
  {
    id: "tier3.automation-tradeoffs",
    title: "Automation and its trade-offs",
    concepts: ["ethics", "impact", "systems"],
    body: [
      "Every program that automates a task removes effort from one place and moves consequence to another. A script that sorts applications quickly also decides, silently, who gets seen first.",
      "There is no single correct stance. The skill is naming the trade-off out loud: who benefits, who bears the risk, and what happens at the edges the author never tested.",
      "Read this once, sit with it, and keep the question. It returns in a week — and good code is usually written by people who can hold it.",
    ],
    disclaimer: "",
  },
];

export const STUDYUS_PYTHON_PACK: Pack = {
  id: PACK_ID,
  title: "Studyus Python — First Arc",
  version: "1.0.0",
  license: "Original content, CC0 (authored for Studyus)",
  attribution:
    "Programs and text are original to Studyus; worked-example flows follow the Studyus doctrine specification. No third-party text is included.",
  language: "python",
  minPython: "3.9",
  skills: SKILLS,
  templates,
  misconceptions: MISCONCEPTIONS,
  tier3: TIER3,
};
