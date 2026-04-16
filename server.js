const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const ROOT_DIR = __dirname;
loadLocalEnvFiles(ROOT_DIR);
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const ARTIFACTS_DIR = path.join(ROOT_DIR, "artifacts");
const DEFAULT_WORKSPACE_DIR = path.join(ROOT_DIR, "generated", "pm-ai-target");
const CODEX_ALLOWED_WORKSPACE_ROOT = process.env.CODEX_ALLOWED_WORKSPACE_ROOT
  ? path.resolve(process.env.CODEX_ALLOWED_WORKSPACE_ROOT)
  : "";
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const DEFAULT_CODEX_MODEL = process.env.CODEX_MODEL || "gpt-5.3-codex";
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const jobs = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

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

ensureDir(ARTIFACTS_DIR);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        mode: process.env.OPENAI_API_KEY ? "openai" : "demo",
        defaultOpenAiModel: DEFAULT_OPENAI_MODEL,
        defaultCodexModel: DEFAULT_CODEX_MODEL,
        codexAutoRunEnabled: process.env.ALLOW_CODEX_RUN === "1",
        suggestedCodexWorkspace: DEFAULT_WORKSPACE_DIR
      });
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(req, res);
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const jobId = url.pathname.split("/").pop();
      const job = jobId ? jobs.get(jobId) : null;
      if (!job) {
        return sendJson(res, 404, { error: "Job not found." });
      }
      return sendJson(res, 200, serializeJob(job));
    }

    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      return serveFile(res, path.join(ROOT_DIR, url.pathname), ARTIFACTS_DIR);
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/public/"))) {
      const relativePath = url.pathname === "/" ? "/index.html" : url.pathname.replace("/public", "");
      return serveFile(res, path.join(PUBLIC_DIR, relativePath), PUBLIC_DIR);
    }

    sendJson(res, 404, { error: "Route not found." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: "Unexpected server error.",
      detail: error.message
    });
  }
});

async function handleAnalyze(req, res) {
  const payload = await readJsonBody(req);
  const input = normalizeInput(payload);

  if (!hasMinimumInput(input)) {
    return sendJson(res, 400, {
      error: "Add at least one meaningful customer signal or product context before running PM.ai."
    });
  }

  const runId = buildRunId(input.productName);
  const warnings = [];
  let mode = "demo";
  let analysis;

  if (process.env.OPENAI_API_KEY) {
    try {
      analysis = await analyzeWithOpenAI(input);
      mode = "openai";
    } catch (error) {
      warnings.push(`OpenAI call failed, so PM.ai fell back to demo synthesis: ${error.message}`);
      analysis = buildDemoAnalysis(input);
      mode = "demo-fallback";
    }
  } else {
    analysis = buildDemoAnalysis(input);
    warnings.push("OPENAI_API_KEY is not set, so PM.ai is running in deterministic demo mode.");
  }

  analysis = normalizeAnalysis(analysis, input);
  analysis.codexKickoff.prompt = renderCodexPrompt(input, analysis);
  analysis.codexKickoff.commandPreview = [
    CODEX_BIN,
    "exec",
    "--skip-git-repo-check",
    "--full-auto",
    "-m",
    DEFAULT_CODEX_MODEL,
    "-C",
    "<workspace>",
    "-"
  ].join(" ");

  const artifactBundle = writeArtifacts(runId, input, analysis, { mode, warnings });
  const codexJob = maybeStartCodexRun({
    input,
    runId,
    artifactBundle,
    prompt: analysis.codexKickoff.prompt
  });

  return sendJson(res, 200, {
    ok: true,
    runId,
    mode,
    warnings,
    analysis,
    artifacts: artifactBundle.files,
    codexJob
  });
}

async function analyzeWithOpenAI(input) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are PM.ai, a world-class product strategist who turns messy customer signals into a crisp roadmap decision, a shippable spec, a Figma-style wireframe description, and an engineering handoff. Be concrete, evidence-led, and pragmatic. Favor one feature to build next, not a vague roadmap."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildOpenAIUserPrompt(input)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "pm_ai_blueprint",
          strict: true,
          schema: ANALYSIS_SCHEMA
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (data.output_parsed) {
    return data.output_parsed;
  }

  const outputText = extractResponseText(data);
  return JSON.parse(stripCodeFence(outputText));
}

function buildOpenAIUserPrompt(input) {
  return [
    "Build the next best feature recommendation for this product.",
    "",
    `Product name: ${input.productName}`,
    `Target users: ${input.targetUsers || "Not provided"}`,
    "",
    "Product context:",
    input.productContext || "Not provided",
    "",
    "Customer interviews:",
    input.interviews || "Not provided",
    "",
    "Feedback / support data:",
    input.feedback || "Not provided",
    "",
    "Usage data:",
    input.usageData || "Not provided",
    "",
    "Implementation notes:",
    input.implementationNotes || "Not provided",
    "",
    "Output requirements:",
    "- Choose one feature to build next and explain why now.",
    "- Use evidence from the supplied signals.",
    "- Keep tickets scoped to an initial vertical slice.",
    "- Wireframe should read like a Figma-ready set of frames and components.",
    "- Architecture notes should help an engineer or Codex start implementation immediately."
  ].join("\n");
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const parts = [];
  const blocks = Array.isArray(data?.output) ? data.output : [];
  for (const block of blocks) {
    const content = Array.isArray(block?.content) ? block.content : [];
    for (const item of content) {
      if (typeof item?.text === "string") {
        parts.push(item.text);
      } else if (typeof item?.content === "string") {
        parts.push(item.content);
      }
    }
  }

  if (parts.length) {
    return parts.join("\n");
  }

  throw new Error("OpenAI returned an empty response.");
}

function normalizeInput(payload) {
  return {
    productName: asString(payload.productName) || "PM.ai",
    targetUsers: asString(payload.targetUsers),
    productContext: asString(payload.productContext),
    interviews: asString(payload.interviews),
    feedback: asString(payload.feedback),
    usageData: asString(payload.usageData),
    implementationNotes: asString(payload.implementationNotes),
    codexWorkspacePath: asString(payload.codexWorkspacePath),
    runCodex: Boolean(payload.runCodex)
  };
}

function hasMinimumInput(input) {
  return [
    input.productContext,
    input.interviews,
    input.feedback,
    input.usageData,
    input.implementationNotes
  ].some((value) => value.length > 0);
}

function buildDemoAnalysis(input) {
  const themes = scoreThemes(input);
  const primary = themes[0];
  const secondary = themes[1];
  const tertiary = themes[2];
  const productLabel = input.productName || "PM.ai";
  const stackHint = input.implementationNotes
    ? `Respect these build notes: ${truncate(input.implementationNotes, 180)}`
    : "Keep the first version lightweight, auditable, and easy to extend.";

  return {
    executiveSummary:
      `${productLabel} should build ${primary.featureTitle} next. The signals point to a recurring pain around ${primary.label.toLowerCase()}, and the fastest differentiated move is to turn raw evidence into a confident decision plus a clean implementation handoff.`,
    evidence: buildEvidence(input, themes),
    featureCandidates: [primary, secondary, tertiary].map((theme, index) => ({
      title: theme.featureTitle,
      summary: theme.summary,
      userProblem: theme.userProblem,
      impactScore: clampScore(9 - index),
      effortScore: clampScore(5 + index),
      confidenceScore: clampScore(8 - index),
      reasoning: `Signals repeatedly mention ${theme.keywordPreview}. ${theme.reasoning}`
    })),
    recommendedFeature: {
      title: primary.featureTitle,
      whyNow:
        `The supplied signals already contain enough evidence to ship an initial vertical slice. Solving ${primary.label.toLowerCase()} also reinforces PM.ai's core promise: from messy input to a confident build decision.`,
      userProblem: primary.userProblem,
      solutionBet:
        `Create a single workflow that clusters incoming signals, ranks the opportunity, and turns the winning insight into a spec, wireframe description, and engineering kickoff packet.`,
      successMetrics: [
        "Time from raw signal upload to approved spec drops below 15 minutes",
        "At least 70% of synthesized feature recommendations are accepted without major rewrite",
        "At least 50% of runs produce engineering tickets that can move directly into backlog grooming"
      ],
      risks: [
        "Over-generalizing from low-signal or biased customer input",
        "Generating output that feels polished but is not implementation-ready",
        "Producing too much scope for the first shipped slice"
      ],
      rolloutPlan: [
        "Start with a single project workspace that accepts pasted text and uploaded notes",
        "Ship opportunity ranking plus one recommended feature with reasoning",
        "Add spec, wireframe description, and Codex kickoff as the differentiated second half of the flow"
      ]
    },
    spec: {
      problemStatement:
        `${productLabel} users need a reliable way to move from scattered customer evidence to one prioritized feature recommendation without spending hours manually clustering feedback or rewriting the same context for design and engineering.`,
      targetUsers:
        input.targetUsers || "Product managers at small to mid-size software teams",
      userStory:
        "As a product manager, I want to upload interviews, feedback, and usage data so I can quickly decide what to build next and hand engineering a structured starting point.",
      jobsToBeDone: [
        "Consolidate scattered customer evidence into a shared decision workspace",
        "Understand which pain is strongest and why it matters now",
        "Convert the recommendation into execution artifacts without rewriting context"
      ],
      scopeIn: [
        "Text-based signal ingestion from interviews, feedback, and usage notes",
        "Opportunity ranking with reasoning and evidence excerpts",
        "A generated feature spec, wireframe description, and initial engineering tickets",
        "Codex handoff prompt for implementation kickoff"
      ],
      scopeOut: [
        "Production-grade design editing or real Figma API integration",
        "Bi-directional ticket sync with Linear or Jira",
        "Multi-team portfolio planning and permissions"
      ],
      acceptanceCriteria: [
        "A PM can submit signal inputs and receive one recommended feature with clear reasoning",
        "The generated spec contains problem statement, user story, scope, and acceptance criteria",
        "The wireframe description breaks the UX into named frames with components and notes",
        "The output includes implementation tickets and a Codex-ready kickoff prompt"
      ],
      openQuestions: [
        "Should evidence clustering happen automatically or allow manual editing before generation?",
        "Which developer workflow is most valuable first: local Codex, GitHub PR creation, or ticket sync?",
        "How much product and codebase context should PM.ai require before running Codex?"
      ]
    },
    wireframe: {
      vision:
        "The main experience should feel like an editorial decision studio: evidence on the left, recommendation in the center, and build outputs on the right.",
      frames: [
        {
          name: "Signal Intake",
          purpose: "Help a PM load evidence with confidence and understand what will be synthesized.",
          layout: "A two-column frame with source cards on the left and a sticky run summary on the right.",
          components: [
            {
              name: "Source Tabs",
              description: "Interviews, feedback, and usage views with upload affordances and text areas.",
              note: "Show file names and a short import summary for trust."
            },
            {
              name: "Coverage Meter",
              description: "A compact widget that estimates how strong and balanced the evidence is.",
              note: "Flag when one source is underrepresented."
            },
            {
              name: "Run CTA",
              description: "A prominent action to synthesize the signals into one recommendation.",
              note: "Pair with a hint about what gets generated."
            }
          ]
        },
        {
          name: "What To Build Next",
          purpose: "Show the winning opportunity and preserve the reasoning behind the recommendation.",
          layout: "Editorial card stack with the chosen feature centered above ranked alternatives.",
          components: [
            {
              name: "Recommendation Hero",
              description: "Large headline with the chosen feature, why now, and the key supporting signal.",
              note: "This is the decision moment and should feel confident."
            },
            {
              name: "Evidence Rail",
              description: "Supporting quotes, usage notes, and confidence indicators grouped by source.",
              note: "Every claim should trace back to raw signal input."
            },
            {
              name: "Candidate Comparison",
              description: "Three concise options with impact, effort, and confidence scores.",
              note: "Make tradeoffs easy to scan in under 30 seconds."
            }
          ]
        },
        {
          name: "Build Pack",
          purpose: "Turn the chosen opportunity into design and engineering starting material.",
          layout: "A three-panel frame: spec, wireframe description, and Codex kickoff.",
          components: [
            {
              name: "Spec Composer",
              description: "Structured sections for scope, success metrics, and acceptance criteria.",
              note: "Designed for fast copy/paste into docs or backlog tools."
            },
            {
              name: "Wireframe Cards",
              description: "Named frames with component notes that read like a Figma-ready artifact.",
              note: "Keep the language concrete instead of abstract design talk."
            },
            {
              name: "Codex Launch Panel",
              description: "Generated tickets, first tasks, and a one-click implementation handoff.",
              note: "This is the product's moat and should feel operational, not aspirational."
            }
          ]
        }
      ],
      interactionNotes: [
        "Preserve raw source visibility so the PM can challenge the model's reasoning",
        "Keep ticket and prompt actions sticky while the user reviews the spec",
        "Use warmth and confidence in the UI, but make every output editable in later iterations"
      ],
      figmaPrompt:
        "Design a warm editorial dashboard for product managers. Three main frames: Signal Intake, What To Build Next, and Build Pack. Use layered cards, evidence rails, score chips, and a premium but practical tone."
    },
    tickets: [
      {
        title: "Scaffold signal intake and analysis run flow",
        owner: "Frontend + backend",
        description:
          "Build the form, upload affordances, analyze endpoint integration, and loading states for the full PM.ai run.",
        definitionOfDone: [
          "A PM can submit product context plus customer signals",
          "The UI shows a clear loading and error state",
          "The app renders the returned recommendation and output sections"
        ]
      },
      {
        title: "Generate structured build outputs",
        owner: "Platform",
        description:
          "Produce normalized JSON and markdown artifacts for the recommended feature, spec, wireframe, and tickets.",
        definitionOfDone: [
          "Every run writes artifacts to disk",
          "Spec and ticket output are available as readable markdown or JSON",
          "The frontend links directly to generated artifacts"
        ]
      },
      {
        title: "Enable Codex kickoff for the winning opportunity",
        owner: "Developer experience",
        description:
          "Create a Codex-ready prompt and optionally run `codex exec` against a target workspace when enabled.",
        definitionOfDone: [
          "The generated prompt is visible in the UI",
          "Codex auto-run is opt-in and safe by default",
          "A running job shows status, logs, and the final agent message path"
        ]
      }
    ],
    codexKickoff: {
      objective:
        `Scaffold the first implementation slice for ${primary.featureTitle} and leave the codebase in a state where an engineer can continue without reinterpreting the product brief.`,
      architectureNotes: [
        "Prefer an auditable pipeline where raw signal inputs, analysis output, and generated artifacts are all persisted",
        "Keep the interface modular so the synthesis engine can later swap between demo mode, OpenAI mode, and deeper workflow automation",
        stackHint
      ],
      firstTasks: [
        "Create or update the ingestion flow and analysis endpoint",
        "Add the UI sections that render recommendation, spec, wireframe, and tickets",
        "Write the Codex kickoff packet and expose its status in the app"
      ]
    }
  };
}

function buildEvidence(input, themes) {
  const sources = [
    {
      title: "Customer interview pattern",
      source: "Interviews",
      detail: firstUsefulLine(input.interviews)
    },
    {
      title: "Feedback backlog pattern",
      source: "Feedback",
      detail: firstUsefulLine(input.feedback)
    },
    {
      title: "Usage or adoption signal",
      source: "Usage data",
      detail: firstUsefulLine(input.usageData)
    }
  ].filter((item) => item.detail);

  if (input.productContext) {
    sources.unshift({
      title: "Product positioning",
      source: "Product context",
      detail: truncate(input.productContext, 180)
    });
  }

  if (sources.length < 4) {
    sources.push({
      title: "Synthesis theme",
      source: "PM.ai",
      detail: `The strongest recurring theme is ${themes[0].label.toLowerCase()}, followed by ${themes[1].label.toLowerCase()}.`
    });
  }

  return sources.slice(0, 4);
}

function scoreThemes(input) {
  const corpus = [
    input.productContext,
    input.interviews,
    input.feedback,
    input.usageData,
    input.implementationNotes
  ]
    .join("\n")
    .toLowerCase();

  const catalog = [
    {
      label: "Feedback triage",
      featureTitle: "Unified Insight Inbox",
      userProblem: "PMs cannot easily tell which requests are duplicates, urgent, or representative.",
      summary: "Cluster incoming evidence into themes and reveal the strongest pain automatically.",
      keywords: ["feedback", "support", "request", "duplicate", "theme", "tag", "triage", "cluster"],
      reasoning: "A better intake layer makes every downstream recommendation more trustworthy."
    },
    {
      label: "Prioritization clarity",
      featureTitle: "Opportunity Scorecard",
      userProblem: "PMs struggle to justify why one opportunity deserves to be built next.",
      summary: "Rank feature opportunities with evidence-backed scores for impact, effort, and confidence.",
      keywords: ["priorit", "roadmap", "what to build", "decide", "confidence", "impact", "effort"],
      reasoning: "This is the decision layer that turns signals into a roadmap move."
    },
    {
      label: "Execution handoff",
      featureTitle: "Spec-to-Codex Launch",
      userProblem: "PMs lose momentum after the recommendation because they still need to rewrite context for engineering.",
      summary: "Generate a spec, wireframe description, tickets, and a Codex-ready implementation kickoff.",
      keywords: ["codex", "engineering", "ticket", "jira", "linear", "handoff", "implement", "build it"],
      reasoning: "Closing the loop from signal to first code is the product's key differentiation."
    },
    {
      label: "Behavior insight visibility",
      featureTitle: "Usage + Voice Correlation",
      userProblem: "PMs cannot connect customer complaints to actual product behavior or adoption trends.",
      summary: "Overlay feedback themes with usage signals to show what is painful and materially important.",
      keywords: ["usage", "retention", "adoption", "funnel", "activation", "dropoff", "behavior"],
      reasoning: "Quant plus qual evidence gives the recommendation more credibility."
    },
    {
      label: "Cross-functional alignment",
      featureTitle: "Decision Workspace",
      userProblem: "Design, product, and engineering lose context when a recommendation moves into execution.",
      summary: "Keep reasoning, scope, and next steps together in one shared output pack.",
      keywords: ["stakeholder", "alignment", "design", "engineering", "collaboration", "handover"],
      reasoning: "A shared workspace reduces churn and second-guessing after the decision."
    },
    {
      label: "Findability",
      featureTitle: "Semantic Evidence Explorer",
      userProblem: "Teams cannot quickly find the exact user quote or metric that supports a roadmap call.",
      summary: "Make evidence searchable by theme, persona, or behavior pattern.",
      keywords: ["search", "find", "query", "filter", "discover"],
      reasoning: "Trust increases when people can inspect the source material quickly."
    }
  ];

  const ranked = catalog.map((theme) => {
    const score = theme.keywords.reduce((sum, keyword) => {
      const matches = corpus.match(new RegExp(escapeRegExp(keyword), "g"));
      return sum + (matches ? matches.length : 0);
    }, 0);

    return {
      ...theme,
      score,
      keywordPreview: theme.keywords.slice(0, 3).join(", ")
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  if (ranked[0].score === 0) {
    ranked[0].score = 3;
    ranked[1].score = 2;
    ranked[2].score = 1;
  }
  return ranked.slice(0, 3);
}

function normalizeAnalysis(raw, input) {
  const fallback = buildDemoAnalysis(input);
  const analysis = {
    executiveSummary: asString(raw?.executiveSummary) || fallback.executiveSummary,
    evidence: normalizeEvidence(raw?.evidence, fallback.evidence),
    featureCandidates: normalizeFeatureCandidates(raw?.featureCandidates, fallback.featureCandidates),
    recommendedFeature: normalizeRecommendedFeature(raw?.recommendedFeature, fallback.recommendedFeature),
    spec: normalizeSpec(raw?.spec, fallback.spec),
    wireframe: normalizeWireframe(raw?.wireframe, fallback.wireframe),
    tickets: normalizeTickets(raw?.tickets, fallback.tickets),
    codexKickoff: normalizeCodexKickoff(raw?.codexKickoff, fallback.codexKickoff)
  };

  return analysis;
}

function normalizeEvidence(value, fallback) {
  const items = Array.isArray(value)
    ? value
        .map((item) => ({
          title: asString(item?.title),
          detail: asString(item?.detail),
          source: asString(item?.source)
        }))
        .filter((item) => item.title && item.detail && item.source)
    : [];

  return items.length ? items.slice(0, 6) : fallback;
}

function normalizeFeatureCandidates(value, fallback) {
  const items = Array.isArray(value)
    ? value
        .map((item) => ({
          title: asString(item?.title),
          summary: asString(item?.summary),
          userProblem: asString(item?.userProblem),
          impactScore: clampScore(item?.impactScore),
          effortScore: clampScore(item?.effortScore),
          confidenceScore: clampScore(item?.confidenceScore),
          reasoning: asString(item?.reasoning)
        }))
        .filter((item) => item.title && item.summary && item.userProblem && item.reasoning)
    : [];

  return items.length ? items.slice(0, 4) : fallback;
}

function normalizeRecommendedFeature(value, fallback) {
  const candidate = value || {};
  return {
    title: asString(candidate.title) || fallback.title,
    whyNow: asString(candidate.whyNow) || fallback.whyNow,
    userProblem: asString(candidate.userProblem) || fallback.userProblem,
    solutionBet: asString(candidate.solutionBet) || fallback.solutionBet,
    successMetrics: stringArray(candidate.successMetrics, fallback.successMetrics),
    risks: stringArray(candidate.risks, fallback.risks),
    rolloutPlan: stringArray(candidate.rolloutPlan, fallback.rolloutPlan)
  };
}

function normalizeSpec(value, fallback) {
  const spec = value || {};
  return {
    problemStatement: asString(spec.problemStatement) || fallback.problemStatement,
    targetUsers: asString(spec.targetUsers) || fallback.targetUsers,
    userStory: asString(spec.userStory) || fallback.userStory,
    jobsToBeDone: stringArray(spec.jobsToBeDone, fallback.jobsToBeDone),
    scopeIn: stringArray(spec.scopeIn, fallback.scopeIn),
    scopeOut: stringArray(spec.scopeOut, fallback.scopeOut),
    acceptanceCriteria: stringArray(spec.acceptanceCriteria, fallback.acceptanceCriteria),
    openQuestions: stringArray(spec.openQuestions, fallback.openQuestions)
  };
}

function normalizeWireframe(value, fallback) {
  const wireframe = value || {};
  const frames = Array.isArray(wireframe.frames)
    ? wireframe.frames
        .map((frame) => ({
          name: asString(frame?.name),
          purpose: asString(frame?.purpose),
          layout: asString(frame?.layout),
          components: Array.isArray(frame?.components)
            ? frame.components
                .map((component) => ({
                  name: asString(component?.name),
                  description: asString(component?.description),
                  note: asString(component?.note)
                }))
                .filter((component) => component.name && component.description && component.note)
            : []
        }))
        .filter((frame) => frame.name && frame.purpose && frame.layout && frame.components.length)
    : [];

  return {
    vision: asString(wireframe.vision) || fallback.vision,
    frames: frames.length ? frames.slice(0, 5) : fallback.frames,
    interactionNotes: stringArray(wireframe.interactionNotes, fallback.interactionNotes),
    figmaPrompt: asString(wireframe.figmaPrompt) || fallback.figmaPrompt
  };
}

function normalizeTickets(value, fallback) {
  const tickets = Array.isArray(value)
    ? value
        .map((ticket) => ({
          title: asString(ticket?.title),
          owner: asString(ticket?.owner),
          description: asString(ticket?.description),
          definitionOfDone: stringArray(ticket?.definitionOfDone, [])
        }))
        .filter((ticket) => ticket.title && ticket.owner && ticket.description && ticket.definitionOfDone.length)
    : [];

  return tickets.length ? tickets.slice(0, 6) : fallback;
}

function normalizeCodexKickoff(value, fallback) {
  const kickoff = value || {};
  return {
    objective: asString(kickoff.objective) || fallback.objective,
    architectureNotes: stringArray(kickoff.architectureNotes, fallback.architectureNotes),
    firstTasks: stringArray(kickoff.firstTasks, fallback.firstTasks)
  };
}

function writeArtifacts(runId, input, analysis, meta) {
  const runDir = path.join(ARTIFACTS_DIR, runId);
  ensureDir(runDir);

  const payload = {
    meta: {
      createdAt: new Date().toISOString(),
      mode: meta.mode,
      warnings: meta.warnings
    },
    input,
    analysis
  };

  const filesToWrite = [
    {
      name: "input.json",
      content: `${JSON.stringify(input, null, 2)}\n`
    },
    {
      name: "analysis.json",
      content: `${JSON.stringify(payload, null, 2)}\n`
    },
    {
      name: "brief.md",
      content: renderBriefMarkdown(input, analysis, meta)
    },
    {
      name: "wireframe.md",
      content: renderWireframeMarkdown(analysis.wireframe)
    },
    {
      name: "tickets.json",
      content: `${JSON.stringify(analysis.tickets, null, 2)}\n`
    },
    {
      name: "codex-prompt.md",
      content: analysis.codexKickoff.prompt
    }
  ];

  const writtenFiles = filesToWrite.map((file) => {
    const absolutePath = path.join(runDir, file.name);
    fs.writeFileSync(absolutePath, file.content, "utf8");
    return {
      name: file.name,
      path: absolutePath,
      url: `/artifacts/${runId}/${file.name}`
    };
  });

  return {
    runDir,
    files: writtenFiles
  };
}

function maybeStartCodexRun({ input, runId, artifactBundle, prompt }) {
  if (!input.runCodex) {
    return {
      status: "idle",
      reason: "Codex auto-run was not requested."
    };
  }

  if (process.env.ALLOW_CODEX_RUN !== "1") {
    return {
      status: "disabled",
      reason: "Set ALLOW_CODEX_RUN=1 to let PM.ai launch `codex exec` automatically."
    };
  }

  const workspacePath = resolveWorkspacePath(input.codexWorkspacePath || DEFAULT_WORKSPACE_DIR);
  if (CODEX_ALLOWED_WORKSPACE_ROOT && !isPathInsideRoot(workspacePath, CODEX_ALLOWED_WORKSPACE_ROOT)) {
    return {
      status: "disabled",
      reason: "Codex workspace path is outside the configured allowlist."
    };
  }
  ensureDir(workspacePath);

  const codexDir = path.join(artifactBundle.runDir, "codex");
  ensureDir(codexDir);

  const jobId = `job-${Date.now()}`;
  const logPath = path.join(codexDir, "session.log");
  const lastMessagePath = path.join(codexDir, "last-message.md");
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--full-auto",
    "-m",
    DEFAULT_CODEX_MODEL,
    "-C",
    workspacePath,
    "-o",
    lastMessagePath,
    "-"
  ];

  const child = spawn(CODEX_BIN, args, {
    cwd: workspacePath,
    env: process.env
  });

  const job = {
    id: jobId,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    command: [CODEX_BIN, ...args].join(" "),
    workspacePath,
    logPath,
    logUrl: `/artifacts/${runId}/codex/session.log`,
    lastMessagePath,
    lastMessageUrl: `/artifacts/${runId}/codex/last-message.md`,
    tail: []
  };

  jobs.set(jobId, job);
  fs.writeFileSync(logPath, "", "utf8");

  const appendLog = (chunk, streamName) => {
    const text = `${streamName}: ${chunk.toString()}`;
    fs.appendFileSync(logPath, text, "utf8");
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    job.tail.push(...lines);
    job.tail = job.tail.slice(-40);
  };

  child.stdout.on("data", (chunk) => appendLog(chunk, "stdout"));
  child.stderr.on("data", (chunk) => appendLog(chunk, "stderr"));
  child.on("error", (error) => {
    appendLog(Buffer.from(error.message), "error");
    job.status = "failed";
    job.completedAt = new Date().toISOString();
  });
  child.on("close", (code) => {
    job.exitCode = code;
    job.status = code === 0 ? "completed" : "failed";
    job.completedAt = new Date().toISOString();
  });

  child.stdin.write(prompt);
  child.stdin.end();

  return serializeJob(job);
}

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    exitCode: job.exitCode,
    command: job.command,
    workspacePath: job.workspacePath,
    logPath: job.logPath,
    logUrl: job.logUrl,
    lastMessagePath: job.lastMessagePath,
    lastMessageUrl: job.lastMessageUrl,
    tail: job.tail
  };
}

function renderBriefMarkdown(input, analysis, meta) {
  return [
    `# ${input.productName} build brief`,
    "",
    `Mode: ${meta.mode}`,
    meta.warnings.length ? `Warnings: ${meta.warnings.join(" | ")}` : null,
    "",
    "## Executive summary",
    analysis.executiveSummary,
    "",
    `## Build next: ${analysis.recommendedFeature.title}`,
    analysis.recommendedFeature.whyNow,
    "",
    "### User problem",
    analysis.recommendedFeature.userProblem,
    "",
    "### Solution bet",
    analysis.recommendedFeature.solutionBet,
    "",
    "### Success metrics",
    ...analysis.recommendedFeature.successMetrics.map((item) => `- ${item}`),
    "",
    "## Evidence",
    ...analysis.evidence.map((item) => `- ${item.title} (${item.source}): ${item.detail}`),
    "",
    "## Acceptance criteria",
    ...analysis.spec.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "## Tickets",
    ...analysis.tickets.flatMap((ticket) => [
      `### ${ticket.title}`,
      `Owner: ${ticket.owner}`,
      ticket.description,
      ...ticket.definitionOfDone.map((item) => `- ${item}`),
      ""
    ]),
    "## Codex kickoff",
    "See `codex-prompt.md` for the full implementation prompt."
  ]
    .filter(Boolean)
    .join("\n");
}

function renderWireframeMarkdown(wireframe) {
  return [
    "# Figma-style wireframe brief",
    "",
    wireframe.vision,
    "",
    ...wireframe.frames.flatMap((frame) => [
      `## ${frame.name}`,
      `Purpose: ${frame.purpose}`,
      `Layout: ${frame.layout}`,
      ...frame.components.map(
        (component) =>
          `- ${component.name}: ${component.description} (${component.note})`
      ),
      ""
    ]),
    "## Interaction notes",
    ...wireframe.interactionNotes.map((note) => `- ${note}`),
    "",
    "## Figma prompt",
    wireframe.figmaPrompt
  ].join("\n");
}

function renderCodexPrompt(input, analysis) {
  return [
    `You are kicking off implementation for ${input.productName}.`,
    "",
    "Build the smallest production-minded vertical slice that proves the winning feature.",
    "",
    `Recommended feature: ${analysis.recommendedFeature.title}`,
    `Objective: ${analysis.codexKickoff.objective}`,
    "",
    "Product context:",
    input.productContext || "No extra product context provided.",
    "",
    "Target users:",
    input.targetUsers || "Not specified.",
    "",
    "Why now:",
    analysis.recommendedFeature.whyNow,
    "",
    "Problem statement:",
    analysis.spec.problemStatement,
    "",
    "User story:",
    analysis.spec.userStory,
    "",
    "Scope in:",
    ...analysis.spec.scopeIn.map((item) => `- ${item}`),
    "",
    "Acceptance criteria:",
    ...analysis.spec.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "Architecture notes:",
    ...analysis.codexKickoff.architectureNotes.map((item) => `- ${item}`),
    "",
    "First tasks:",
    ...analysis.codexKickoff.firstTasks.map((item) => `- ${item}`),
    "",
    "Tickets:",
    ...analysis.tickets.flatMap((ticket) => [
      `- ${ticket.title} [${ticket.owner}]`,
      `  ${ticket.description}`,
      ...ticket.definitionOfDone.map((item) => `  - ${item}`)
    ]),
    "",
    "Wireframe frames:",
    ...analysis.wireframe.frames.flatMap((frame) => [
      `- ${frame.name}: ${frame.purpose}`,
      `  Layout: ${frame.layout}`,
      ...frame.components.map((component) => `  - ${component.name}: ${component.description}`)
    ]),
    "",
    "Implementation notes from PM:",
    input.implementationNotes || "None provided.",
    "",
    "Please inspect the current codebase, scaffold the vertical slice, and leave the repo in a coherent state with clear comments only where necessary. Favor simple, maintainable structure over over-engineering."
  ].join("\n");
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function serveFile(res, requestedPath, allowedRoot) {
  const safePath = path.resolve(requestedPath);
  const safeRoot = path.resolve(allowedRoot);
  if (!isPathInsideRoot(safePath, safeRoot)) {
    return sendJson(res, 403, { error: "Access denied." });
  }

  if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
    return sendJson(res, 404, { error: "File not found." });
  }

  const extension = path.extname(safePath).toLowerCase();
  const mimeType = MIME_TYPES[extension] || "application/octet-stream";
  res.writeHead(200, {
    ...buildBaseHeaders(),
    "Content-Type": mimeType
  });
  fs.createReadStream(safePath).pipe(res);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...buildBaseHeaders(),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function buildBaseHeaders() {
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadLocalEnvFiles(rootDir) {
  const merged = {};
  for (const fileName of [".env", ".env.local"]) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const parsed = parseDotEnv(fs.readFileSync(filePath, "utf8"));
    Object.assign(merged, parsed);
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseDotEnv(content) {
  const parsed = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function resolveWorkspacePath(value) {
  if (!value) {
    return DEFAULT_WORKSPACE_DIR;
  }
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

function isPathInsideRoot(candidatePath, rootPath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function buildRunId(productName) {
  const slug = slugify(productName || "pm-ai");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${slug}-${stamp}`;
}

function slugify(value) {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "pm-ai";
}

function stringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const clean = value.map(asString).filter(Boolean);
  return clean.length ? clean : fallback;
}

function firstUsefulLine(value) {
  const lines = asString(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);
  return lines.length ? truncate(lines[0], 180) : "";
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value, maxLength) {
  const input = asString(value);
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 3)}...`;
}

function stripCodeFence(value) {
  return asString(value).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function startServer() {
  server.listen(PORT, HOST, () => {
    console.log(`PM.ai is running at http://${HOST}:${PORT}`);
  });

  server.on("error", (error) => {
    console.error(`PM.ai could not start on ${HOST}:${PORT}: ${error.message}`);
    process.exit(1);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  buildDemoAnalysis,
  normalizeAnalysis,
  normalizeInput,
  renderCodexPrompt,
  renderWireframeMarkdown,
  renderBriefMarkdown,
  writeArtifacts,
  resolveWorkspacePath,
  buildRunId,
  startServer
};
