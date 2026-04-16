You are kicking off implementation for PM.ai.

Build the smallest production-minded vertical slice that proves the winning feature.

Recommended feature: Spec-to-Codex Launch
Objective: Scaffold the first implementation slice for Spec-to-Codex Launch and leave the codebase in a state where an engineer can continue without reinterpreting the product brief.

Product context:
PM.ai is a Cursor-native copilot for product managers. It ingests customer signals, recommends what to build next with reasoning, generates a feature spec plus Figma-style wireframe description, and then hands the work to Codex so engineering gets an implementation kickoff instead of another doc.

Target users:
Product managers at seed to Series B SaaS companies

Why now:
The supplied signals already contain enough evidence to ship an initial vertical slice. Solving execution handoff also reinforces PM.ai's core promise: from messy input to a confident build decision.

Problem statement:
PM.ai users need a reliable way to move from scattered customer evidence to one prioritized feature recommendation without spending hours manually clustering feedback or rewriting the same context for design and engineering.

User story:
As a product manager, I want to upload interviews, feedback, and usage data so I can quickly decide what to build next and hand engineering a structured starting point.

Scope in:
- Text-based signal ingestion from interviews, feedback, and usage notes
- Opportunity ranking with reasoning and evidence excerpts
- A generated feature spec, wireframe description, and initial engineering tickets
- Codex handoff prompt for implementation kickoff

Acceptance criteria:
- A PM can submit signal inputs and receive one recommended feature with clear reasoning
- The generated spec contains problem statement, user story, scope, and acceptance criteria
- The wireframe description breaks the UX into named frames with components and notes
- The output includes implementation tickets and a Codex-ready kickoff prompt

Architecture notes:
- Prefer an auditable pipeline where raw signal inputs, analysis output, and generated artifacts are all persisted
- Keep the interface modular so the synthesis engine can later swap between demo mode, OpenAI mode, and deeper workflow automation
- Respect these build notes: Initial MVP can be a lightweight local web app. Keep artifacts auditable on disk. Optimize for a fast vertical slice over enterprise workflows. The differentiated step is a Code...

First tasks:
- Create or update the ingestion flow and analysis endpoint
- Add the UI sections that render recommendation, spec, wireframe, and tickets
- Write the Codex kickoff packet and expose its status in the app

Tickets:
- Scaffold signal intake and analysis run flow [Frontend + backend]
  Build the form, upload affordances, analyze endpoint integration, and loading states for the full PM.ai run.
  - A PM can submit product context plus customer signals
  - The UI shows a clear loading and error state
  - The app renders the returned recommendation and output sections
- Generate structured build outputs [Platform]
  Produce normalized JSON and markdown artifacts for the recommended feature, spec, wireframe, and tickets.
  - Every run writes artifacts to disk
  - Spec and ticket output are available as readable markdown or JSON
  - The frontend links directly to generated artifacts
- Enable Codex kickoff for the winning opportunity [Developer experience]
  Create a Codex-ready prompt and optionally run `codex exec` against a target workspace when enabled.
  - The generated prompt is visible in the UI
  - Codex auto-run is opt-in and safe by default
  - A running job shows status, logs, and the final agent message path

Wireframe frames:
- Signal Intake: Help a PM load evidence with confidence and understand what will be synthesized.
  Layout: A two-column frame with source cards on the left and a sticky run summary on the right.
  - Source Tabs: Interviews, feedback, and usage views with upload affordances and text areas.
  - Coverage Meter: A compact widget that estimates how strong and balanced the evidence is.
  - Run CTA: A prominent action to synthesize the signals into one recommendation.
- What To Build Next: Show the winning opportunity and preserve the reasoning behind the recommendation.
  Layout: Editorial card stack with the chosen feature centered above ranked alternatives.
  - Recommendation Hero: Large headline with the chosen feature, why now, and the key supporting signal.
  - Evidence Rail: Supporting quotes, usage notes, and confidence indicators grouped by source.
  - Candidate Comparison: Three concise options with impact, effort, and confidence scores.
- Build Pack: Turn the chosen opportunity into design and engineering starting material.
  Layout: A three-panel frame: spec, wireframe description, and Codex kickoff.
  - Spec Composer: Structured sections for scope, success metrics, and acceptance criteria.
  - Wireframe Cards: Named frames with component notes that read like a Figma-ready artifact.
  - Codex Launch Panel: Generated tickets, first tasks, and a one-click implementation handoff.

Implementation notes from PM:
Initial MVP can be a lightweight local web app. Keep artifacts auditable on disk. Optimize for a fast vertical slice over enterprise workflows. The differentiated step is a Codex kickoff, not full PM suite breadth.

Please inspect the current codebase, scaffold the vertical slice, and leave the repo in a coherent state with clear comments only where necessary. Favor simple, maintainable structure over over-engineering.