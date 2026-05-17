const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  startedAt: 0,
  degraded: 0,
  latency: 0,
  audit: [],
};

const baseRunbook = [
  {
    title: "Model outage",
    text: "Open the LLM circuit after one hard failure, switch to Claude, and keep the primary on cooldown.",
  },
  {
    title: "Tool timeout",
    text: "Retry once with jitter, then answer from stale search cache with an explicit confidence marker.",
  },
  {
    title: "Write brownout",
    text: "Queue ticket creation with an idempotency key and return the queued status to the user.",
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function options() {
  return {
    task: $("#task").value.trim(),
    policy: $("input[name='policy']:checked").value,
    timeout: Number($("#timeout").value),
    failPrimary: $("#fail-primary").checked,
    failMcp: $("#fail-mcp").checked,
    failTicket: $("#fail-ticket").checked,
    failJson: $("#fail-json").checked,
  };
}

function setText(selector, value) {
  $(selector).textContent = value;
}

function addLog(message, badge = "ok") {
  const elapsed = ((performance.now() - state.startedAt) / 1000).toFixed(1);
  const li = document.createElement("li");
  const badgeClass = badge === "fail" ? "badge fail" : badge === "warn" ? "badge warn" : "badge";
  li.innerHTML = `<time>${elapsed}s</time><p>${message}</p><span class="${badgeClass}">${badge}</span>`;
  $("#timeline").append(li);
  $("#timeline").scrollTop = $("#timeline").scrollHeight;
  state.audit.push({ elapsed, message, badge });
}

function provider(name, mode, label) {
  const card = $(`.provider[data-provider="${name}"]`);
  card.classList.remove("is-active", "is-failed", "is-degraded");
  if (mode) card.classList.add(mode);
  setText(`#${name}-state`, label);
}

function breaker(selector, value, mode) {
  const card = $(selector).closest(".breaker");
  card.classList.remove("is-open", "is-half");
  if (mode) card.classList.add(mode);
  $(selector).textContent = value;
}

function resetUi() {
  state.startedAt = performance.now();
  state.degraded = 0;
  state.latency = 0;
  state.audit = [];
  $("#timeline").innerHTML = "";
  setText("#runtime-status", "Ready");
  setText("#score", "0");
  setText("#latency", "0.0s");
  setText("#degraded", "0");
  setText("#answer", "Run a drill to generate the customer-facing response.");
  $("#answer").classList.add("empty");
  $("#confidence").className = "confidence";
  setText("#confidence", "waiting");
  setText("#ticket-state", "not started");
  setText("#cache-state", "fresh");
  setText("#audit-state", "idle");
  provider("openai", "", "standby");
  provider("claude", "", "standby");
  provider("local", "", "standby");
  breaker("#llm-breaker", "closed");
  breaker("#mcp-breaker", "closed");
  breaker("#write-breaker", "closed");
  setText("#breaker-summary", "3 closed");
  renderRunbook(baseRunbook);
}

function renderRunbook(items) {
  $("#runbook").innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.title}</strong>${item.text}`;
    $("#runbook").append(li);
  }
}

function scoreRun(success, confidence, degraded, latency) {
  const confidencePoints = Math.round(confidence * 35);
  const successPoints = success ? 40 : 12;
  const degradationPenalty = degraded * 4;
  const latencyPenalty = Math.max(0, Math.round((latency - 4) * 2));
  return Math.max(0, Math.min(100, successPoints + confidencePoints - degradationPenalty - latencyPenalty));
}

async function callModel(name, opts) {
  const latency = name === "local" ? 620 : name === "claude" ? 1050 : 840;
  provider(name, "is-active", "running");
  await sleep(latency);
  state.latency += latency / 1000;

  if (name === "openai" && opts.failPrimary) {
    provider(name, "is-failed", "unavailable");
    breaker("#llm-breaker", "open", "is-open");
    state.degraded += 1;
    addLog("Primary LLM returned 503. Circuit breaker opened and fallback routing started.", "fail");
    throw new Error("primary_llm_down");
  }

  if (name === "claude" && opts.failJson) {
    provider(name, "is-degraded", "schema repair");
    state.degraded += 1;
    addLog("Fallback model produced malformed JSON. Schema repair recovered a valid plan.", "warn");
    return {
      model: name,
      confidence: 0.74,
      repaired: true,
      plan: ["analyze sentiment", "fetch incident context", "queue follow-up"],
    };
  }

  provider(name, "is-active", "complete");
  return {
    model: name,
    confidence: name === "local" ? 0.62 : 0.86,
    repaired: false,
    plan: ["analyze sentiment", "fetch incident context", "open ticket if confidence is high"],
  };
}

async function mcpSearch(opts) {
  addLog("MCP search server called for checkout incidents, deploys, and support tickets.");
  await sleep(opts.policy === "fast" ? 520 : 900);
  state.latency += opts.policy === "fast" ? 0.52 : 0.9;

  if (opts.failMcp) {
    state.degraded += 1;
    breaker("#mcp-breaker", "half-open", "is-half");
    setText("#cache-state", "stale 18m");
    addLog("MCP search timed out after retry. Agent switched to stale cache and marked the result degraded.", "warn");
    return {
      source: "stale cache",
      confidenceDelta: -0.12,
      evidence: [
        "Payment gateway deploy at 08:47 UTC",
        "Support tickets mention 3DS redirect loop",
        "Sentiment drop concentrated in checkout completion comments",
      ],
    };
  }

  setText("#cache-state", "fresh");
  addLog("MCP search returned fresh incident context and support-ticket clusters.");
  return {
    source: "fresh MCP",
    confidenceDelta: 0.04,
    evidence: [
      "Payment gateway deploy at 08:47 UTC",
      "3DS redirect loop reproduced in two regions",
      "Rollback reduced negative checkout comments within 12 minutes",
    ],
  };
}

async function createTicket(opts, confidence) {
  if (confidence < 0.7) {
    setText("#ticket-state", "skipped");
    addLog("Ticket creation skipped because confidence stayed below the write threshold.", "warn");
    return "No ticket opened. Confidence is below the write threshold.";
  }

  setText("#ticket-state", "creating");
  await sleep(620);
  state.latency += 0.62;

  if (opts.failTicket) {
    state.degraded += 1;
    breaker("#write-breaker", "open", "is-open");
    setText("#ticket-state", "queued");
    addLog("Ticket API browned out. Write operation queued with idempotency key RA-2026-0517.", "warn");
    return "Follow-up ticket queued with idempotency key RA-2026-0517.";
  }

  setText("#ticket-state", "opened RA-1427");
  addLog("Follow-up ticket opened with linked evidence and fallback trace.");
  return "Follow-up ticket opened: RA-1427.";
}

function composeAnswer(opts, modelResult, searchResult, ticketResult, confidence) {
  const confidenceLabel = confidence >= 0.8 ? "high" : confidence >= 0.65 ? "medium" : "limited";
  const mode = searchResult.source === "stale cache" ? "I used cached incident data because live search was unavailable." : "I used live incident and ticket data.";

  return [
    `Status: completed with ${confidenceLabel} confidence.`,
    "",
    `Likely cause: the checkout sentiment drop is tied to the payment gateway deploy and a 3DS redirect loop. ${mode}`,
    "",
    "Evidence:",
    ...searchResult.evidence.map((item) => `- ${item}`),
    "",
    `Action: ${ticketResult}`,
    "",
    `Resilience trace: ${modelResult.model} produced the final plan after ${state.degraded} degraded path(s). The user still receives a direct answer, a confidence marker, and the write status.`,
  ].join("\n");
}

async function run() {
  const opts = options();
  if (!opts.task) return;

  resetUi();
  $("#run").disabled = true;
  setText("#runtime-status", "Running");
  setText("#audit-state", "recording");
  addLog(`Task accepted under ${opts.policy} policy with ${opts.timeout}s timeout budget.`);

  let modelResult;
  try {
    modelResult = await callModel("openai", opts);
    addLog("Primary model returned a structured plan.");
  } catch {
    try {
      modelResult = await callModel("claude", opts);
      addLog("Fallback model returned a usable plan.");
    } catch {
      modelResult = await callModel("local", opts);
      addLog("Local model produced a safe minimal plan.", "warn");
    }
  }

  if (opts.failPrimary) {
    provider("claude", "is-active", "serving");
  }

  const searchResult = await mcpSearch(opts);
  const confidence = Math.max(0.45, Math.min(0.96, modelResult.confidence + searchResult.confidenceDelta));
  const ticketResult = await createTicket(opts, confidence);

  const answer = composeAnswer(opts, modelResult, searchResult, ticketResult, confidence);
  $("#answer").textContent = answer;
  $("#answer").classList.remove("empty");
  $("#confidence").className = confidence >= 0.8 ? "confidence good" : "confidence warn";
  setText("#confidence", `${Math.round(confidence * 100)}% confidence`);

  const totalLatency = ((performance.now() - state.startedAt) / 1000).toFixed(1);
  const finalScore = scoreRun(true, confidence, state.degraded, Number(totalLatency));
  setText("#latency", `${totalLatency}s`);
  setText("#degraded", String(state.degraded));
  setText("#score", String(finalScore));
  setText("#runtime-status", "Complete");
  setText("#audit-state", `${state.audit.length} events`);

  const openBreakers = ["#llm-breaker", "#mcp-breaker", "#write-breaker"].filter((id) => $(id).textContent !== "closed").length;
  setText("#breaker-summary", `${3 - openBreakers} closed, ${openBreakers} active`);
  addLog(`Drill complete. Resilience score ${finalScore}/100, ${state.degraded} degraded path(s).`);
  $("#run").disabled = false;
}

$("#timeout").addEventListener("input", (event) => {
  setText("#timeout-value", `${event.target.value}s`);
});

$("#reset").addEventListener("click", resetUi);
$("#run").addEventListener("click", run);

resetUi();
