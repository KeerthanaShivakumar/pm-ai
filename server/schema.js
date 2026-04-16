const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    executiveSummary: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          source: { type: "string" }
        },
        required: ["title", "detail", "source"]
      }
    },
    featureCandidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          userProblem: { type: "string" },
          impactScore: { type: "number" },
          effortScore: { type: "number" },
          confidenceScore: { type: "number" },
          reasoning: { type: "string" }
        },
        required: [
          "title",
          "summary",
          "userProblem",
          "impactScore",
          "effortScore",
          "confidenceScore",
          "reasoning"
        ]
      }
    },
    recommendedFeature: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        whyNow: { type: "string" },
        userProblem: { type: "string" },
        solutionBet: { type: "string" },
        successMetrics: {
          type: "array",
          items: { type: "string" }
        },
        risks: {
          type: "array",
          items: { type: "string" }
        },
        rolloutPlan: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: [
        "title",
        "whyNow",
        "userProblem",
        "solutionBet",
        "successMetrics",
        "risks",
        "rolloutPlan"
      ]
    },
    spec: {
      type: "object",
      additionalProperties: false,
      properties: {
        problemStatement: { type: "string" },
        targetUsers: { type: "string" },
        userStory: { type: "string" },
        jobsToBeDone: {
          type: "array",
          items: { type: "string" }
        },
        scopeIn: {
          type: "array",
          items: { type: "string" }
        },
        scopeOut: {
          type: "array",
          items: { type: "string" }
        },
        acceptanceCriteria: {
          type: "array",
          items: { type: "string" }
        },
        openQuestions: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: [
        "problemStatement",
        "targetUsers",
        "userStory",
        "jobsToBeDone",
        "scopeIn",
        "scopeOut",
        "acceptanceCriteria",
        "openQuestions"
      ]
    },
    wireframe: {
      type: "object",
      additionalProperties: false,
      properties: {
        vision: { type: "string" },
        frames: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              purpose: { type: "string" },
              layout: { type: "string" },
              components: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    note: { type: "string" }
                  },
                  required: ["name", "description", "note"]
                }
              }
            },
            required: ["name", "purpose", "layout", "components"]
          }
        },
        interactionNotes: {
          type: "array",
          items: { type: "string" }
        },
        figmaPrompt: { type: "string" }
      },
      required: ["vision", "frames", "interactionNotes", "figmaPrompt"]
    },
    tickets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          owner: { type: "string" },
          description: { type: "string" },
          definitionOfDone: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["title", "owner", "description", "definitionOfDone"]
      }
    },
    codexKickoff: {
      type: "object",
      additionalProperties: false,
      properties: {
        objective: { type: "string" },
        architectureNotes: {
          type: "array",
          items: { type: "string" }
        },
        firstTasks: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["objective", "architectureNotes", "firstTasks"]
    }
  },
  required: [
    "executiveSummary",
    "evidence",
    "featureCandidates",
    "recommendedFeature",
    "spec",
    "wireframe",
    "tickets",
    "codexKickoff"
  ]
};

module.exports = {
  ANALYSIS_SCHEMA
};
