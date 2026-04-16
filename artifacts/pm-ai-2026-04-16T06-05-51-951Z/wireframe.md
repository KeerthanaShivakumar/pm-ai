# Figma-style wireframe brief

The main experience should feel like an editorial decision studio: evidence on the left, recommendation in the center, and build outputs on the right.

## Signal Intake
Purpose: Help a PM load evidence with confidence and understand what will be synthesized.
Layout: A two-column frame with source cards on the left and a sticky run summary on the right.
- Source Tabs: Interviews, feedback, and usage views with upload affordances and text areas. (Show file names and a short import summary for trust.)
- Coverage Meter: A compact widget that estimates how strong and balanced the evidence is. (Flag when one source is underrepresented.)
- Run CTA: A prominent action to synthesize the signals into one recommendation. (Pair with a hint about what gets generated.)

## What To Build Next
Purpose: Show the winning opportunity and preserve the reasoning behind the recommendation.
Layout: Editorial card stack with the chosen feature centered above ranked alternatives.
- Recommendation Hero: Large headline with the chosen feature, why now, and the key supporting signal. (This is the decision moment and should feel confident.)
- Evidence Rail: Supporting quotes, usage notes, and confidence indicators grouped by source. (Every claim should trace back to raw signal input.)
- Candidate Comparison: Three concise options with impact, effort, and confidence scores. (Make tradeoffs easy to scan in under 30 seconds.)

## Build Pack
Purpose: Turn the chosen opportunity into design and engineering starting material.
Layout: A three-panel frame: spec, wireframe description, and Codex kickoff.
- Spec Composer: Structured sections for scope, success metrics, and acceptance criteria. (Designed for fast copy/paste into docs or backlog tools.)
- Wireframe Cards: Named frames with component notes that read like a Figma-ready artifact. (Keep the language concrete instead of abstract design talk.)
- Codex Launch Panel: Generated tickets, first tasks, and a one-click implementation handoff. (This is the product's moat and should feel operational, not aspirational.)

## Interaction notes
- Preserve raw source visibility so the PM can challenge the model's reasoning
- Keep ticket and prompt actions sticky while the user reviews the spec
- Use warmth and confidence in the UI, but make every output editable in later iterations

## Figma prompt
Design a warm editorial dashboard for product managers. Three main frames: Signal Intake, What To Build Next, and Build Pack. Use layered cards, evidence rails, score chips, and a premium but practical tone.