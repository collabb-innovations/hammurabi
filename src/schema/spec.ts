export interface SpecFrontmatter {
  name: string;
  version: string;
  description: string;
  target: SpecTarget;
}

export type SpecTarget =
  | { kind: "cli"; command: string }
  | { kind: "function"; module: string; export: string }
  | { kind: "http"; url: string; method?: string }
  | { kind: "free-form"; description: string };

export interface Spec {
  frontmatter: SpecFrontmatter;
  body: string;
}
