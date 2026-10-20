---
name: "model-routing"
description: "Launch each cloud agent on the routing table's model for its task class. Load when: When launching a cloud agent, logging that launch, or changing the routing table."
---
<!-- collabb-doctrine-pack: id=model-routing version=1.0.0 sha256=059ff1f89759119361ec60369976ed6875a0f0448e09d4ed494dba8c59cb00b8 doctrines=101 -->
## Doctrine 101

**Every cloud agent launch uses the model and parameters the routing table names for its task class.**

Auto, `default`, and an omitted model are violations. #462 locks the classes spec, build, review, chore, and retro, and it locks the retro cadence at weekly. Each launch is logged as a comment on the driving issue and as a JSON line in the agent store. The table changes only through a pull request that cites deterministic evidence or a pattern recorded in at least two retros.

Scope is the instruction and the eval.

```model-routing
{
  "cadence": "weekly",
  "sinks": [
    "issue-comment",
    "agent-store"
  ],
  "retro_paths": [
    "doctrine/packs/model-routing.md",
    "docs/doctrine/model-routing.md",
    "doctrine/index.json",
    ".cursor/rules/model-routing.mdc",
    "grokbot/skills/model-routing/SKILL.md",
    "AGENTS.md",
    "scripts/model-routing-fixtures"
  ],
  "rows": [
    {
      "class": "spec",
      "model": "claude-opus-5-5",
      "model_params": {
        "effort": "xhigh"
      }
    },
    {
      "class": "build",
      "model": "grok-4.7",
      "model_params": {
        "reasoning_effort": "xhigh",
        "fast": true
      }
    },
    {
      "class": "review",
      "model": "claude-opus-5-5",
      "model_params": {
        "effort": "high"
      }
    },
    {
      "class": "chore",
      "model": "composer-2.5",
      "model_params": {
        "fast": true
      }
    },
    {
      "class": "retro",
      "model": "claude-opus-5-5",
      "model_params": {
        "effort": "high"
      }
    }
  ]
}
```

Model ids have to appear in the CloudAgent models list. Parameter names differ by model. Some rows use `effort`. The build row uses `reasoning_effort`. `fast` is a boolean.

A log row carries an id, the task class, the model, model_params, the outcome, and cost when the launch reported one. The comment sink and the agent-store sink are both required. The store path is `model-routing/launches.jsonl`. The writer keeps an allowlist of fields. A secret in a kept field fails the log. Extra fields are dropped.

The weekly retro is blameless. A table change cites a failing gate or a cost delta from the logs, or the same pattern in two retro ids, and it cites log row ids. Every path in that pull request stays inside `retro_paths`, and the pull request includes this pack.

Run `python3 scripts/model-routing.py --evals`.
