export interface Fixture {
  id: string;
  input: unknown;
  expected?: unknown;
  tags?: string[];
  notes?: string;
}

export interface FixtureSet {
  specName: string;
  specVersion: string;
  fixtures: Fixture[];
}
