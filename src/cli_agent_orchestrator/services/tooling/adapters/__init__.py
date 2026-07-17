"""Provider extension adapters (Phase 4a).

An adapter turns a provider-agnostic action into a validated, runner-ready
:class:`~cli_agent_orchestrator.services.tooling.adapters.base.ExecutionPlan`,
reports capabilities, and verifies outcomes. Phase 4a ships one implementation
(``generic_skills``); the contract is provider-neutral so Phase 5 can add more.
"""
