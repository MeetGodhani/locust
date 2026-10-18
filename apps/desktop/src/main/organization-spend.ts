import type { MissionLedger } from '@teammate/mission-store'
import type { TeammateStore } from './teammate-store.js'
import { spendByTeammate, usageTurns } from './mission-history.js'
import { limitReached, limitRefusal, monthOf, type Spend } from '../shared/spend.js'
import { policyMonthlyLimit, policyRefusal, type OrganizationPolicyState } from '../shared/organization-policy.js'

/** Uses existing receipt accounting. A managed limit that cannot be checked closes the gate. */
export function createSpendRefusal(options: {
  readonly policy: OrganizationPolicyState
  readonly ledger: MissionLedger
  readonly teammates: () => Pick<TeammateStore, 'list' | 'missionOwners'>
  readonly now?: () => Date
}) {
  return async (teammateId?: string): Promise<string | undefined> => {
    try {
      const teammate = teammateId === undefined ? undefined : (await options.teammates().list()).find((entry) => entry.teammateId === teammateId)
      const limit = policyMonthlyLimit(options.policy, teammate?.monthlyLimitUsd)
      if (limit === undefined) return undefined
      const now = options.now?.() ?? new Date()
      const month = monthOf(now)
      if (month === undefined) throw new Error('The current month could not be read.')
      let spent: Spend | undefined
      if (teammate === undefined) {
        // Unowned work uses the whole month's receipts; dropping an owner cannot escape the cap.
        const turns = await usageTurns(options.ledger, options.policy.policy.monthlyLimitUsd !== undefined)
        if (turns === undefined) throw new Error('The spending record could not be read.')
        spent = { usd: turns.filter((turn) => monthOf(turn.at) === month).reduce((sum, turn) => sum + (turn.usd ?? 0), 0) }
      } else {
        const totals = await spendByTeammate(options.ledger, await options.teammates().missionOwners(), month, options.policy.policy.monthlyLimitUsd !== undefined)
        if (totals === undefined && options.policy.policy.monthlyLimitUsd !== undefined) throw new Error('The spending record could not be read.')
        spent = totals?.get(teammate.teammateId)
      }
      if (!limitReached(spent, limit)) return undefined
      return options.policy.policy.monthlyLimitUsd !== undefined
        ? policyRefusal(options.policy, 'monthlyLimitUsd', `${teammate?.name ?? 'Locust'} has reached this month's effective limit of ${limit.toFixed(2)} USD. It starts again next month.`)
        : limitRefusal(teammate!.name, spent, limit, now)
    } catch (cause) {
      if (options.policy.policy.monthlyLimitUsd !== undefined) return policyRefusal(options.policy, 'monthlyLimitUsd', 'The monthly spending limit could not be checked. Ask your administrator to restore access to the spending record.')
      throw cause
    }
  }
}
