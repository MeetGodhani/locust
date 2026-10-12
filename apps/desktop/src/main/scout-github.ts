import { PULL_REQUEST_FIELDS, pullRequestsOf } from '../shared/pull-request.js'
import { branchRunsOf, reviewsAskedOf } from '../shared/scout.js'
import type { ScoutGithub } from './scout.js'

/**
 * WHAT SCOUT READS FROM GITHUB (0.756), with the person's own GitHub CLI in the folder -- the one Commit and the
 * pull request chip already use, so it reads only what that sign-in can: their open pull requests and how their
 * checks stand, the pull requests that ask them for a review, and how the default branch's newest checks ended.
 * A folder that is not on GitHub, or a CLI that is missing or signed out, is no news rather than an error.
 */
export async function readScoutGithub(folder: string, gh: (args: readonly string[], cwd: string) => Promise<string>): Promise<ScoutGithub | undefined> {
  const mine = await gh(['pr', 'list', '--author', '@me', '--state', 'open', '--limit', '30', '--json', PULL_REQUEST_FIELDS], folder).catch(() => undefined)
  // The first answer decides: no answer, and the rest are not asked.
  if (mine === undefined) return undefined
  const reviews = await gh(['pr', 'list', '--search', 'review-requested:@me', '--state', 'open', '--limit', '20', '--json', 'number,title,url,author'], folder).catch(() => '[]')
  const branch = (await gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'], folder).catch(() => '')).trim()
  const runs = /^[\w./-]{1,200}$/.test(branch)
    ? await gh(['run', 'list', '--branch', branch, '--limit', '10', '--json', 'databaseId,conclusion,status,workflowName,url'], folder).catch(() => '[]')
    : undefined
  return {
    prs: pullRequestsOf(mine),
    reviews: reviewsAskedOf(reviews),
    ...(runs === undefined ? {} : { branch: { name: branch, runs: branchRunsOf(runs) } })
  }
}
