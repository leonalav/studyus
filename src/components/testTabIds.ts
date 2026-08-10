export type TestParams = {
  attemptId: string;
  title: string;
  subject: string;
  format: any;
  count: number;
  rigor: any;
  docId: string | null;
  picked: string[];
};

export function encodeTestTabId(params: TestParams): string {
  return `test-run-${btoa(unescape(encodeURIComponent(JSON.stringify(params))))}`;
}

export function decodeTestTabId(id: string): TestParams | null {
  if (!id.startsWith("test-run-")) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(id.slice("test-run-".length)))));
  } catch {
    return null;
  }
}
