/**
 * WHERE LOCUST'S OWN FILES LIVE (0.783).
 *
 * On 2026-10-16 GitHub suspended the account that held Locust's releases, with
 * no warning and no reason given, and every installed copy's update check
 * failed with it: "The update check could not complete." The Windows feed, the
 * installers, the Mac's release list and the runtime check's verdicts were all
 * that one account's, so one decision about it cut every copy off at once.
 *
 * So Locust's downloads and updates come from its own domain, served by
 * Cloudflare, and a code host holds only the code. A move of the files is a
 * change on the domain, never a release that copies already out there cannot
 * hear about.
 */

/** Installers, the update feed, the Mac's release list and the runtime verdicts. */
export const DOWNLOADS = 'https://dl.locust.lol/'

/** The site, whose Download button offers every system's build. */
export const SITE = 'https://locust.lol/'
