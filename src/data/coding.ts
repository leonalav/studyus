/**
 * v0 exercise set for the Programming prediction trainer.
 * Parsons + predict-output only — every answer is precomputed, so no kernel.
 */

export type Misconception =
  | "off-by-one"
  | "mutability"
  | "scope"
  | "truthiness"
  | "integer-division"
  | "reference-vs-copy"
  | "string-immutability"
  | "loop-order"
  | "short-circuit"
  | "none";

export const MISCONCEPTION_LABEL: Record<Misconception, string> = {
  "off-by-one": "Off-by-one range boundary",
  mutability: "Lists are mutable",
  scope: "Local vs. global scope",
  truthiness: "Falsy values",
  "integer-division": "Integer vs. float division",
  "reference-vs-copy": "Reference, not a copy",
  "string-immutability": "Strings are immutable",
  "loop-order": "Loop evaluation order",
  "short-circuit": "Short-circuit evaluation",
  none: "Correct model",
};

export const MISCONCEPTION_HELP: Record<Misconception, string> = {
  "off-by-one": "range(a, b) stops *before* b. Count the values, don't assume the endpoint is included.",
  mutability: "Lists are mutable: methods like append/sort change the object in place and return None.",
  scope: "Assigning to a name inside a function creates a new local unless you declare global/nonlocal.",
  truthiness: "0, '', [], {} and None are all falsy. Only test identity when you mean identity.",
  "integer-division": "/ always yields a float in Python 3; // floors toward negative infinity.",
  "reference-vs-copy": "b = a binds another name to the *same* object. Use a.copy() or list(a) for a new one.",
  "string-immutability": "Strings can't be changed in place — every 'mutation' returns a brand new string.",
  "loop-order": "The loop body runs fully for each item before moving on; watch when the print happens.",
  "short-circuit": "and/or stop as soon as the result is known, and they return an operand, not a bool.",
  none: "Your mental model matched the machine.",
};

/* ── Predict-the-output ── */

export interface PredictExercise {
  kind: "predict";
  id: string;
  title: string;
  concept: string;
  brief: string;
  code: string;
  /** exact expected stdout */
  output: string;
  /** optional multiple-choice shortcuts */
  choices?: { id: string; text: string; misconception: Misconception }[];
  /** map a wrong free-text guess to a misconception */
  diagnose: (guess: string) => Misconception;
  tutorRight: string;
  tutorWrong: Record<string, string>;
  /** step trace for the scrubber */
  trace: TraceStep[];
}

export interface TraceStep {
  line: number;
  vars: Record<string, string>;
  stdout: string[];
  note?: string;
}

/* ── Parsons ── */

export interface ParsonsExercise {
  kind: "parsons";
  id: string;
  title: string;
  concept: string;
  brief: string;
  /** correct order */
  solution: string[];
  /** extra distractor lines that don't belong */
  distractors?: string[];
  output: string;
  tutorRight: string;
  tutorWrong: string;
}

export type Exercise = PredictExercise | ParsonsExercise;

const norm = (s: string) => s.trim().replace(/\r/g, "").replace(/[ \t]+$/gm, "");

export const EXERCISES: Exercise[] = [
  {
    kind: "predict",
    id: "ex1",
    title: "Counting with range",
    concept: "range boundaries",
    brief: "How many lines does this print, and what are they?",
    code: `for i in range(1, 5):
    print(i)`,
    output: "1\n2\n3\n4",
    choices: [
      { id: "a", text: "1 2 3 4", misconception: "none" },
      { id: "b", text: "1 2 3 4 5", misconception: "off-by-one" },
      { id: "c", text: "0 1 2 3 4", misconception: "off-by-one" },
      { id: "d", text: "0 1 2 3", misconception: "off-by-one" },
    ],
    diagnose: (g) => (/5/.test(g) || /^0/.test(norm(g)) ? "off-by-one" : "off-by-one"),
    tutorRight:
      "Exactly. range(1, 5) is half-open — it starts at 1 and stops *before* 5, so you get four lines.",
    tutorWrong: {
      "off-by-one":
        "You expected the endpoint to be included. range(a, b) never emits b — it stops one short. That's why you got four lines, not five. The count is always b − a.",
    },
    trace: [
      { line: 1, vars: { i: "—" }, stdout: [], note: "range(1,5) yields 1,2,3,4" },
      { line: 2, vars: { i: "1" }, stdout: ["1"] },
      { line: 2, vars: { i: "2" }, stdout: ["1", "2"] },
      { line: 2, vars: { i: "3" }, stdout: ["1", "2", "3"] },
      { line: 2, vars: { i: "4" }, stdout: ["1", "2", "3", "4"] },
      { line: 1, vars: { i: "4" }, stdout: ["1", "2", "3", "4"], note: "5 is not produced — loop ends" },
    ],
  },
  {
    kind: "predict",
    id: "ex2",
    title: "Does append return a list?",
    concept: "mutability",
    brief: "What does this print?",
    code: `nums = [1, 2, 3]
result = nums.append(4)
print(result)
print(nums)`,
    output: "None\n[1, 2, 3, 4]",
    choices: [
      { id: "a", text: "[1, 2, 3, 4] then [1, 2, 3, 4]", misconception: "mutability" },
      { id: "b", text: "None then [1, 2, 3, 4]", misconception: "none" },
      { id: "c", text: "None then [1, 2, 3]", misconception: "mutability" },
      { id: "d", text: "[1, 2, 3, 4] then [1, 2, 3]", misconception: "mutability" },
    ],
    diagnose: () => "mutability",
    tutorRight:
      "Right. append mutates the list in place and returns None — so result is None while nums itself grew.",
    tutorWrong: {
      mutability:
        "You expected append to hand back a new list. It doesn't: it changes nums in place and returns None. Any time you write x = lst.append(...), x will be None. This is the single most common list bug.",
    },
    trace: [
      { line: 1, vars: { nums: "[1, 2, 3]" }, stdout: [] },
      { line: 2, vars: { nums: "[1, 2, 3, 4]", result: "None" }, stdout: [], note: "append mutates, returns None" },
      { line: 3, vars: { nums: "[1, 2, 3, 4]", result: "None" }, stdout: ["None"] },
      { line: 4, vars: { nums: "[1, 2, 3, 4]", result: "None" }, stdout: ["None", "[1, 2, 3, 4]"] },
    ],
  },
  {
    kind: "predict",
    id: "ex3",
    title: "Two names, one list",
    concept: "reference vs copy",
    brief: "Predict both printed lines.",
    code: `a = [1, 2]
b = a
b.append(3)
print(a)
print(a is b)`,
    output: "[1, 2, 3]\nTrue",
    choices: [
      { id: "a", text: "[1, 2] then False", misconception: "reference-vs-copy" },
      { id: "b", text: "[1, 2, 3] then True", misconception: "none" },
      { id: "c", text: "[1, 2] then True", misconception: "reference-vs-copy" },
      { id: "d", text: "[1, 2, 3] then False", misconception: "reference-vs-copy" },
    ],
    diagnose: () => "reference-vs-copy",
    tutorRight: "Correct — b = a binds a second name to the same object, so mutating through b is visible via a.",
    tutorWrong: {
      "reference-vs-copy":
        "You treated b = a as a copy. It isn't — both names point at the *same* list object, so b.append(3) is visible through a, and `a is b` is True. Use a.copy() or list(a) when you want a genuinely separate list.",
    },
    trace: [
      { line: 1, vars: { a: "[1, 2]" }, stdout: [] },
      { line: 2, vars: { a: "[1, 2]", b: "→ same object as a" }, stdout: [], note: "no copy is made" },
      { line: 3, vars: { a: "[1, 2, 3]", b: "[1, 2, 3]" }, stdout: [], note: "one object changed" },
      { line: 4, vars: { a: "[1, 2, 3]", b: "[1, 2, 3]" }, stdout: ["[1, 2, 3]"] },
      { line: 5, vars: { a: "[1, 2, 3]", b: "[1, 2, 3]" }, stdout: ["[1, 2, 3]", "True"] },
    ],
  },
  {
    kind: "predict",
    id: "ex4",
    title: "Dividing integers",
    concept: "division",
    brief: "What exactly gets printed?",
    code: `print(7 / 2)
print(7 // 2)
print(-7 // 2)`,
    output: "3.5\n3\n-4",
    choices: [
      { id: "a", text: "3.5, 3, -4", misconception: "none" },
      { id: "b", text: "3, 3, -3", misconception: "integer-division" },
      { id: "c", text: "3.5, 3.0, -3.5", misconception: "integer-division" },
      { id: "d", text: "3.5, 3, -3", misconception: "integer-division" },
    ],
    diagnose: () => "integer-division",
    tutorRight: "Yes — / gives a float, // floors, and flooring −3.5 goes *down* to −4, not toward zero.",
    tutorWrong: {
      "integer-division":
        "Two things to separate. First, / always produces a float in Python 3 (3.5, never 3). Second, // floors toward negative infinity, so -7 // 2 is -4, not -3. Truncation and flooring differ for negatives.",
    },
    trace: [
      { line: 1, vars: {}, stdout: ["3.5"], note: "/ → float" },
      { line: 2, vars: {}, stdout: ["3.5", "3"], note: "// floors" },
      { line: 3, vars: {}, stdout: ["3.5", "3", "-4"], note: "floor(-3.5) = -4" },
    ],
  },
  {
    kind: "predict",
    id: "ex5",
    title: "Where does the print land?",
    concept: "loop order",
    brief: "Count the lines before you answer.",
    code: `total = 0
for n in [1, 2, 3]:
    total += n
print(total)`,
    output: "6",
    choices: [
      { id: "a", text: "1 2 3 on separate lines", misconception: "loop-order" },
      { id: "b", text: "6", misconception: "none" },
      { id: "c", text: "1 3 6 on separate lines", misconception: "loop-order" },
      { id: "d", text: "0", misconception: "loop-order" },
    ],
    diagnose: () => "loop-order",
    tutorRight: "Right — the print sits outside the loop, so it runs once with the final total.",
    tutorWrong: {
      "loop-order":
        "Indentation decides this. print(total) is *outside* the for block, so it executes once after the loop completes — one line, value 6. If it were indented one level you'd get 1, 3, 6.",
    },
    trace: [
      { line: 1, vars: { total: "0" }, stdout: [] },
      { line: 3, vars: { total: "1", n: "1" }, stdout: [] },
      { line: 3, vars: { total: "3", n: "2" }, stdout: [] },
      { line: 3, vars: { total: "6", n: "3" }, stdout: [] },
      { line: 4, vars: { total: "6", n: "3" }, stdout: ["6"], note: "print runs once, after the loop" },
    ],
  },
  {
    kind: "predict",
    id: "ex6",
    title: "Falsy values",
    concept: "truthiness",
    brief: "Which branch runs?",
    code: `items = []
if items:
    print("has items")
else:
    print("empty")`,
    output: "empty",
    choices: [
      { id: "a", text: "has items", misconception: "truthiness" },
      { id: "b", text: "empty", misconception: "none" },
      { id: "c", text: "Nothing prints", misconception: "truthiness" },
      { id: "d", text: "An error", misconception: "truthiness" },
    ],
    diagnose: () => "truthiness",
    tutorRight: "Correct — an empty list is falsy, so the else branch runs.",
    tutorWrong: {
      truthiness:
        "An empty list is *falsy*. You don't need len(items) == 0 — `if items:` already means 'if it has anything'. The falsy set is 0, 0.0, '', [], {}, set(), None and False.",
    },
    trace: [
      { line: 1, vars: { items: "[]" }, stdout: [] },
      { line: 2, vars: { items: "[]" }, stdout: [], note: "bool([]) is False" },
      { line: 5, vars: { items: "[]" }, stdout: ["empty"] },
    ],
  },
  {
    kind: "predict",
    id: "ex7",
    title: "Rebinding inside a function",
    concept: "scope",
    brief: "What does the final print show?",
    code: `count = 0

def bump():
    count = 10

bump()
print(count)`,
    output: "0",
    choices: [
      { id: "a", text: "10", misconception: "scope" },
      { id: "b", text: "0", misconception: "none" },
      { id: "c", text: "None", misconception: "scope" },
      { id: "d", text: "UnboundLocalError", misconception: "scope" },
    ],
    diagnose: () => "scope",
    tutorRight: "Right — the assignment created a new local name; the module-level count never changed.",
    tutorWrong: {
      scope:
        "Assigning to a name inside a function makes it *local* by default. bump() created its own count = 10 and threw it away on return. To touch the outer one you'd need `global count`.",
    },
    trace: [
      { line: 1, vars: { "count (global)": "0" }, stdout: [] },
      { line: 6, vars: { "count (global)": "0" }, stdout: [], note: "calling bump()" },
      { line: 4, vars: { "count (global)": "0", "count (local)": "10" }, stdout: [], note: "new local binding" },
      { line: 7, vars: { "count (global)": "0" }, stdout: ["0"], note: "local is gone" },
    ],
  },
  {
    kind: "predict",
    id: "ex8",
    title: "Strings never change",
    concept: "string immutability",
    brief: "Predict both lines.",
    code: `s = "hi"
s.upper()
print(s)
print(s.upper())`,
    output: "hi\nHI",
    choices: [
      { id: "a", text: "HI then HI", misconception: "string-immutability" },
      { id: "b", text: "hi then HI", misconception: "none" },
      { id: "c", text: "hi then hi", misconception: "string-immutability" },
      { id: "d", text: "HI then hi", misconception: "string-immutability" },
    ],
    diagnose: () => "string-immutability",
    tutorRight: "Yes — upper() returns a new string; the bare call on line 2 is discarded.",
    tutorWrong: {
      "string-immutability":
        "Strings are immutable. s.upper() *returns* a new string and leaves s alone, so line 2 does nothing at all. You have to write s = s.upper() to keep the result.",
    },
    trace: [
      { line: 1, vars: { s: '"hi"' }, stdout: [] },
      { line: 2, vars: { s: '"hi"' }, stdout: [], note: 'returns "HI" — nobody stores it' },
      { line: 3, vars: { s: '"hi"' }, stdout: ["hi"] },
      { line: 4, vars: { s: '"hi"' }, stdout: ["hi", "HI"] },
    ],
  },
  /* ── Parsons ── */
  {
    kind: "parsons",
    id: "p1",
    title: "Sum a list",
    concept: "loop structure",
    brief: "Drag the lines into an order that sums the list and prints the total.",
    solution: ["total = 0", "for n in nums:", "    total += n", "print(total)"],
    distractors: ["total = nums", "    print(total)"],
    output: "6",
    tutorRight: "Clean structure: initialise, accumulate inside the loop, print once outside it.",
    tutorWrong:
      "Check two things: the accumulator has to exist *before* the loop, and the print belongs *outside* it — one level of indentation decides whether you print once or once per item.",
  },
  {
    kind: "parsons",
    id: "p2",
    title: "Guard before you divide",
    concept: "control flow",
    brief: "Order the lines so a zero denominator never crashes.",
    solution: ["def safe_div(a, b):", "    if b == 0:", "        return None", "    return a / b"],
    distractors: ["    return a // b", "    if b is None:"],
    output: "None",
    tutorRight: "Exactly — guard first, return early, and only then do the real work.",
    tutorWrong:
      "The guard must come before the division, and the early return has to be indented inside the if. If the return a / b line runs first, the guard is dead code.",
  },
  {
    kind: "parsons",
    id: "p3",
    title: "Build a filtered list",
    concept: "accumulation",
    brief: "Order the lines to collect only the even numbers.",
    solution: ["evens = []", "for n in nums:", "    if n % 2 == 0:", "        evens.append(n)", "print(evens)"],
    distractors: ["    evens.append(n)", "evens = nums"],
    output: "[2, 4]",
    tutorRight: "Right — empty accumulator, loop, test, append only on a match, print at the end.",
    tutorWrong:
      "Two levels of indentation matter here: the if sits inside the for, and the append sits inside the if. If append is at loop level you'll collect everything.",
  },
];

export function checkPredict(ex: PredictExercise, guess: string): boolean {
  return norm(guess).toLowerCase() === norm(ex.output).toLowerCase();
}
