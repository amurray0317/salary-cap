/**
 * RosterIQ model versions. The version is also the `source` stored on
 * imported rows, so a new version writes new rows instead of silently
 * replacing the old ones (docs/MODELS.md governance). Refreshing the same
 * version (e.g. nightly in-season totals) updates its rows in place.
 */
export const XG_MODEL_VERSION = "rosteriq-xg-v1";
export const PROSPECT_MODEL_VERSION = "rosteriq-prospects-v1";

/** `source` values on imported rows. */
export const XG_SOURCE = XG_MODEL_VERSION;
export const XG_GOALIE_SOURCE = `${XG_MODEL_VERSION}-goalies`;
export const PROSPECT_SOURCE = PROSPECT_MODEL_VERSION;
