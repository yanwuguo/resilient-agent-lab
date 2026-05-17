# Resilient Agent Lab

Submission-ready project for the DevNetwork AI/ML Hackathon 2026, TrueFoundry "Resilient Agents" prize.

Resilient Agent Lab is a browser-based chaos drill for AI agents. It shows how an agent keeps a usable customer experience when the primary LLM fails, an MCP server times out, a write API browns out, or a model returns malformed JSON.

## Why it fits the challenge

The TrueFoundry prompt asks: "How does your agent behave when an MCP server starts erroring out? An LLM server goes down? OpenAI or Claude errors out or browns out?"

This project demonstrates:

- provider fallback from primary LLM to fallback model to local small model;
- circuit breakers for LLM, MCP, and write paths;
- stale-cache recovery when a search MCP server times out;
- schema repair for malformed model output;
- queued idempotent writes when a ticket API browns out;
- user-facing confidence and degradation status.

## Run locally

```bash
cd /Users/ang/Desktop/YG/ideas/resilient-agent-lab
python3 -m http.server 4177
```

Open `http://localhost:4177`.

## Demo script

1. Leave "Primary LLM outage" and "MCP search timeout" enabled.
2. Click "Run resilience drill".
3. Watch the primary LLM circuit open, fallback model serve the plan, MCP search degrade to stale cache, and the final user response include confidence and action status.
4. Enable "Ticket API brownout" and run again to show the idempotent queued write path.
5. Enable "Malformed model output" and run again to show schema repair.

## Devpost draft

Project name: Resilient Agent Lab

Short description:
An interactive chaos drill for AI agents that visualizes fallback routing, circuit breakers, stale-cache recovery, schema repair, and user-facing degradation when LLMs or MCP tools fail.

What it does:
Resilient Agent Lab simulates a production support agent investigating a checkout incident. Users can inject failures such as primary LLM outage, MCP timeout, write API brownout, and malformed model output. The agent keeps working by opening circuit breakers, routing to fallback models, using stale cached evidence, queueing writes with idempotency keys, and showing the user a confidence-marked response.

How it was built:
Static HTML, CSS, and JavaScript. The app uses deterministic async simulations for LLM providers, MCP servers, ticket writes, fallback routing, and scoring so judges can evaluate the resilience behavior without API keys.

Challenge mapping:
TrueFoundry asks for resilient agents when MCP servers and LLM servers fail. This app makes the failure modes visible and demonstrates the user experience under brownouts, timeouts, and malformed model responses.

## Status

Built as a lightweight, no-key prototype for hackathon submission. A production version would replace the simulated providers with real LiteLLM/OpenAI/Anthropic adapters, a real MCP client, persistent audit storage, and deployment health probes.
