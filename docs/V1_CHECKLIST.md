# v1.0 Checklist

v1.0 is ready when MyHackingPal behaves like a controlled security testing workspace, not just a tool launcher.

## Platform

- [ ] macOS desktop workflow is polished
- [ ] Linux desktop/lab workflow is usable
- [x] Docker backend/server mode has clear trusted-network guidance
- [x] Windows is clearly marked experimental/deferred

## Engagement workflow

- [x] Launch defaults to Engagements/Home, not a random tool
- [ ] User can create an engagement
- [ ] User can define scope and exclusions
- [ ] User can add targets
- [ ] Tool runs attach to engagement + target
- [ ] Evidence attaches to timeline
- [ ] Findings can link to evidence
- [ ] Reports export from engagement state

## Safety

- [x] Scope enforcement wired into every target-accepting tool
- [x] Lab mode vs Engagement mode is explicit and persisted
- [x] Active checks require authorization confirmation
- [ ] Command preview gates target-accepting subprocess shell-outs (engagement mode requires user approval; lab mode shows but auto-approves)
- [ ] AI suggestions become approval cards, not hidden actions
- [ ] Rate limits have safe defaults
- [ ] Stop/kill works for long-running scans
- [x] Append-only audit log records important actions

## AI

- [ ] Assistant reads engagement/target context
- [ ] Assistant summarizes tool output
- [ ] Assistant suggests next checks safely
- [ ] Assistant drafts findings/report sections
- [ ] Provider boundary is not hardcoded to one vendor forever

## Tests

- [x] Backend scope/audit tests
- [x] Backend engagement/tool-run tests
- [x] Frontend mode/approval tests
- [ ] Report export smoke test
- [ ] Docker startup/health smoke test
