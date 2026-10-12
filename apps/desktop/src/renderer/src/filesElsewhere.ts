import { createContext } from 'react'

/**
 * A TURN WHOSE FILES ARE NOT IN THIS FOLDER (0.762): a turn on the cloud computer whose change is still there, went to
 * a pull request, or was put back. Its file rows still open onto what the turn changed -- that came with the turn --
 * but Open, Copy, Show in the file manager and Save a copy are not offered: each acts on this folder's file of that
 * name, which is not the one the turn made (on 0.761 a cloud turn's ADDED file offered all three, for a file that
 * was not here). The value says where the files are, for the rows' titles; undefined is this folder.
 */
export const FilesElsewhere = createContext<string | undefined>(undefined)

/**
 * A TURN THAT RAN ON THE CLOUD COMPUTER, whatever became of its change (0.763). An edit OpenCode reported without its
 * diff -- its `write` overwriting a file -- is filled in here from the folder, which a cloud turn's never was: its row
 * said "OpenCode did not report the change" right above the card that holds the change. It says where it changed.
 */
export const RanOnTheCloud = createContext(false)
