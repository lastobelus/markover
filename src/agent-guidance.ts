(function exposeAgentGuidance(globalScope: typeof globalThis) {
  const FIXED_CONTRACT_STATEMENTS = Object.freeze([
    'Feedback is free-form and may mix revision requests, questions, discussion, and context.',
    'Interpret each part according to its apparent intent.',
    'Never silently consume a question as an edit request: explicitly acknowledge every question in your response, even if you also act on it.',
    'Treat source edits as proposals whose meaning depends on context.'
  ])
  const FIXED_CONTRACT = FIXED_CONTRACT_STATEMENTS.join(' ')

  const DEFAULT_INTERPRETATION_POLICY = [
    'Use your judgment to respond to the review and make useful revisions.',
    'Ask for clarification when needed.'
  ].join(' ')

  function guidance(interpretationPolicy: unknown): AgentGuidance {
    return {
      fixedContract: FIXED_CONTRACT,
      interpretationPolicy: typeof interpretationPolicy === 'string'
        ? interpretationPolicy
        : DEFAULT_INTERPRETATION_POLICY
    }
  }

  const api = {
    FIXED_CONTRACT_STATEMENTS,
    FIXED_CONTRACT,
    DEFAULT_INTERPRETATION_POLICY,
    guidance
  } satisfies MarkoverAgentGuidanceApi
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  globalScope.MarkoverAgentGuidance = api
})(typeof window === 'undefined' ? globalThis : window)
