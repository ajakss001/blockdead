export type QualityLevel = 'low' | 'medium' | 'high';

/**
 * Why the loop is paused. Pause holds while at least one reason is active.
 * Hard reasons stop requestAnimationFrame entirely (no rendering, no battery drain).
 */
export type PauseReason = 'hidden' | 'ad' | 'menu' | 'orientation' | 'context';

export type AdKind = 'interstitial' | 'rewarded';
export type AdResult = 'shown' | 'closed' | 'error' | 'throttled';
