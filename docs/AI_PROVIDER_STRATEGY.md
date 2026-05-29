# AI Provider Strategy

Claude is the first supported provider because it is already used during development and fits the analyst-copilot style well. The app should still keep a provider abstraction so future users can choose cheaper, local, or organization-approved models.

## v1 default

- Claude first
- Bring-your-own API key
- AI acts as a copilot, not an autonomous operator

## Provider boundary

The application should call provider-neutral operations such as:

```
summarize_tool_output()
suggest_next_actions()
draft_finding()
draft_report_section()
validate_action_card()
```

Do not wire core workflow logic directly to a provider-specific chat route.

## Safety rule

The model may suggest actions, but the app enforces scope, approvals, command preview, rate limits, and audit logging. The app is the authority; the model is not.

## Later providers

- Gemini Flash/Pro for cheaper or long-context modes
- OpenAI-compatible endpoints for structured action validation
- Local models for privacy/offline lab use
