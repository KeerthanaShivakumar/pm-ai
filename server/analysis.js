const { ANALYSIS_SCHEMA } = require("./schema");
const {
  fs,
  path,
  ARTIFACTS_DIR,
  OPENAI_RESPONSES_URL,
  DEFAULT_OPENAI_MODEL,
  ensureDir,
  uniqueStrings,
  stringArray,
  firstUsefulLine,
  clampScore,
  asString,
  truncate,
  stripCodeFence,
  escapeRegExp,
  logInfo,
  logWarn,
  summarizeInputForLogs
} = require("./common");
const {
  renderBriefMarkdown,
  renderWireframeMarkdown,
  renderCodexPrompt,
  renderCodexCommandPreview
} = require("./render");

async function generateAnalysisBundle(input) {
  const warnings = [];
  let mode = "demo";
  let analysis;
  logInfo("analysis.bundle_started", {
    ...summarizeInputForLogs(input),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY)
  });

  if (process.env.OPENAI_API_KEY) {
    try {
      analysis = await analyzeWithOpenAI(input);
      mode = "openai";
      logInfo("analysis.bundle_openai_succeeded", {
        model: DEFAULT_OPENAI_MODEL
      });
    } catch (error) {
      warnings.push(`OpenAI call failed, so PM.ai fell back to demo synthesis: ${error.message}`);
      analysis = buildDemoAnalysis(input);
      mode = "demo-fallback";
      logWarn("analysis.bundle_openai_failed", {
        model: DEFAULT_OPENAI_MODEL,
        message: error.message
      });
    }
  } else {
    analysis = buildDemoAnalysis(input);
    warnings.push("OPENAI_API_KEY is not set, so PM.ai is running in deterministic demo mode.");
    logWarn("analysis.bundle_demo_mode", {
      reason: "missing_openai_api_key"
    });
  }

  analysis = normalizeAnalysis(analysis, input);
  analysis.codexKickoff.prompt = renderCodexPrompt(input, analysis);
  analysis.codexKickoff.commandPreview = renderCodexCommandPreview();
  logInfo("analysis.bundle_completed", {
    mode,
    warnings: warnings.length,
    evidence: analysis.evidence.length,
    featureCandidates: analysis.featureCandidates.length,
    tickets: analysis.tickets.length
  });

  return {
    analysis,
    mode,
    warnings
  };
}

async function analyzeWithOpenAI(input) {
  logInfo("analysis.openai_request_started", {
    model: DEFAULT_OPENAI_MODEL,
    ...summarizeInputForLogs(input)
  });
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
    logWarn("analysis.openai_request_failed", {
      model: DEFAULT_OPENAI_MODEL,
      status: response.status,
      message
    });
    throw new Error(message);
  }
  logInfo("analysis.openai_request_completed", {
    model: DEFAULT_OPENAI_MODEL,
    status: response.status,
    responseId: asString(data?.id),
    hasParsedOutput: Boolean(data.output_parsed)
  });

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

function safelyExtractResponseText(data) {
  try {
    return extractResponseText(data);
  } catch (error) {
    return "";
  }
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
    codexWorkspacePath: asString(payload.codexWorkspacePath)
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
  const [primary, secondary, tertiary] = themes;
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
        "Create a single workflow that clusters incoming signals, ranks the opportunity, and turns the winning insight into a spec, wireframe description, and engineering kickoff packet.",
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
      targetUsers: input.targetUsers || "Product managers at small to mid-size software teams",
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
          "Create a Codex-ready prompt and optionally stream implementation output into a live code viewer when enabled.",
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
  return {
    executiveSummary: asString(raw?.executiveSummary) || fallback.executiveSummary,
    evidence: normalizeEvidence(raw?.evidence, fallback.evidence),
    featureCandidates: normalizeFeatureCandidates(raw?.featureCandidates, fallback.featureCandidates),
    recommendedFeature: normalizeRecommendedFeature(raw?.recommendedFeature, fallback.recommendedFeature),
    spec: normalizeSpec(raw?.spec, fallback.spec),
    wireframe: normalizeWireframe(raw?.wireframe, fallback.wireframe),
    tickets: normalizeTickets(raw?.tickets, fallback.tickets),
    codexKickoff: normalizeCodexKickoff(raw?.codexKickoff, fallback.codexKickoff)
  };
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
  logInfo("analysis.artifacts_written", {
    runId,
    runDir,
    mode: meta.mode,
    warnings: Array.isArray(meta.warnings) ? meta.warnings.length : 0,
    files: writtenFiles.map((file) => file.name)
  });

  return {
    runDir,
    files: writtenFiles
  };
}

module.exports = {
  generateAnalysisBundle,
  analyzeWithOpenAI,
  buildOpenAIUserPrompt,
  extractResponseText,
  safelyExtractResponseText,
  normalizeInput,
  hasMinimumInput,
  buildDemoAnalysis,
  normalizeAnalysis,
  normalizeEvidence,
  normalizeFeatureCandidates,
  normalizeRecommendedFeature,
  normalizeSpec,
  normalizeWireframe,
  normalizeTickets,
  normalizeCodexKickoff,
  writeArtifacts
};
