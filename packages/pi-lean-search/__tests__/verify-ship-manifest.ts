/**
 * Ship-manifest verification helper (thin re-export).
 *
 * Re-exports the shared {@link verifyShipManifest} from pi-lean-portal's
 * __tests__/helpers/ship-manifest.ts. Kept so `ship-manifest.test.ts` can import
 * from a local path without depending on a specific cross-package layout.
 */

export type { ShipManifestResult } from "../../pi-lean-portal/__tests__/helpers/ship-manifest.js";
export { verifyShipManifest } from "../../pi-lean-portal/__tests__/helpers/ship-manifest.js";
