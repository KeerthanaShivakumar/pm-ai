# PM.ai build brief
Mode: demo
Warnings: OPENAI_API_KEY is not set, so PM.ai is running in deterministic demo mode.
## Executive summary
PM.ai should build Spec-to-Codex Launch next. The signals point to a recurring pain around execution handoff, and the fastest differentiated move is to turn raw evidence into a confident decision plus a clean implementation handoff.
## Build next: Spec-to-Codex Launch
The supplied signals already contain enough evidence to ship an initial vertical slice. Solving execution handoff also reinforces PM.ai's core promise: from messy input to a confident build decision.
### User problem
PMs lose momentum after the recommendation because they still need to rewrite context for engineering.
### Solution bet
Create a single workflow that clusters incoming signals, ranks the opportunity, and turns the winning insight into a spec, wireframe description, and engineering kickoff packet.
### Success metrics
- Time from raw signal upload to approved spec drops below 15 minutes
- At least 70% of synthesized feature recommendations are accepted without major rewrite
- At least 50% of runs produce engineering tickets that can move directly into backlog grooming
## Evidence
- Product positioning (Product context): PM.ai is a Cursor-native copilot for product managers. It ingests customer signals, recommends what to build next with reasoning, generates a feature spec plus Figma-style wiref...
- Customer interview pattern (Interviews): - "I spend half my week stitching together interview notes, support tickets, and analytics screenshots before I can even write a spec."
- Feedback backlog pattern (Feedback): - Top support request cluster: "Can you help us understand which customer problems are coming up most often?"
- Usage or adoption signal (Usage data): - 78% of test users complete an upload flow, but only 34% create a follow-on implementation ticket.
## Acceptance criteria
- A PM can submit signal inputs and receive one recommended feature with clear reasoning
- The generated spec contains problem statement, user story, scope, and acceptance criteria
- The wireframe description breaks the UX into named frames with components and notes
- The output includes implementation tickets and a Codex-ready kickoff prompt
## Tickets
### Scaffold signal intake and analysis run flow
Owner: Frontend + backend
Build the form, upload affordances, analyze endpoint integration, and loading states for the full PM.ai run.
- A PM can submit product context plus customer signals
- The UI shows a clear loading and error state
- The app renders the returned recommendation and output sections
### Generate structured build outputs
Owner: Platform
Produce normalized JSON and markdown artifacts for the recommended feature, spec, wireframe, and tickets.
- Every run writes artifacts to disk
- Spec and ticket output are available as readable markdown or JSON
- The frontend links directly to generated artifacts
### Enable Codex kickoff for the winning opportunity
Owner: Developer experience
Create a Codex-ready prompt and optionally run `codex exec` against a target workspace when enabled.
- The generated prompt is visible in the UI
- Codex auto-run is opt-in and safe by default
- A running job shows status, logs, and the final agent message path
## Codex kickoff
See `codex-prompt.md` for the full implementation prompt.