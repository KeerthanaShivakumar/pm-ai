export const SAMPLE_DATASETS = {
  "pm-ai": {
    label: "PM.ai happy path",
    data: {
      productName: "PM.ai",
      targetUsers: "Product managers at seed to Series B SaaS companies",
      productContext:
        "PM.ai is a Cursor-native copilot for product managers. It ingests customer signals, recommends what to build next with reasoning, generates a feature spec plus Figma-style wireframe description, and then hands the work to Codex so engineering gets an implementation kickoff instead of another doc.",
      interviews: `- "I spend half my week stitching together interview notes, support tickets, and analytics screenshots before I can even write a spec."
- "The hardest part is choosing one thing with conviction. Everything sounds important when the evidence is scattered."
- "Once I finally decide, I still have to rewrite the whole story for design and engineering."
- "I want a tool that preserves the quotes and metrics so I can defend the roadmap decision in front of leadership."`,
      feedback: `- Top support request cluster: "Can you help us understand which customer problems are coming up most often?"
- Sales call note: "Prospects like the insight synthesis, but they want something that gets them all the way to an execution brief."
- Churn interview: "The recommendations looked smart, but it still felt like another polished doc we had to operationalize ourselves."
- Internal beta feedback: "The magic moment is seeing a recommendation, spec, and engineering-ready task list appear from the same input."`,
      usageData: `- 78% of test users complete an upload flow, but only 34% create a follow-on implementation ticket.
- The most retained users are the ones who export or copy the generated spec within the first session.
- Average time from first upload to roadmap decision today: 2.8 days.
- 61% of sessions include multiple signal sources, suggesting users want cross-source synthesis rather than single-note analysis.`,
      implementationNotes:
        "Initial MVP can be a lightweight local web app. Keep artifacts auditable on disk. Optimize for a fast vertical slice over enterprise workflows. The differentiated step is a Codex kickoff, not full PM suite breadth."
    }
  },
  "conflicting-signals": {
    label: "Conflicting B2B signals",
    data: {
      productName: "OpsBoard",
      targetUsers: "Operations leaders at mid-market B2B SaaS companies",
      productContext:
        "OpsBoard helps revenue operations teams investigate pipeline issues, account risk, and rep execution gaps. The product has decent dashboard adoption but weak repeat usage after the first week.",
      interviews: `- "We need permissions for executives, managers, and analysts. Right now everyone sees the same noisy workspace."
- "The dashboards are fine, but the first-run setup takes too long and we do not know what to do next."
- "I can live without exports for a month. I cannot live with another rollout that stalls in week one."`,
      feedback: `- Support: "CSV export" appears in 31 tickets this quarter.
- Sales: "Enterprise buyers ask about SSO and roles in almost every late-stage call."
- Customer success: "Most escalations come from teams that never finished setup or connected all data sources."`,
      usageData: `- 82% of trials connect one source, but only 29% connect a second source.
- Teams that finish the setup checklist retain 3.1x better after 30 days.
- Less than 8% of active users click export in a given month.
- Role settings are visited in only 11% of active workspaces because the page is buried in admin settings.`,
      implementationNotes:
        "Keep the demo grounded in one clear first slice. Assume we can only ship one quarter's worth of work and need a compelling rationale for why setup wins over enterprise asks."
    }
  },
  "low-signal": {
    label: "Low-signal review",
    data: {
      productName: "Briefly",
      targetUsers: "Solo founders and early product teams",
      productContext:
        "Briefly turns scattered customer feedback into concise internal summaries. The product is early, adoption is noisy, and there is not much trustworthy data yet.",
      interviews: `- "It seems useful, but I am not sure when I should use it."
- "Maybe some kind of roadmap mode would help?"`,
      feedback: `- One support request asks for Slack export.
- One prospect asked if the product can summarize sales calls.
- A teammate suggested better onboarding copy.`,
      usageData: `- 19 weekly active users.
- 7 users created at least one summary last week.
- Session depth varies a lot and there is no reliable cohort trend yet.`,
      implementationNotes:
        "The output should stay honest about confidence. The workflow should not pretend certainty when the evidence is thin."
    }
  }
};

export const STAGE_ORDER = ["opportunity", "spec", "wireframe", "tickets", "codex"];
