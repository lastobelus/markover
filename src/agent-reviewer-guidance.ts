export const FIXED_CONTRACT_STATEMENTS = Object.freeze([
  'Act as the sole reviewer for this review cycle.',
  'Return the complete markover-review artifact through markover submit; do not return a patch or a partial node list.',
  'Write review findings only in node.feedback.',
  'Write node.sourceEdit proposals only when review.agentReviewer.mode is annotations-and-source-proposals.',
  'Preserve every other field exactly, including unknown additive properties.',
  'Do not add or change attachments and do not apply source proposals to the Markdown file.',
  'Follow review.agentReviewer.agentGuidance.interpretationPolicy when deciding what feedback is useful.'
] as const)

export const FIXED_CONTRACT = FIXED_CONTRACT_STATEMENTS.join(' ')

export const DEFAULT_INTERPRETATION_POLICY = [
  'Review the document for correctness, clarity, internal consistency, and important omissions.',
  'Prefer specific, actionable annotations attached to the narrowest relevant block.',
  'Use source proposals only for exact replacement text that is useful in context; otherwise explain the finding in feedback.',
  'An empty review is valid when there are no findings.'
].join(' ')

export function reviewerGuidance(
  interpretationPolicy: unknown = DEFAULT_INTERPRETATION_POLICY
): AgentGuidance {
  return {
    fixedContract: FIXED_CONTRACT,
    interpretationPolicy: typeof interpretationPolicy === 'string'
      ? interpretationPolicy
      : DEFAULT_INTERPRETATION_POLICY
  }
}
