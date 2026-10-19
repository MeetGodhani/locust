/**
 * WHICH OPTION A NUMBER KEY CHOOSES (0.801), on a teammate's question card (ApprovalCard's QuestionForm) and on the
 * decision card, as Claude Code's own question does: 1 to 9, the option of that number in the question being
 * answered -- the one the focus is in, else the first one still without a choice. Nothing while typing in a field,
 * with Ctrl, Alt or the Windows key held, or for a number past the question's options.
 */
export interface NumberKeyQuestion {
  readonly id: string
  /** The options' labels, in the order the card draws them. */
  readonly options: readonly string[]
}

export function numberKeyAnswer(input: {
  readonly key: string
  readonly modified: boolean
  readonly typing: boolean
  readonly questions: readonly NumberKeyQuestion[]
  readonly chosen: Readonly<Record<string, string>>
  /** The question holding the focus, when the focus is on the card. */
  readonly focusedQuestion?: string | undefined
}): { readonly questionId: string; readonly label: string } | undefined {
  if (input.typing || input.modified || !/^[1-9]$/.test(input.key)) return undefined
  const withOptions = input.questions.filter((question) => question.options.length > 0)
  const question =
    withOptions.find((one) => one.id === input.focusedQuestion) ??
    withOptions.find((one) => input.chosen[one.id] === undefined)
  if (question === undefined) return undefined
  const label = question.options[Number(input.key) - 1]
  return label === undefined ? undefined : { questionId: question.id, label }
}
